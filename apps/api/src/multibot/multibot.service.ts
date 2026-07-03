import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { PaymentsService } from '../payments/payments.service';
import { BypassService } from '../bypass/bypass.service';
import { ReferralService } from '../referral/referral.service';
import { PlansService } from '../plans/plans.service';
import { PromoService } from '../promo/promo.service';
import { tg, InlineButton } from '../bot/telegram';

/**
 * Мультибот франшиз (мирроринг архитектуры MariusVPN: отдельный сервис под ботов
 * франшиз, платформенный бот не трогаем). Для каждой активной франшизы с botToken
 * поднимаем свой long-polling. Клиенты изолированы по tenantId, бренд/домен/ссылки
 * — франшизные. Доменные сервисы (users/plans/payments/…) переиспользуются как есть.
 */
interface BotCtx {
  token: string;
  tenantId: string;
  brand: string;
  domain?: string | null;      // кастом-домен франшизы (для ссылок подписки)
  domainVerified: boolean;
  username?: string | null;
  offset: number;
  running: boolean;
}

@Injectable()
export class MultibotService implements OnModuleInit {
  private readonly log = new Logger(MultibotService.name);
  private bots = new Map<string, BotCtx>(); // token → ctx
  private awaitingPromo = new Set<string>(); // `${token}:${chatId}`

  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private devices: DevicesService,
    private payments: PaymentsService,
    private bypass: BypassService,
    private referral: ReferralService,
    private plans: PlansService,
    private promo: PromoService,
  ) {}

  async onModuleInit() {
    await this.sync();
  }

  // раз в минуту синхронизируем набор ботов с активными франшизами (добавили/убрали)
  @Interval(60_000)
  async sync() {
    const franchises = await this.prisma.tenant.findMany({
      where: { kind: 'franchise', isActive: true, botToken: { not: null } },
    });
    const wanted = new Set<string>();
    for (const f of franchises) {
      const token = f.botToken!;
      wanted.add(token);
      if (this.bots.has(token)) {
        // обновим бренд/домен на случай правок
        const c = this.bots.get(token)!;
        c.brand = f.brand; c.domain = f.domain; c.domainVerified = f.domainVerified;
        continue;
      }
      const ctx: BotCtx = {
        token, tenantId: f.id, brand: f.brand, domain: f.domain,
        domainVerified: f.domainVerified, username: f.botUsername, offset: 0, running: true,
      };
      this.bots.set(token, ctx);
      // узнаём username бота (для реф-ссылок) — сохраним в тенант
      try {
        const me = await tg.getMe(token);
        if (me?.result?.username) {
          ctx.username = me.result.username;
          await this.prisma.tenant.update({ where: { id: f.id }, data: { botUsername: me.result.username } });
        }
      } catch { /* getMe не критичен */ }
      this.loop(ctx).catch((e) => this.log.warn(`франшиза-бот ${f.brand} упал: ${e.message || e}`));
      this.log.log(`франшиза-бот запущен: ${f.brand} (@${ctx.username || '?'})`);
    }
    // остановить боты снятых/выключенных франшиз
    for (const [token, ctx] of this.bots) {
      if (!wanted.has(token)) { ctx.running = false; this.bots.delete(token); }
    }
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private async loop(ctx: BotCtx) {
    while (ctx.running) {
      try {
        const updates = await tg.getUpdates(ctx.token, ctx.offset);
        for (const u of updates) {
          ctx.offset = u.update_id + 1;
          await this.handle(ctx, u).catch((e) => this.log.warn(`update: ${e.message || e}`));
        }
      } catch (e: any) {
        this.log.warn(`polling(${ctx.brand}): ${e.message || e}`);
        await this.sleep(3000);
      }
    }
  }

  // подстановка бренда франшизы
  private subst(text: string, brand: string, extra: Record<string, string> = {}) {
    const map: Record<string, string> = { brand, ...extra };
    return text.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? `{${k}}`);
  }

  private base(ctx: BotCtx): string {
    // ссылки франшизы — на её домене (если подтверждён HTTPS), иначе общий PANEL_URL
    if (ctx.domain && ctx.domainVerified) return `https://${ctx.domain}`;
    return (process.env.PANEL_URL || '').replace(/\/$/, '');
  }

  private menu(): InlineButton[][] {
    return [
      [{ text: '🔗 Подключиться', callback_data: 'connect' }],
      [{ text: '👤 Кабинет', callback_data: 'account' }, { text: '💳 Купить', callback_data: 'buy' }],
      [{ text: '🎁 Пробный период', callback_data: 'trial' }, { text: '🤝 Друзья', callback_data: 'referral' }],
      [{ text: '🎟 Промокод', callback_data: 'promo' }],
    ];
  }

  private async handle(ctx: BotCtx, u: any) {
    if (u.message?.text) return this.onMessage(ctx, u.message);
    if (u.callback_query) return this.onCallback(ctx, u.callback_query);
  }

  private async onMessage(ctx: BotCtx, msg: any) {
    const from = msg.from;
    const key = `${ctx.token}:${msg.chat.id}`;
    const { user, isNew } = await this.users.ensure(
      from.id, { username: from.username, name: [from.first_name, from.last_name].filter(Boolean).join(' ') }, ctx.tenantId,
    );
    if (this.awaitingPromo.has(key)) {
      this.awaitingPromo.delete(key);
      return this.redeemPromo(ctx, msg.chat.id, user, (msg.text || '').trim());
    }
    if (msg.text.startsWith('/start') || msg.text.startsWith('/menu')) {
      const m = msg.text.match(/\/start\s+ref_(\w+)/);
      if (m && isNew) await this.referral.link(user.id, m[1]).catch(() => {});
      const welcome = await this.tenantWelcome(ctx);
      return tg.sendMessage(ctx.token, msg.chat.id, welcome, this.menu());
    }
    return tg.sendMessage(ctx.token, msg.chat.id, this.subst('Меню {brand}:', ctx.brand), this.menu());
  }

  private async tenantWelcome(ctx: BotCtx): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    return t?.welcomeText || this.subst('Добро пожаловать в {brand}! 🚀\nВыберите действие ниже.', ctx.brand);
  }

  private async onCallback(ctx: BotCtx, cb: any) {
    const chatId = cb.message.chat.id;
    const data = cb.data as string;
    const { user } = await this.users.ensure(cb.from.id, { username: cb.from.username }, ctx.tenantId);
    await tg.answerCallback(ctx.token, cb.id);

    if (data === 'connect') return this.sendSubscription(ctx, chatId, user);
    if (data === 'account') return this.sendAccount(ctx, chatId, user);
    if (data === 'trial') return this.sendTrial(ctx, chatId, user);
    if (data === 'buy') return this.sendBuyMenu(ctx, chatId, user);
    if (data.startsWith('plan:')) return this.sendPayMethods(ctx, chatId, data.slice(5), user);
    if (data.startsWith('pay:')) { const [, planId, provider] = data.split(':'); return this.createInvoice(ctx, chatId, user, provider, planId); }
    if (data.startsWith('bal:')) {
      try { const r = await this.payments.payWithBalance(user.id, data.slice(4)); return tg.sendMessage(ctx.token, chatId, `✅ Оплачено с баланса: +${r.days} дн. Остаток: ${r.balance}₽`, this.menu()); }
      catch (e: any) { return tg.sendMessage(ctx.token, chatId, `❌ ${e.message}`, this.menu()); }
    }
    if (data === 'referral') return this.sendReferral(ctx, chatId, user);
    if (data === 'promo') { this.awaitingPromo.add(`${ctx.token}:${chatId}`); return tg.sendMessage(ctx.token, chatId, '🎟 Пришлите промокод одним сообщением:'); }
  }

  private async sendSubscription(ctx: BotCtx, chatId: number, user: any) {
    let device = (await this.devices.listForUser(user.id))[0];
    if (!device) device = await this.devices.create(user.id, 'Основное');
    const base = this.base(ctx);
    const link = `${base}/sub/${device.subToken}`;
    const smart = `${base}/sub/${device.subToken}/xray`;
    const tvLine = (device as any).tvCode
      ? `\n📺 <b>Для телевизора</b>: <code>${base}/t/${(device as any).tvCode}</code>\n` : '';
    await tg.sendMessage(ctx.token, chatId,
      `🔗 <b>Ваша ссылка</b> (умная: RU напрямую, YouTube без рекламы):\n<code>${smart}</code>\n${tvLine}\n` +
      `Добавьте её в приложение: Happ / v2rayNG / Streisand / Hiddify.\n\n` +
      `<i>Обычная (весь трафик через VPN): <code>${link}</code></i>`);
  }

  private async sendAccount(ctx: BotCtx, chatId: number, user: any) {
    const exp = user.expireAt ? new Date(user.expireAt).toLocaleDateString('ru-RU') : '—';
    const bp = await this.bypass.state(user.id);
    const bypassLine = bp.unlimited ? 'Обход: безлимит'
      : `Обход: ${bp.remainingGb != null ? bp.remainingGb.toFixed(1) : '?'} ГБ осталось${bp.suspended ? ' (исчерпан)' : ''}`;
    const bal = Number(user.balance || 0);
    const balLine = bal > 0 ? `\n💰 Баланс: <b>${bal}₽</b>` : '';
    await tg.sendMessage(ctx.token, chatId, `👤 <b>Кабинет ${ctx.brand}</b>\nПодписка до: <b>${exp}</b>\n${bypassLine}${balLine}`, this.menu());
  }

  private async sendTrial(ctx: BotCtx, chatId: number, user: any) {
    if (user.trialUsed || (user.expireAt && new Date(user.expireAt) > new Date())) {
      return tg.sendMessage(ctx.token, chatId, 'У вас уже есть активный доступ.');
    }
    const s = await this.prisma.setting.findUnique({ where: { key: 'trial.days' } });
    const days = s ? Number(s.value) || 0 : 0;
    if (days <= 0) return tg.sendMessage(ctx.token, chatId, 'Пробный период недоступен.');
    await this.users.grantDays(user.id, days);
    await this.prisma.user.update({ where: { id: user.id }, data: { trialUsed: true } });
    await tg.sendMessage(ctx.token, chatId, `🎁 Пробный период на ${days} дн. активирован! Нажмите «Подключиться».`, this.menu());
  }

  private async sendBuyMenu(ctx: BotCtx, chatId: number, user: any) {
    const plans = await this.plans.list(ctx.tenantId);
    if (plans.length) {
      const buttons = plans.map((p) => [{ text: `${p.title} — ${Number(p.price)}₽`, callback_data: `plan:${p.id}` }]);
      return tg.sendMessage(ctx.token, chatId, 'Выберите тариф:', buttons);
    }
    const methods = await this.payments.available();
    if (!methods.length) return tg.sendMessage(ctx.token, chatId, 'Оплата временно недоступна.');
    const buttons = methods.map((m) => [{ text: m.title, callback_data: `pay::${m.id}` }]);
    await tg.sendMessage(ctx.token, chatId, 'Способ оплаты:', buttons);
  }

  private async sendPayMethods(ctx: BotCtx, chatId: number, planId: string, user: any) {
    const methods = await this.payments.available();
    const buttons: InlineButton[][] = methods.map((m) => [{ text: m.title, callback_data: `pay:${planId}:${m.id}` }]);
    const plan = await this.plans.get(planId);
    if (plan && Number(user.balance || 0) >= Number(plan.price)) {
      buttons.unshift([{ text: `💰 С баланса (${Number(user.balance)}₽)`, callback_data: `bal:${planId}` }]);
    }
    if (!buttons.length) return tg.sendMessage(ctx.token, chatId, 'Оплата временно недоступна.');
    await tg.sendMessage(ctx.token, chatId, 'Способ оплаты:', buttons);
  }

  private lastPay = new Map<string, number>();
  private async createInvoice(ctx: BotCtx, chatId: number, user: any, provider: string, planId?: string) {
    const key = `${ctx.token}:${chatId}`;
    if (Date.now() - (this.lastPay.get(key) || 0) < 5000) {
      return tg.sendMessage(ctx.token, chatId, '⏳ Счёт уже создаётся, подождите пару секунд…');
    }
    this.lastPay.set(key, Date.now());
    try {
      let inv: any, label: string;
      if (planId) {
        inv = await this.payments.createInvoice({ userId: user.id, provider, planId } as any);
        const plan = await this.plans.get(planId);
        label = `Оплата ${Number(plan?.price)}₽ — ${plan?.title}:`;
      } else {
        const daysS = await this.prisma.setting.findUnique({ where: { key: 'plan.days' } });
        const priceS = await this.prisma.setting.findUnique({ where: { key: 'plan.price' } });
        const days = daysS ? Number(daysS.value) || 30 : 30;
        const amount = priceS ? Number(priceS.value) || 90 : 90;
        inv = await this.payments.createInvoice({ userId: user.id, provider, amount, days } as any);
        label = `Оплата ${amount}₽ за ${days} дней:`;
      }
      await tg.sendMessage(ctx.token, chatId, label, [[{ text: '💳 Оплатить', url: inv.url }]]);
    } catch (e: any) {
      await tg.sendMessage(ctx.token, chatId, `Не удалось создать счёт: ${e.message || e}`);
    }
  }

  private async sendReferral(ctx: BotCtx, chatId: number, user: any) {
    const r = await this.referral.stats(user.id);
    const rewardS = await this.prisma.setting.findUnique({ where: { key: 'referral.reward_days' } });
    const reward = rewardS ? Number(rewardS.value) || 0 : 0;
    const rewardLine = reward > 0 ? `\nЗа каждого друга, который оплатит, вы получите <b>${reward} дн.</b>` : '';
    // ссылка на бот франшизы (а не платформенный)
    const code = await this.referral.ensureCode(user.id);
    const link = ctx.username ? `https://t.me/${ctx.username}?start=ref_${code}` : r.link;
    await tg.sendMessage(ctx.token, chatId,
      `🤝 <b>Приглашайте друзей в ${ctx.brand}</b>${rewardLine}\n\n` +
      `Приглашено: <b>${r.invited}</b> · оплатили: <b>${r.paid}</b> · заработано: <b>${r.earnedDays} дн.</b>\n\n` +
      `Ваша ссылка:\n<code>${link}</code>`, this.menu());
  }

  private async redeemPromo(ctx: BotCtx, chatId: number, user: any, code: string) {
    try {
      const r = await this.promo.redeem(user.id, code);
      await tg.sendMessage(ctx.token, chatId, `✅ Промокод активирован: ${r.message}`, this.menu());
    } catch (e: any) {
      await tg.sendMessage(ctx.token, chatId, `❌ ${e.message || 'не удалось активировать'}`, this.menu());
    }
  }
}
