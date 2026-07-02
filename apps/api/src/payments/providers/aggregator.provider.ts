import { createHmac, timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * Универсальный HMAC-агрегатор — один класс под МНОГО похожих РУ-платёжек
 * (RollyPay, Wata, Platega, разные СБП-агрегаторы). Большинство из них устроены
 * одинаково: POST создать счёт + вебхук с HMAC-SHA256-подписью. Отличаются только
 * URL, именами полей и заголовком подписи — всё это задаётся в настройках, БЕЗ кода.
 *
 * Экземпляр создаётся с фиксированным id/title (см. registry), а креды и мэппинг
 * полей берутся из настроек pay.<id>.*:
 *   apiUrl, shopId, secretKey, callbackUrl, returnUrl,
 *   sigHeader (заголовок подписи вебхука, по умолчанию 'sign'),
 *   fieldAmount/fieldOrder/fieldUrl/fieldExtId/fieldStatus/paidValues (мэппинг ответа).
 *
 * Это честный «конструктор»: закрывает класс провайдеров, а не один. Точные поля
 * конкретной платёжки установщик берёт из её доки и вписывает в настройках.
 */
export class AggregatorProvider implements PaymentProvider {
  readonly kinds = ['card', 'sbp', 'crypto', 'ewallet'] as const as any;
  readonly requiredKeys = ['apiUrl', 'shopId', 'secretKey'];

  constructor(
    public readonly id: string,
    public readonly title: string,
  ) {}

  private sign(bodyJson: string, secret: string): string {
    return createHmac('sha256', secret).update(bodyJson).digest('hex');
  }

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const body = JSON.stringify({
      [cfg.fieldAmount || 'amount']: req.amount.toFixed(2),
      [cfg.fieldOrder || 'order_id']: req.paymentId,
      shop_id: cfg.shopId,
      currency: req.currency || 'RUB',
      description: req.description,
      callback_url: cfg.callbackUrl || undefined,
      return_url: req.returnUrl || cfg.returnUrl || undefined,
    });
    const data = await httpJson(cfg.apiUrl, {
      method: 'POST',
      headers: {
        [cfg.sigHeader || 'sign']: this.sign(body, cfg.secretKey),
        'Content-Type': 'application/json',
      },
      body,
    });
    const url = data[cfg.fieldUrl || 'url'] || data.result?.url || data.data?.url;
    const externalId = data[cfg.fieldExtId || 'id'] || data.result?.id || data.data?.id;
    return { url, externalId: externalId ? String(externalId) : undefined };
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const hdr = (cfg.sigHeader || 'sign').toLowerCase();
    const got = headers[hdr];
    const mine = this.sign(rawBody, cfg.secretKey);
    if (!got || !this.eq(String(got), mine)) throw new Error(`${this.id}: неверная подпись`);
    const p = JSON.parse(rawBody || '{}');
    const st = String(p[cfg.fieldStatus || 'status'] || '').toLowerCase();
    const paidVals = (cfg.paidValues || 'success,paid,completed').split(',');
    const status = paidVals.includes(st) ? 'paid'
      : ['fail', 'failed', 'cancel', 'canceled', 'error'].includes(st) ? 'failed'
      : 'pending';
    return {
      externalId: p[cfg.fieldExtId || 'id'],
      paymentId: p[cfg.fieldOrder || 'order_id'],
      status,
    };
  }

  private eq(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
