import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ProviderRegistry } from './providers/provider.registry';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ReferralService } from '../referral/referral.service';
import { PlansService } from '../plans/plans.service';

/**
 * Оркестрация оплаты поверх реестра провайдеров. Единый путь:
 * создать Payment(pending) → счёт у провайдера → вернуть ссылку. Вебхук →
 * проверка подписи (в провайдере) → начисление дней. Всё идемпотентно:
 * повторный вебхук по уже оплаченному Payment ничего не делает второй раз.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistry,
    private users: UsersService,
    private referral: ReferralService,
    private plans: PlansService,
  ) {}

  async createInvoice(dto: CreateInvoiceDto) {
    const provider = this.registry.get(dto.provider);
    if (!provider) throw new BadRequestException('неизвестный провайдер');
    if (!(await this.registry.isEnabled(dto.provider)))
      throw new BadRequestException('провайдер выключен');
    const cfg = await this.registry.configFor(dto.provider);

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('пользователь не найден');

    // тариф (planId) перебивает amount/days; иначе берём напрямую из dto
    let amount = dto.amount, days = dto.days, description = dto.description;
    if (dto.planId) {
      const plan = await this.plans.get(dto.planId);
      if (!plan) throw new BadRequestException('тариф не найден');
      amount = Number(plan.price); days = plan.days; description = description || plan.title;
    }
    if (dto.topup) { days = null as any; description = description || 'Пополнение баланса'; }
    if (amount == null || (!dto.topup && days == null)) throw new BadRequestException('нужен planId, amount+days или topup');

    const payment = await this.prisma.payment.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        amount,
        method: dto.provider,
        days: days ?? null,
        topup: !!dto.topup,
        status: 'pending',
        description,
      },
    });

    try {
      const inv = await provider.createInvoice(
        {
          paymentId: payment.id,
          amount: amount!,
          currency: dto.currency || 'RUB',
          description: description || `Подписка ${days} дн.`,
          returnUrl: dto.returnUrl,
        },
        cfg,
      );
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { invoiceId: inv.externalId },
      });
      return { paymentId: payment.id, url: inv.url };
    } catch (e: any) {
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { status: 'failed' },
      });
      throw new BadRequestException(`создание счёта не удалось: ${e.message || e}`);
    }
  }

  /** Обработка вебхука провайдера. rawBody — точные байты (для подписи). */
  async handleWebhook(providerId: string, headers: Record<string, any>, rawBody: string) {
    const provider = this.registry.get(providerId);
    if (!provider) throw new NotFoundException('неизвестный провайдер');
    const cfg = await this.registry.configFor(providerId);

    const res = await provider.handleWebhook(headers, rawBody, cfg); // бросит при плохой подписи

    // ищем наш Payment: сначала по возвращённому paymentId, иначе по invoiceId
    let payment = res.paymentId
      ? await this.prisma.payment.findUnique({ where: { id: res.paymentId } })
      : null;
    if (!payment && res.externalId)
      payment = await this.prisma.payment.findFirst({ where: { invoiceId: res.externalId } });
    if (!payment) return { ok: true, note: 'платёж не найден (игнор)' };

    if (payment.status === 'paid') return { ok: true, note: 'уже оплачен' }; // быстрый выход

    if (res.status === 'paid') {
      // АТОМАРНО: только один вебхук переведёт pending→paid и начислит (защита
      // от двойного начисления при гонке/повторных вебхуках). count=0 → уже засчитан.
      const flip = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { not: 'paid' } },
        data: { status: 'paid', paidAt: new Date() },
      });
      if (flip.count === 0) return { ok: true, note: 'уже оплачен (гонка)' };
      if (payment.topup) {
        // пополнение баланса
        await this.prisma.user.update({ where: { id: payment.userId }, data: { balance: { increment: payment.amount } } });
        this.log.log(`оплата ${payment.id} (${providerId}) → +${payment.amount} на баланс`);
        return { ok: true, balance: Number(payment.amount) };
      }
      if (payment.days) await this.users.grantDays(payment.userId, payment.days);
      await this.referral.rewardOnFirstPayment(payment.userId); // реф-бонус за 1-ю оплату
      this.log.log(`оплата ${payment.id} (${providerId}) → +${payment.days} дн.`);
      return { ok: true, granted: payment.days };
    }
    if (res.status === 'failed') {
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { status: 'failed' },
      });
    }
    return { ok: true };
  }

  /** Оплата тарифа С БАЛАНСА (мгновенно, без платёжки). */
  async payWithBalance(userId: string, planId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('пользователь не найден');
    const plan = await this.plans.get(planId);
    if (!plan) throw new BadRequestException('тариф не найден');
    const price = Number(plan.price);
    if (Number(user.balance) < price) throw new BadRequestException('недостаточно средств на балансе');
    await this.prisma.user.update({ where: { id: userId }, data: { balance: { decrement: price } } });
    await this.users.grantDays(userId, plan.days);
    await this.referral.rewardOnFirstPayment(userId);
    return { ok: true, days: plan.days, balance: Number(user.balance) - price };
  }

  async list(opts: { tenantId?: string; search?: string; status?: string; limit?: number; offset?: number } = {}) {
    const where: any = {};
    if (opts.tenantId) where.tenantId = opts.tenantId;
    if (opts.status) where.status = opts.status;
    const s = (opts.search || '').trim();
    if (s) {
      const or: any[] = [
        { method: { contains: s, mode: 'insensitive' } },
        { invoiceId: { contains: s, mode: 'insensitive' } },
        { user: { is: { tgName: { contains: s, mode: 'insensitive' } } } },
      ];
      const digits = s.replace(/\D/g, '');
      if (digits) { try { or.push({ user: { is: { tgId: BigInt(digits) } } }); } catch { /* */ } }
      where.OR = or;
    }
    const take = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const skip = Math.max(Number(opts.offset) || 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where, orderBy: { createdAt: 'desc' }, take, skip,
        include: { user: { select: { tgName: true, tgUsername: true, tgId: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { rows, total, limit: take, offset: skip };
  }

  /** Сменить статус платежа (админ): paid | pending | failed | refunded | granted. */
  async setStatus(id: string, status: string) {
    const ok = ['paid', 'pending', 'failed', 'refunded', 'granted'];
    if (!ok.includes(status)) throw new BadRequestException('статус: ' + ok.join(' | '));
    return this.prisma.payment.update({
      where: { id },
      data: { status, ...(status === 'paid' ? { paidAt: new Date() } : {}) },
    });
  }

  /** Способы оплаты для клиента (только включённые). */
  async available() {
    const en = await this.registry.enabled();
    return en.map((p) => ({ id: p.id, title: p.title, kinds: p.kinds }));
  }

  /** Все провайдеры + статус вкл/выкл + нужные поля — для админки. */
  async adminList() {
    const out = [];
    for (const p of this.registry.all()) {
      out.push({
        id: p.id, title: p.title, kinds: p.kinds,
        requiredKeys: p.requiredKeys, enabled: await this.registry.isEnabled(p.id),
      });
    }
    return out;
  }
}
