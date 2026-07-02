import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * CryptoBot (@CryptoBot / @send) — крипта (USDT/TON/BTC…), приём в фиате RUB.
 * Настройки: token (Crypto Pay API token).
 * Вебхук подписан HMAC-SHA256, ключ = SHA256(token), заголовок crypto-pay-api-signature.
 */
export class CryptoBotProvider implements PaymentProvider {
  readonly id = 'cryptobot';
  readonly title = 'CryptoBot (крипта)';
  readonly kinds = ['crypto'] as const as any;
  readonly requiredKeys = ['token'];

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const data = await httpJson('https://pay.crypt.bot/api/createInvoice', {
      method: 'POST',
      headers: { 'Crypto-Pay-API-Token': cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency_type: 'fiat',
        fiat: req.currency || 'RUB',
        amount: String(req.amount),
        description: req.description,
        payload: req.paymentId, // вернётся в вебхуке
        paid_btn_name: 'callback',
        paid_btn_url: req.returnUrl || 'https://t.me',
      }),
    });
    const r = data.result;
    return { url: r?.pay_url || r?.bot_invoice_url, externalId: String(r?.invoice_id) };
  }

  async handleWebhook(
    headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const sig = headers['crypto-pay-api-signature'];
    const key = createHash('sha256').update(cfg.token).digest();
    const mine = createHmac('sha256', key).update(rawBody).digest('hex');
    if (!sig || !this.eq(sig, mine)) throw new Error('cryptobot: неверная подпись');
    const upd = JSON.parse(rawBody || '{}');
    const inv = upd.payload || {};
    const status = upd.update_type === 'invoice_paid' || inv.status === 'paid'
      ? 'paid' : 'pending';
    return { externalId: String(inv.invoice_id), paymentId: inv.payload, status };
  }

  private eq(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
