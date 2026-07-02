import { timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * Platega (app.platega.io) — СБП/карты РФ, крипта. По офиц. доке docs.platega.io.
 * Настройки: merchantId, secret, (опц.) method (int: 2=СБП QR деф., 10=карты РФ, 13=крипта).
 *
 * ВАЖНО: у Platega вебхук БЕЗ криптоподписи. Подлинность = совпадение заголовков
 * X-MerchantId и X-Secret со своими (constant-time). Свой id заказа передаём в
 * поле payload (отдельного order_id в API нет) и получаем его обратно в вебхуке.
 */
export class PlategaProvider implements PaymentProvider {
  readonly id = 'platega';
  readonly title = 'Platega (СБП, карты)';
  readonly kinds = ['sbp', 'card', 'crypto'] as const as any;
  readonly requiredKeys = ['merchantId', 'secret'];

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const data = await httpJson('https://app.platega.io/transaction/process', {
      method: 'POST',
      headers: {
        'X-MerchantId': cfg.merchantId,
        'X-Secret': cfg.secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentMethod: Number(cfg.method || 2), // 2 = СБП по QR
        paymentDetails: { amount: req.amount, currency: req.currency || 'RUB' },
        description: req.description,
        return: req.returnUrl || 'https://t.me', // поле называется именно "return"
        failedUrl: req.returnUrl || 'https://t.me',
        payload: req.paymentId, // наш id вернётся в вебхуке
      }),
    });
    return { url: data.redirect, externalId: data.transactionId };
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    // подлинность = совпадение секретов из заголовков (HMAC у Platega нет)
    if (!this.eq(headers['x-merchantid'], cfg.merchantId) ||
        !this.eq(headers['x-secret'], cfg.secret)) {
      throw new Error('platega: неверные X-MerchantId/X-Secret');
    }
    const p = JSON.parse(rawBody || '{}');
    const st = String(p.status || '').toUpperCase();
    const status = st === 'CONFIRMED' ? 'paid'
      : ['CANCELED', 'CHARGEBACKED'].includes(st) ? 'failed' : 'pending';
    return { externalId: p.id, paymentId: p.payload, status };
  }

  private eq(a: any, b: any): boolean {
    if (a == null || b == null) return false;
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
