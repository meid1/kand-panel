import { createHmac, timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * Lava — lava.ru business (эквайринг: карты/СБП/кошельки). По доке dev.lava.ru.
 * Настройки: shopId (uuid проекта), secretKey (подпись ИСХОДЯЩИХ запросов),
 *            additionalKey (проверка ВХОДЯЩИХ вебхуков) — у lava это РАЗНЫЕ ключи.
 *
 * Запрос: Signature = HMAC-SHA256( точная JSON-строка тела , secretKey ) hex → заголовок Signature.
 *   Критично: строка для подписи и тело запроса должны быть ПОБАЙТОВО идентичны.
 * Вебхук: заголовок Authorization = HMAC-SHA256( сырое тело , additionalKey ) hex.
 *
 * (lava.top — отдельная товарная система с offerId; здесь не используется — не
 *  подходит под модель «сумма+дни». При нужде — добавить отдельным адаптером.)
 */
export class LavaProvider implements PaymentProvider {
  readonly id = 'lava';
  readonly title = 'Lava (карты, СБП, кошельки)';
  readonly kinds = ['card', 'sbp', 'ewallet'] as const as any;
  readonly requiredKeys = ['shopId', 'secretKey', 'additionalKey'];

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    // строим тело ОДИН раз как строку и ей же подписываем (идентичность байтов)
    const body = JSON.stringify({
      sum: Number(req.amount.toFixed(2)),
      orderId: req.paymentId,
      shopId: cfg.shopId,
      hookUrl: cfg.callbackUrl || undefined,
      successUrl: req.returnUrl || undefined,
      failUrl: req.returnUrl || undefined,
      comment: req.description,
    });
    const sig = createHmac('sha256', cfg.secretKey).update(body).digest('hex');
    const data = await httpJson('https://api.lava.ru/business/invoice/create', {
      method: 'POST',
      headers: {
        Signature: sig,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    });
    return { url: data.data?.url, externalId: data.data?.id };
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const got = headers['authorization'];
    const mine = createHmac('sha256', cfg.additionalKey).update(rawBody).digest('hex');
    if (!got || !this.eq(String(got), mine)) throw new Error('lava: неверная подпись');
    const p = JSON.parse(rawBody || '{}');
    const st = String(p.status || '').toLowerCase();
    const status = st === 'success' ? 'paid'
      : ['failed', 'cancel', 'expired'].includes(st) ? 'failed' : 'pending';
    return { externalId: p.invoice_id, paymentId: p.order_id, status };
  }

  private eq(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
