import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProvider } from './provider.interface';
import { YooKassaProvider } from './yookassa.provider';
import { CryptoBotProvider } from './cryptobot.provider';
import { CryptomusProvider } from './cryptomus.provider';
import { LavaProvider } from './lava.provider';
import { PlategaProvider } from './platega.provider';
import { RollyPayProvider } from './rollypay.provider';
import { WataProvider } from './wata.provider';
import { AggregatorProvider } from './aggregator.provider';

/**
 * Реестр всех известных платёжных провайдеров панели. Включение и ключи —
 * из таблицы Setting (pay.<id>.enabled = "1", pay.<id>.<field> = значение).
 * Добавить платёжку = добавить экземпляр сюда (или готовый AggregatorProvider).
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers: PaymentProvider[] = [
    // проверенные адаптеры (каждый по официальной доке своей платёжки):
    new YooKassaProvider(), // карты + СБП (NSPK)
    new PlategaProvider(), // СБП/карты — подлинность по X-Secret заголовкам
    new RollyPayProvider(), // СБП/карты/крипта — HMAC(ts.body)
    new WataProvider(), // карты/СБП — вебхук RSA-SHA512
    new LavaProvider(), // карты/СБП/кошельки — HMAC (разные ключи запрос/вебхук)
    new CryptoBotProvider(), // крипта — HMAC key=SHA256(token)
    new CryptomusProvider(), // крипта — md5(base64(body)+apiKey)
    // AggregatorProvider — универсальный шаблон для БУДУЩИХ платёжек с типовой
    // HMAC-схемой (задаётся настройками). Не регистрируем «вслепую» — добавлять
    // осознанно, сверив подпись, иначе оплаты не засчитаются.
  ];

  constructor(private prisma: PrismaService) {}

  all(): PaymentProvider[] {
    return this.providers;
  }

  get(id: string): PaymentProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Настройки провайдера из Setting: pay.<id>.<field> → { field: value }. */
  async configFor(id: string): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: `pay.${id}.` } },
    });
    const cfg: Record<string, string> = {};
    for (const r of rows) cfg[r.key.slice(`pay.${id}.`.length)] = r.value;
    return cfg;
  }

  async isEnabled(id: string): Promise<boolean> {
    const cfg = await this.configFor(id);
    return cfg.enabled === '1' || cfg.enabled === 'true';
  }

  /** Включённые провайдеры (для показа клиенту способов оплаты). */
  async enabled(): Promise<PaymentProvider[]> {
    const out: PaymentProvider[] = [];
    for (const p of this.providers) if (await this.isEnabled(p.id)) out.push(p);
    return out;
  }
}
