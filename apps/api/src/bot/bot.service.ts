import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { PaymentsService } from '../payments/payments.service';
import { BypassService } from '../bypass/bypass.service';
import { ReferralService } from '../referral/referral.service';
import { PlansService } from '../plans/plans.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { tg, InlineButton } from './telegram';

/**
 * Клиентский Telegram-бот (потребитель текстов/подписки/оплаты). Long-polling,
 * без фреймворков. Запускается, только если задан токен (настройка bot.token).
 * Тексты и кнопки берутся из SettingsService (правятся в веб-админке, не хардкод).
 * Для одиночной установки — один бот (платформа). Мультибот франшиз — расширение.
 */
@Injectable()
export class BotService implements OnModuleInit {
  private readonly log = new Logger(BotService.name);
  private token = '';
  private offset = 0;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private users: UsersService,
    private devices: DevicesService,
    private payments: PaymentsService,
    private bypass: BypassService,
    private referral: ReferralService,
    private plans: PlansService,
    private broadcast: BroadcastService,
  ) {}

  // владелец в состоянии ввода (chatId → что вводит): welcome | broadcast
  private awaiting = new Map<number, string>();
  private async isOwner(tgId: number): Promise<boolean> {
    const v = (await this.prisma.setting.findUnique({ where: { key: 'owner.tg_id' } }))?.value;
    return !!v && String(v) === String(tgId);
  }
  // приветствие с сохранёнными премиум-эмодзи (entities) или обычное (с подстановкой)
  private async sendWelcomeMsg(chatId: number, buttons?: InlineButton[][]) {
    const entRaw = (await this.prisma.setting.findUnique({ where: { key: 'text.welcome.entities' } }))?.value;
    if (entRaw) {
      const text = await this.settings.getText('text.welcome');
      let entities: any[] = []; try { entities = JSON.parse(entRaw); } catch { /* */ }
      return tg.sendMessage(this.token, chatId, text, buttons, entities);
    }
    const welcome = await this.subst(await this.settings.getText('text.welcome'));
    return tg.sendMessage(this.token, chatId, welcome, buttons);
  }

  private ownerMenu(chatId: number) {
    return tg.sendMessage(this.token, chatId, '🛠 <b>Админка бота</b>\nЗдесь можно задать приветствие и рассылку С ПРЕМИУМ-ЭМОДЗИ (их нельзя ввести в веб-панели).', [
      [{ text: '✏️ Задать приветствие', callback_data: 'oa:welcome' }],
      [{ text: '📢 Рассылка всем', callback_data: 'oa:broadcast' }],
    ]);
  }

  private async captureOwnerInput(msg: any) {
    const chatId = msg.chat.id;
    const field = this.awaiting.get(chatId);
    this.awaiting.delete(chatId);
    if (field === 'welcome') {
      await this.prisma.setting.upsert({ where: { key: 'text.welcome' }, update: { value: msg.text }, create: { key: 'text.welcome', value: msg.text } });
      await this.prisma.setting.upsert({ where: { key: 'text.welcome.entities' }, update: { value: JSON.stringify(msg.entities || []) }, create: { key: 'text.welcome.entities', value: JSON.stringify(msg.entities || []) } });
      return tg.sendMessage(this.token, chatId, '✅ Приветствие обновлено (премиум-эмодзи и форматирование сохранены).');
    }
    if (field === 'broadcast') {
      const r = await this.broadcast.start({ fromChatId: chatId, messageId: msg.message_id }).catch((e: any) => ({ error: e.message }));
      return tg.sendMessage(this.token, chatId, (r as any).error ? `Ошибка: ${(r as any).error}` : `📢 Рассылка запущена: получателей ${(r as any).total}. Премиум-эмодзи/медиа сохранятся (копия сообщения).`);
    }
  }

  async onModuleInit() {
    const s = await this.prisma.setting.findUnique({ where: { key: 'bot.token' } });
    this.token = s?.value || process.env.BOT_TOKEN || '';
    if (!this.token) { this.log.log('bot.token не задан — клиентский бот не запущен'); return; }
    // узнаём username бота (для реф-ссылок) и сохраняем в настройки
    try {
      const me = await tg.getMe(this.token);
      if (me?.result?.username) {
        await this.prisma.setting.upsert({
          where: { key: 'bot.username' }, update: { value: me.result.username },
          create: { key: 'bot.username', value: me.result.username },
        });
      }
    } catch { /* getMe не критичен */ }
    this.running = true;
    this.loop().catch((e) => this.log.error(`бот упал: ${e.message || e}`));
    this.log.log('клиентский бот запущен (polling)');
  }

  private async loop() {
    while (this.running) {
      try {
        const updates = await tg.getUpdates(this.token, this.offset);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handle(u).catch((e) => this.log.warn(`update: ${e.message || e}`));
        }
      } catch (e: any) {
        this.log.warn(`polling: ${e.message || e}`);
        await this.sleep(3000);
      }
    }
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  // ── подстановка плейсхолдеров ──────────────────────────────────────────────
  private async subst(text: string, extra: Record<string, string> = {}) {
    const brand = await this.settings.brand();
    const support = await this.settings.support();
    const map: Record<string, string> = { brand, support, ...extra };
    return text.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? `{${k}}`);
  }

  private async menu(): Promise<InlineButton[][]> {
    const b = async (key: string, data: string) => ({ text: await this.settings.getText(key), callback_data: data });
    return [
      [await b('btn.connect', 'connect')],
      [await b('btn.account', 'account'), await b('btn.buy', 'buy')],
      [await b('btn.trial', 'trial'), await b('btn.referral', 'referral')],
      [await b('btn.support', 'support')],
    ];
  }

  private panelUrl(): string {
    return (process.env.PANEL_URL || '').replace(/\/$/, '');
  }

  // ── роутинг апдейтов ───────────────────────────────────────────────────────
  private async handle(u: any) {
    if (u.message?.text) return this.onMessage(u.message);
    if (u.callback_query) return this.onCallback(u.callback_query);
  }

  // проверка настройки-флага
  private async flag(key: string): Promise<string> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value || '';
  }
  private on(v: string) { return v === '1' || v === 'true' || v === 'on'; }

  /**
   * Гейты доступа: согласие с условиями + обязательная подписка на канал.
   * Возвращает true, если можно показывать контент; иначе сам шлёт нужный экран.
   */
  private async gates(chatId: number, user: any, tgUserId: number): Promise<boolean> {
    // 1) согласие с условиями
    if (this.on(await this.flag('terms.required')) && !user.agreedTerms) {
      const terms = await this.subst(await this.settings.getText('text.terms'));
      await tg.sendMessage(this.token, chatId, terms, [[{ text: '✅ Соглашаюсь', callback_data: 'agree' }]]);
      return false;
    }
    // 2) обязательная подписка на канал
    if (this.on(await this.flag('require_channel.enabled'))) {
      const ch = await this.flag('require_channel');
      if (ch) {
        let member = false;
        try {
          const r = await tg.getChatMember(this.token, ch, tgUserId);
          const st = r?.result?.status;
          member = ['creator', 'administrator', 'member'].includes(st);
        } catch { member = true; /* канал недоступен боту — не блокируем */ }
        if (!member) {
          const txt = await this.subst(await this.settings.getText('text.require_sub'));
          const chLink = ch.startsWith('@') ? `https://t.me/${ch.slice(1)}` : undefined;
          const btns: InlineButton[][] = [];
          if (chLink) btns.push([{ text: '📢 Открыть канал', url: chLink }]);
          btns.push([{ text: '🔄 Проверить', callback_data: 'checksub' }]);
          await tg.sendMessage(this.token, chatId, txt, btns);
          return false;
        }
      }
    }
    return true;
  }

  private async onMessage(msg: any) {
    const from = msg.from;
    const { user, isNew } = await this.users.ensure(from.id, { username: from.username, name: [from.first_name, from.last_name].filter(Boolean).join(' ') });
    // владелец в режиме ввода (приветствие/рассылка) — перехватываем сообщение
    if (this.awaiting.has(msg.chat.id) && await this.isOwner(from.id)) return this.captureOwnerInput(msg);
    // вход в админку бота (только владелец)
    if ((msg.text === '/admin' || msg.text === '/owner') && await this.isOwner(from.id)) return this.ownerMenu(msg.chat.id);
    if (msg.text.startsWith('/start') || msg.text.startsWith('/menu')) {
      // реф-ссылка: /start ref_<code> → привязать пригласившего (только для новых)
      const m = msg.text.match(/\/start\s+ref_(\w+)/);
      if (m && isNew) await this.referral.link(user.id, m[1]).catch(() => {});
      if (!(await this.gates(msg.chat.id, user, from.id))) return;
      await this.sendWelcomeMsg(msg.chat.id, await this.menu());
    } else {
      // свободный текст → показываем меню (поддержка только по кнопке)
      await tg.sendMessage(this.token, msg.chat.id, await this.subst('Меню {brand}:'), await this.menu());
    }
  }

  private async onCallback(cb: any) {
    const chatId = cb.message.chat.id;
    const data = cb.data as string;
    const { user } = await this.users.ensure(cb.from.id, { username: cb.from.username });
    await tg.answerCallback(this.token, cb.id);

    // owner-админка внутри бота (задать приветствие/рассылку с премиум-эмодзи)
    if (data === 'oa:welcome' && await this.isOwner(cb.from.id)) {
      this.awaiting.set(chatId, 'welcome');
      return tg.sendMessage(this.token, chatId, 'Пришли новое приветствие (можно с премиум-эмодзи и форматированием):');
    }
    if (data === 'oa:broadcast' && await this.isOwner(cb.from.id)) {
      this.awaiting.set(chatId, 'broadcast');
      return tg.sendMessage(this.token, chatId, 'Пришли сообщение для рассылки (можно с премиум-эмодзи/медиа) — разошлю копию всем:');
    }
    // согласие с условиями
    if (data === 'agree') {
      await this.prisma.user.update({ where: { id: user.id }, data: { agreedTerms: true } });
      const u2 = { ...user, agreedTerms: true };
      if (!(await this.gates(chatId, u2, cb.from.id))) return;
      return this.sendWelcomeMsg(chatId, await this.menu());
    }
    // повторная проверка обязательной подписки
    if (data === 'checksub') {
      if (!(await this.gates(chatId, user, cb.from.id))) return;
      return this.sendWelcomeMsg(chatId, await this.menu());
    }
    // остальные действия — только после прохождения гейтов
    if (!(await this.gates(chatId, user, cb.from.id))) return;

    if (data === 'connect') return this.sendSubscription(chatId, user);
    if (data === 'account') return this.sendAccount(chatId, user);
    if (data === 'trial') return this.sendTrial(chatId, user);
    if (data === 'support') {
      return tg.sendMessage(this.token, chatId, await this.subst(await this.settings.getText('text.help')));
    }
    if (data === 'buy') return this.sendBuyMenu(chatId, user);
    if (data.startsWith('plan:')) return this.sendPayMethods(chatId, data.slice(5));
    if (data.startsWith('pay:')) { const [, planId, provider] = data.split(':'); return this.createInvoice(chatId, user, provider, planId); }
    if (data.startsWith('buy:')) return this.createInvoice(chatId, user, data.slice(4));
    if (data === 'referral') return this.sendReferral(chatId, user);
  }

  private async sendReferral(chatId: number, user: any) {
    const r = await this.referral.stats(user.id);
    const rewardS = await this.prisma.setting.findUnique({ where: { key: 'referral.reward_days' } });
    const reward = rewardS ? Number(rewardS.value) || 0 : 0;
    const rewardLine = reward > 0 ? `\nЗа каждого друга, который оплатит, ты получишь <b>${reward} дн.</b>` : '';
    await tg.sendMessage(this.token, chatId,
      `🤝 <b>Приглашай друзей</b>${rewardLine}\n\n` +
      `Приглашено: <b>${r.invited}</b> · оплатили: <b>${r.paid}</b> · заработано: <b>${r.earnedDays} дн.</b>\n\n` +
      `Твоя ссылка:\n<code>${r.link}</code>`, await this.menu());
  }

  // ── экраны ──────────────────────────────────────────────────────────────────
  private async sendSubscription(chatId: number, user: any) {
    let device = (await this.devices.listForUser(user.id))[0];
    if (!device) device = await this.devices.create(user.id, 'Основное');
    const base = this.panelUrl();
    const link = `${base}/sub/${device.subToken}`;
    const smart = `${base}/sub/${device.subToken}/xray`;
    const tvLine = (device as any).tvCode
      ? `\n📺 <b>Для телевизора</b> (Android TV): короткий адрес\n<code>${base}/t/${(device as any).tvCode}</code>\n`
      : '';
    await tg.sendMessage(this.token, chatId,
      `Ваша ссылка-подписка:\n<code>${link}</code>\n\n` +
      `Умный конфиг (RU напрямую, YouTube без рекламы):\n<code>${smart}</code>\n${tvLine}\n` +
      `Добавьте ссылку в приложение (v2rayNG / Streisand / Hiddify).`);
  }

  private async sendAccount(chatId: number, user: any) {
    const exp = user.expireAt ? new Date(user.expireAt).toLocaleDateString('ru-RU') : '—';
    const bp = await this.bypass.state(user.id);
    const bypassLine = bp.unlimited ? 'Обход: безлимит'
      : `Обход: ${bp.remainingGb != null ? bp.remainingGb.toFixed(1) : '?'} ГБ осталось${bp.suspended ? ' (исчерпан)' : ''}`;
    const txt = await this.subst(await this.settings.getText('text.account'), { expire: exp });
    await tg.sendMessage(this.token, chatId, `${txt}\n${bypassLine}`, await this.menu());
  }

  private async sendTrial(chatId: number, user: any) {
    if (user.trialUsed || (user.expireAt && new Date(user.expireAt) > new Date())) {
      return tg.sendMessage(this.token, chatId, await this.subst('У вас уже есть активный доступ.'));
    }
    const s = await this.prisma.setting.findUnique({ where: { key: 'trial.days' } });
    const days = s ? Number(s.value) || 0 : 0;
    if (days <= 0) return tg.sendMessage(this.token, chatId, 'Пробный период недоступен.');
    await this.users.grantDays(user.id, days);
    await this.prisma.user.update({ where: { id: user.id }, data: { trialUsed: true } });
    await tg.sendMessage(this.token, chatId, await this.subst(await this.settings.getText('text.trial'), { days: String(days) }), await this.menu());
  }

  private async sendBuyMenu(chatId: number, user: any) {
    const plans = await this.plans.list(user.tenantId);
    if (plans.length) {
      // есть тарифы → сначала выбор тарифа
      const buttons = plans.map((p) => [{ text: `${p.title} — ${p.price}₽`, callback_data: `plan:${p.id}` }]);
      return tg.sendMessage(this.token, chatId, 'Выберите тариф:', buttons);
    }
    // фолбэк: единый тариф из настроек → сразу выбор способа оплаты
    const methods = await this.payments.available();
    if (!methods.length) return tg.sendMessage(this.token, chatId, 'Оплата временно недоступна.');
    const buttons = methods.map((m) => [{ text: m.title, callback_data: `buy:${m.id}` }]);
    await tg.sendMessage(this.token, chatId, 'Выберите способ оплаты:', buttons);
  }

  private async sendPayMethods(chatId: number, planId: string) {
    const methods = await this.payments.available();
    if (!methods.length) return tg.sendMessage(this.token, chatId, 'Оплата временно недоступна.');
    const buttons = methods.map((m) => [{ text: m.title, callback_data: `pay:${planId}:${m.id}` }]);
    await tg.sendMessage(this.token, chatId, 'Способ оплаты:', buttons);
  }

  // provider ИЛИ {provider, planId} (для тарифа)
  private async createInvoice(chatId: number, user: any, provider: string, planId?: string) {
    try {
      let inv: any, label: string;
      if (planId) {
        inv = await this.payments.createInvoice({ userId: user.id, provider, planId } as any);
        const plan = await this.plans.get(planId);
        label = `Оплата ${plan?.price}₽ — ${plan?.title}:`;
      } else {
        const daysS = await this.prisma.setting.findUnique({ where: { key: 'plan.days' } });
        const priceS = await this.prisma.setting.findUnique({ where: { key: 'plan.price' } });
        const days = daysS ? Number(daysS.value) || 30 : 30;
        const amount = priceS ? Number(priceS.value) || 90 : 90;
        inv = await this.payments.createInvoice({ userId: user.id, provider, amount, days } as any);
        label = `Оплата ${amount}₽ за ${days} дней:`;
      }
      await tg.sendMessage(this.token, chatId, label, [[{ text: '💳 Оплатить', url: inv.url }]]);
    } catch (e: any) {
      await tg.sendMessage(this.token, chatId, `Не удалось создать счёт: ${e.message || e}`);
    }
  }
}
