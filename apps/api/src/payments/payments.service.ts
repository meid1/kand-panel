import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ProviderRegistry } from './providers/provider.registry';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ReferralService } from '../referral/referral.service';
import { PlansService } from '../plans/plans.service';
import { PromoGroupsService } from '../promo-groups/promo-groups.service';

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
    private promoGroups: PromoGroupsService,
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
      // скидка промо-группы клиента (если состоит в сегменте со скидкой)
      const pct = await this.promoGroups.discountPctForUser(user);
      if (pct) { amount = this.promoGroups.applyDiscount(amount, pct); description = `${description} (−${pct}%)`; }
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
          // сохранить карту для автосписания, если рекуррент включён (только за подписку, не пополнение)
          saveMethod: !dto.topup && (await this.recurrentEnabled(dto.provider)),
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
      // сохранить карту для рекуррента, если провайдер вернул токен
      if (res.savedMethodId) await this.storeSavedCard(payment.userId, providerId, res.savedMethodId, res.savedCardTitle);
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
    const pct = await this.promoGroups.discountPctForUser(user);
    const price = this.promoGroups.applyDiscount(Number(plan.price), pct);
    if (Number(user.balance) < price) throw new BadRequestException('недостаточно средств на балансе');
    // АТОМАРНОЕ списание: updateMany с условием balance>=price исключает гонку двойного
    // нажатия (два параллельных запроса не спишут дважды). count===0 → уже/недостаточно.
    const dec = await this.prisma.user.updateMany({
      where: { id: userId, balance: { gte: price } }, data: { balance: { decrement: price } },
    });
    if (dec.count === 0) throw new BadRequestException('недостаточно средств на балансе');
    // grantDays идёт во внешнюю БД/мост — если упадёт, компенсируем баланс (без потери денег).
    try {
      await this.users.grantDays(userId, plan.days);
    } catch (e) {
      await this.prisma.user.update({ where: { id: userId }, data: { balance: { increment: price } } });
      throw e;
    }
    await this.referral.rewardOnFirstPayment(userId);
    const fresh = await this.prisma.user.findUnique({ where: { id: userId }, select: { balance: true } });
    return { ok: true, days: plan.days, balance: Number(fresh?.balance ?? 0) };
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
        supportsRecurrent: typeof (p as any).chargeRecurring === 'function', // автосписание с карты
        recurrent: (await this.setting(`pay.${p.id}.recurrent`)) === '1',
      });
    }
    return out;
  }

  // ── Telegram Stars (нативная оплата XTR внутри Telegram) ─────────────────────
  private async setting(key: string): Promise<string> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value || '';
  }
  /** Курс: сколько рублей в одной звезде (для перевода цены тарифа в звёзды). */
  private async starsRate(): Promise<number> {
    const v = Number(await this.setting('pay.stars.rub_per_star'));
    return v && v > 0 ? v : 2; // дефолт: 2 ₽ за звезду
  }
  async getStarsConfig() {
    return { enabled: (await this.setting('pay.stars.enabled')) === '1', rubPerStar: await this.starsRate() };
  }
  async setStarsConfig(enabled: boolean, rubPerStar?: number) {
    const put = (key: string, value: string) => this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await put('pay.stars.enabled', enabled ? '1' : '0');
    const r = Number(rubPerStar);
    if (r && r > 0) await put('pay.stars.rub_per_star', String(r));
    return { ok: true };
  }
  async starsEnabled(): Promise<boolean> {
    return (await this.setting('pay.stars.enabled')) === '1';
  }

  /** Создать «звёздный» платёж (pending) под тариф; вернуть данные для sendInvoice. */
  async startStars(userId: string, planId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('пользователь не найден');
    const plan = await this.plans.get(planId);
    if (!plan) throw new BadRequestException('тариф не найден');
    const pct = await this.promoGroups.discountPctForUser(user);
    const price = this.promoGroups.applyDiscount(Number(plan.price), pct);
    const stars = Math.max(1, Math.round(price / (await this.starsRate())));
    const payment = await this.prisma.payment.create({
      data: { tenantId: user.tenantId, userId: user.id, amount: price, method: 'stars', days: plan.days, status: 'pending', description: plan.title },
    });
    return { paymentId: payment.id, stars, title: plan.title, days: plan.days };
  }

  /** Завершить «звёздный» платёж после successful_payment (payload = paymentId). Идемпотентно. */
  async completeStars(payload: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: String(payload || '') } });
    if (!payment) throw new NotFoundException('платёж не найден');
    if (payment.status === 'paid') return { ok: true, days: payment.days };
    const flip = await this.prisma.payment.updateMany({ where: { id: payment.id, status: { not: 'paid' } }, data: { status: 'paid', paidAt: new Date() } });
    if (flip.count === 0) return { ok: true, days: payment.days };
    if (payment.days) await this.users.grantDays(payment.userId, payment.days);
    await this.referral.rewardOnFirstPayment(payment.userId);
    this.log.log(`оплата ${payment.id} (stars) → +${payment.days} дн.`);
    return { ok: true, days: payment.days };
  }

  // ── Рекуррент / сохранённые карты (автосписание) ────────────────────────────
  /** Включён ли рекуррент у провайдера (сохранять карту при оплате). По умолчанию нет. */
  async recurrentEnabled(provider: string): Promise<boolean> {
    return (await this.setting(`pay.${provider}.recurrent`)) === '1';
  }

  /** Сохранить карту клиента (одна активная на юзера+провайдер). */
  private async storeSavedCard(userId: string, provider: string, methodId: string, title?: string) {
    const exists = await this.prisma.savedCard.findFirst({ where: { userId, provider, methodId } });
    if (exists) return;
    await this.prisma.savedCard.deleteMany({ where: { userId, provider } }); // заменяем старую
    await this.prisma.savedCard.create({ data: { userId, provider, methodId, title: title || null } });
    this.log.log(`карта сохранена для рекуррента: user ${userId} (${provider})`);
  }

  /** Есть ли у клиента сохранённая карта (для автопродления). */
  async hasSavedCard(userId: string): Promise<boolean> {
    return (await this.prisma.savedCard.count({ where: { userId } })) > 0;
  }

  /**
   * Автосписание с сохранённой карты под тариф (для автопродления в мониторинге).
   * Возвращает {ok, days} при успехе, иначе null (нет карты/провайдер выкл/отказ).
   */
  async chargeSavedCard(userId: string, planId: string) {
    const card = await this.prisma.savedCard.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!card) return null;
    const provider = this.registry.get(card.provider);
    if (!provider?.chargeRecurring || !(await this.registry.isEnabled(card.provider))) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const plan = await this.plans.get(planId);
    if (!user || !plan) return null;
    const pct = await this.promoGroups.discountPctForUser(user);
    const price = this.promoGroups.applyDiscount(Number(plan.price), pct);
    const cfg = await this.registry.configFor(card.provider);
    const payment = await this.prisma.payment.create({
      data: { tenantId: user.tenantId, userId, amount: price, method: `${card.provider}-auto`, days: plan.days, status: 'pending', description: `Автопродление: ${plan.title}` },
    });
    try {
      const r = await provider.chargeRecurring!(card.methodId, price, `Автопродление: ${plan.title}`, payment.id, cfg);
      if (!r.ok) { await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } }); return null; }
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: new Date(), invoiceId: r.externalId } });
      await this.users.grantDays(userId, plan.days);
      await this.referral.rewardOnFirstPayment(userId);
      this.log.log(`автосписание с карты: user ${userId} → +${plan.days} дн. (${price}₽)`);
      return { ok: true, days: plan.days };
    } catch (e: any) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } }).catch(() => {});
      this.log.warn(`автосписание с карты не удалось (user ${userId}): ${e?.message || e}`);
      return null;
    }
  }
}
