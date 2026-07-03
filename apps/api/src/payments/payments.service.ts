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
    if (amount == null || days == null) throw new BadRequestException('нужен planId или amount+days');

    const payment = await this.prisma.payment.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        amount,
        method: dto.provider,
        days,
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

  async list(tenantId?: string) {
    return this.prisma.payment.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' }, take: 200,
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
