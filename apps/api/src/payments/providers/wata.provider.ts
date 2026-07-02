import { createPublicKey, createVerify } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * Wata (wata.pro) — эквайринг карт/СБП (RUB/USD/EUR). По офиц. доке wata.pro/api.
 * Настройки: token (Bearer JWT из кабинета merchant.wata.pro).
 *
 * ОСОБЕННОСТЬ: вебхук подписан НЕ HMAC, а RSA (SHA512withRSA). Подпись в заголовке
 * X-Signature (base64) по СЫРОМУ телу. Публичный ключ берём с их API и кэшируем.
 */
export class WataProvider implements PaymentProvider {
  readonly id = 'wata';
  readonly title = 'Wata (карты, СБП)';
  readonly kinds = ['card', 'sbp'] as const as any;
  readonly requiredKeys = ['token'];

  private pubKeyPem: string | null = null; // кэш публичного ключа

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const data = await httpJson('https://api.wata.pro/api/h2h/links', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: req.amount,
        currency: req.currency || 'RUB',
        orderId: req.paymentId,
        description: req.description,
        successRedirectUrl: req.returnUrl || undefined,
        failRedirectUrl: req.returnUrl || undefined,
      }),
    });
    return { url: data.url, externalId: data.id };
  }

  private async publicKey(): Promise<string> {
    if (this.pubKeyPem) return this.pubKeyPem;
    const data = await httpJson('https://api.wata.pro/api/h2h/public-key');
    let val: string = data.value || data.publicKey || '';
    if (!val.includes('BEGIN')) {
      val = `-----BEGIN PUBLIC KEY-----\n${val}\n-----END PUBLIC KEY-----`;
    }
    // нормализуем (принимает и PKCS1 "RSA PUBLIC KEY", и SPKI)
    this.pubKeyPem = createPublicKey(val).export({ type: 'spki', format: 'pem' }) as string;
    return this.pubKeyPem;
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, _cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const sig = headers['x-signature'];
    if (!sig) throw new Error('wata: нет X-Signature');
    const pub = await this.publicKey();
    const v = createVerify('RSA-SHA512');
    v.update(rawBody);
    v.end();
    if (!v.verify(pub, Buffer.from(String(sig), 'base64'))) {
      throw new Error('wata: неверная RSA-подпись');
    }
    const p = JSON.parse(rawBody || '{}');
    const st = String(p.transactionStatus || '');
    const status = st === 'Paid' ? 'paid' : st === 'Declined' ? 'failed' : 'pending';
    return { externalId: p.transactionId, paymentId: p.orderId, status };
  }
}
