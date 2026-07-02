import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * RollyPay (rollypay.io) — СБП/карты/крипта. По офиц. доке docs.rollypay.io.
 * Настройки: apiKey (rpk_live_…), signingSecret, (опц.) method (sbp|card|intl_card|crypto).
 *
 * Запрос: X-API-Key + X-Nonce (UUID на КАЖДЫЙ запрос, anti-replay).
 * Вебхук: подпись X-Signature = HMAC-SHA256( `${X-Timestamp}.${rawBody}` , signingSecret ) в hex.
 * Обязательно СЫРОЕ тело (не пересериализованный JSON).
 */
export class RollyPayProvider implements PaymentProvider {
  readonly id = 'rollypay';
  readonly title = 'RollyPay (СБП, карты, крипта)';
  readonly kinds = ['sbp', 'card', 'crypto'] as const as any;
  readonly requiredKeys = ['apiKey', 'signingSecret'];

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const data = await httpJson('https://rollypay.io/api/v1/payments', {
      method: 'POST',
      headers: {
        'X-API-Key': cfg.apiKey,
        'X-Nonce': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: req.amount.toFixed(2),
        payment_currency: req.currency || 'RUB',
        order_id: req.paymentId,
        payment_method: cfg.method || 'sbp',
        description: req.description,
        success_redirect_url: req.returnUrl || undefined,
        fail_redirect_url: req.returnUrl || undefined,
      }),
    });
    return { url: data.pay_url, externalId: data.payment_id };
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const sig = headers['x-signature'];
    const ts = headers['x-timestamp'];
    const mine = createHmac('sha256', cfg.signingSecret)
      .update(`${ts}.${rawBody}`).digest('hex');
    if (!sig || !this.eq(String(sig), mine)) throw new Error('rollypay: неверная подпись');
    const p = JSON.parse(rawBody || '{}');
    const paid = p.event_type === 'payment.paid' || p.status === 'paid';
    const failed = ['payment.canceled', 'payment.chargeback', 'payment.refunded']
      .includes(p.event_type);
    return {
      externalId: p.payment_id, paymentId: p.order_id,
      status: paid ? 'paid' : failed ? 'failed' : 'pending',
    };
  }

  private eq(a: string, b: string): boolean {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
