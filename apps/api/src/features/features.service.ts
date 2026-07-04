import { Injectable } from '@nestjs/common';

/**
 * Флаги возможностей панели. Клиент выбирает их в веб-конфигураторе установки,
 * install.sh пишет FEATURES_DISABLED / FEATURES_ENABLED в .env. Отключённые фичи
 * не грузят сервер: скрываются вкладки в админке и кнопки в боте.
 *
 * По умолчанию включён базовый набор; gifts/campaigns/franchises — по запросу.
 */
const DEFAULT_ON = ['bot', 'cabinet', 'payments', 'bypass', 'referral', 'promo', 'tickets'];
const KNOWN = [...DEFAULT_ON, 'gifts', 'campaigns', 'franchises'];

@Injectable()
export class FeaturesService {
  private readonly on: Set<string>;

  constructor() {
    const parse = (v?: string) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
    const set = new Set<string>([...DEFAULT_ON, ...parse(process.env.FEATURES_ENABLED)]);
    for (const d of parse(process.env.FEATURES_DISABLED)) set.delete(d);
    this.on = set;
  }

  enabled(feature: string): boolean {
    return this.on.has(feature);
  }

  /** Карта {feature: bool} для админки (скрыть вкладки/кнопки выключенного). */
  map(): Record<string, boolean> {
    const m: Record<string, boolean> = {};
    for (const k of KNOWN) m[k] = this.on.has(k);
    return m;
  }
}
