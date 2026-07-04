import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TEXTS, TEXTS_BY_KEY } from './texts.registry';

/**
 * Тексты бота и общие настройки (бренд/поддержка). Ключевой инвариант:
 * getText/list ВСЕГДА возвращает актуальное значение — из БД, а если там пусто,
 * то default из реестра. Поэтому в веб-админке поля никогда не пустые.
 *
 * Премиум-эмодзи: обычный текст правится в вебе; премиум-версия (с entities)
 * задаётся через бота и хранится в text.<key>.entities (JSON). Рендер отдаёт
 * текст + (если есть) entities. Кнопки премиум-эмодзи не поддерживают (Telegram).
 */
@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  private async raw(key: string): Promise<string | null> {
    const r = await this.prisma.setting.findUnique({ where: { key } });
    return r?.value ?? null;
  }
  private async put(key: string, value: string) {
    await this.prisma.setting.upsert({
      where: { key }, update: { value }, create: { key, value },
    });
  }

  /** Бренд/поддержка — тоже из настроек, с дефолтами (никогда не пусто). */
  async brand(): Promise<string> { return (await this.raw('brand')) || 'VPN'; }
  async support(): Promise<string> { return (await this.raw('support')) || '@marius_support'; }

  /** Список всех редактируемых текстов с ЭФФЕКТИВНЫМИ значениями (для админки). */
  async list() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [...TEXTS.map((t) => t.key), ...TEXTS.map((t) => `${t.key}.entities`)] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      brand: await this.brand(),
      support: await this.support(),
      hiddenTabs: (await this.raw('ui.hidden_tabs')) || '', // скрыть неактуальные вкладки (напр. в гибриде)
      texts: TEXTS.map((t) => ({
        key: t.key,
        title: t.title,
        kind: t.kind,
        premium: !!t.premium,
        value: map[t.key] ?? t.default, // ← эффективное: БД или дефолт, не пусто
        isCustom: map[t.key] != null,
        hasPremium: map[`${t.key}.entities`] != null,
      })),
    };
  }

  /** Эффективное значение одного текста (для бота): БД или default. */
  async getText(key: string): Promise<string> {
    const def = TEXTS_BY_KEY[key];
    if (!def) throw new BadRequestException('неизвестный ключ текста');
    return (await this.raw(key)) ?? def.default;
  }

  async updateText(key: string, value: string) {
    if (!TEXTS_BY_KEY[key]) throw new BadRequestException('неизвестный ключ текста');
    if (value == null || value === '') throw new BadRequestException('текст не может быть пустым');
    await this.put(key, value);
    return { ok: true, key, value };
  }

  /** Сбросить текст к дефолту (удалить кастом). */
  async resetText(key: string) {
    if (!TEXTS_BY_KEY[key]) throw new BadRequestException('неизвестный ключ текста');
    await this.prisma.setting.deleteMany({ where: { key } });
    return { ok: true, key, value: TEXTS_BY_KEY[key].default };
  }

  // редактируемые флаги/значения (белый список — чтобы не писали произвольное)
  private static FLAGS: Record<string, string> = {
    'require_channel.enabled': 'Обязательная подписка на канал (вкл/выкл)',
    'require_channel': 'Канал для обязательной подписки (@username или -100id)',
    'maintenance.enabled': 'Режим техработ (1/0): бот отвечает клиентам «идут работы»',
    'maintenance.text': 'Текст техработ (что показать клиентам)',
    'terms.required': 'Требовать согласие с условиями (вкл/выкл)',
    'referral.reward_days': 'Реферал: дней пригласившему за 1-ю оплату',
    'referral.reward_money': 'Реферал: ₽ пригласившему за 1-ю оплату (для вывода деньгами; 0=выкл)',
    'referral.referee_days': 'Реферал: дней приглашённому за приход',
    'trial.days': 'Пробный период, дней',
    'plan.days': 'Тариф по умолчанию, дней (если нет тарифов)',
    'plan.price': 'Тариф по умолчанию, цена',
    'bypass.default_cap_gb': 'Лимит обхода по умолчанию, ГБ (0=безлимит)',
    'bot.token': 'Токен клиентского бота',
    'owner.tg_id': 'Telegram id владельца (для админки внутри бота)',
    'device.limit': 'Лимит устройств на клиента (0 = без лимита)',
    'hwid.limit': 'Лимит устройств по HWID (0 = выкл; заголовок x-hwid из Happ/v2rayTun)',
  };

  /** Текущие значения всех редактируемых флагов (для формы админки). */
  async flags() {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: Object.keys(SettingsService.FLAGS) } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return Object.entries(SettingsService.FLAGS).map(([key, title]) => ({ key, title, value: map[key] ?? '' }));
  }

  async setFlag(key: string, value: string) {
    if (!(key in SettingsService.FLAGS)) throw new BadRequestException('неизвестный флаг');
    await this.put(key, value ?? '');
    return { ok: true, key, value };
  }

  /** Настройки платёжки: pay.<id>.enabled + pay.<id>.<field>. Читает ProviderRegistry. */
  async setPay(id: string, body: Record<string, any>) {
    await this.put(`pay.${id}.enabled`, body.enabled ? '1' : '0');
    for (const [k, v] of Object.entries(body)) {
      if (k === 'enabled') continue;
      if (v != null && v !== '') await this.put(`pay.${id}.${k}`, String(v));
    }
    return { ok: true };
  }

  /** Кастомные кнопки бота (создаёт админ): [{text, action:url|text|builtin, value}]. */
  async getButtons(): Promise<any[]> {
    const raw = await this.raw('bot.buttons');
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }
  async setButtons(buttons: any[]) {
    const clean = (Array.isArray(buttons) ? buttons : []).filter((b) => b && b.text && ['url', 'text'].includes(b.action) && b.value)
      .slice(0, 20).map((b) => ({ text: String(b.text).slice(0, 64), action: String(b.action), value: String(b.value || '').slice(0, 500) }));
    await this.put('bot.buttons', JSON.stringify(clean));
    return { ok: true, buttons: clean };
  }

  /** Кастомная маршрутизация: свои сайты → напрямую / блок / через VPN (для умного конфига). */
  async getRouting() {
    const raw = await this.raw('routing.custom');
    try { return raw ? JSON.parse(raw) : { direct: '', block: '', proxy: '' }; } catch { return { direct: '', block: '', proxy: '' }; }
  }
  async setRouting(body: any) {
    const clean = { direct: String(body?.direct || ''), block: String(body?.block || ''), proxy: String(body?.proxy || '') };
    await this.put('routing.custom', JSON.stringify(clean));
    return { ok: true };
  }

  async setBrand(brand: string, support?: string) {
    if (brand) await this.put('brand', brand);
    if (support) await this.put('support', support);
    return { ok: true, brand: await this.brand(), support: await this.support() };
  }
}
