import { createHash, timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * Cryptomus — крипто-эквайринг (широкий выбор монет/сетей). Аналогичный класс
 * закрывает Wata и подобных крипто-эквайеров с той же схемой подписи.
 * Настройки: merchant (uuid), apiKey (payment API key).
 * Подпись: md5( base64(JSON-тело) + apiKey ). Так же проверяется вебхук.
 */
export class CryptomusProvider implements PaymentProvider {
  readonly id = 'cryptomus';
  readonly title = 'Cryptomus (крипта)';
  readonly kinds = ['crypto'] as const as any;
  readonly requiredKeys = ['merchant', 'apiKey'];

  private sign(bodyJson: string, apiKey: string): string {
    const b64 = Buffer.from(bodyJson).toString('base64');
    return createHash('md5').update(b64 + apiKey).digest('hex');
  }

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const body = JSON.stringify({
      amount: String(req.amount),
      currency: req.currency || 'RUB',
      order_id: req.paymentId,
      url_return: req.returnUrl || 'https://t.me',
      url_callback: cfg.callbackUrl || undefined,
    });
    const data = await httpJson('https://api.cryptomus.com/v1/payment', {
      method: 'POST',
      headers: {
        merchant: cfg.merchant,
        sign: this.sign(body, cfg.apiKey),
        'Content-Type': 'application/json',
      },
      body,
    });
    return { url: data.result?.url, externalId: data.result?.uuid };
  }

  async handleWebhook(
    _headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const payload = JSON.parse(rawBody || '{}');
    const got = payload.sign;
    // подпись считается по телу БЕЗ поля sign
    const { sign, ...rest } = payload;
    const mine = this.sign(JSON.stringify(rest), cfg.apiKey);
    if (!got || !this.eq(got, mine)) throw new Error('cryptomus: неверная подпись');
    const st = String(payload.status || '');
    const status = ['paid', 'paid_over'].includes(st) ? 'paid'
      : ['cancel', 'fail', 'system_fail', 'wrong_amount'].includes(st) ? 'failed'
      : 'pending';
    return { externalId: payload.uuid, paymentId: payload.order_id, status };
  }

  private eq(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
