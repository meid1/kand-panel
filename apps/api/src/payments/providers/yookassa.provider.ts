import { httpJson } from './http';
import {
  InvoiceRequest, InvoiceResult, PaymentProvider, WebhookResult,
} from './provider.interface';

/**
 * ЮKassa — карты + СБП (NSPK/Система быстрых платежей идёт именно через неё).
 * Настройки: shopId, secretKey.
 *
 * Подлинность вебхука: ЮKassa не подписывает нотификации HMAC — поэтому мы НЕ
 * доверяем телу, а ПЕРЕЗАПРАШИВАЕМ статус платежа по API (Basic-auth секретом).
 * Это надёжнее любой подписи.
 */
export class YooKassaProvider implements PaymentProvider {
  readonly id = 'yookassa';
  readonly title = 'ЮKassa (карты, СБП)';
  readonly kinds = ['card', 'sbp'] as const as any;
  readonly requiredKeys = ['shopId', 'secretKey'];

  private auth(cfg: Record<string, string>) {
    return 'Basic ' + Buffer.from(`${cfg.shopId}:${cfg.secretKey}`).toString('base64');
  }

  async createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult> {
    const data = await httpJson('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: this.auth(cfg),
        'Idempotence-Key': req.paymentId, // защита от дублей
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: { value: req.amount.toFixed(2), currency: req.currency || 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: req.returnUrl || 'https://t.me' },
        description: req.description,
        metadata: { paymentId: req.paymentId },
      }),
    });
    return { url: data.confirmation?.confirmation_url, externalId: data.id };
  }

  async handleWebhook(
    _headers: Record<string, any>, rawBody: string, cfg: Record<string, string>,
  ): Promise<WebhookResult> {
    const evt = JSON.parse(rawBody || '{}');
    const id = evt.object?.id;
    if (!id) return { status: 'pending' };
    // перезапрос статуса — источник правды
    const p = await httpJson(`https://api.yookassa.ru/v3/payments/${id}`, {
      headers: { Authorization: this.auth(cfg) },
    });
    const status = p.status === 'succeeded' ? 'paid'
      : p.status === 'canceled' ? 'failed' : 'pending';
    return { externalId: id, paymentId: p.metadata?.paymentId, status };
  }
}
