/**
 * Единый контракт платёжного провайдера. Каждый способ оплаты (ЮКасса, Lava,
 * RollyPay, СБП/NSPK-агрегатор, CryptoBot, Cryptomus/Wata …) — отдельный класс,
 * реализующий этот интерфейс. Ядро панели про конкретные платёжки НИЧЕГО не знает:
 * оно берёт включённые провайдеры из реестра и работает с ними единообразно.
 *
 * Так установщик панели включает нужные платёжки галочкой и вписывает свои ключи
 * в админке — без правки кода. Добавить новую платёжку = добавить один класс.
 */

export type PayKind = 'card' | 'sbp' | 'crypto' | 'ewallet';

export interface InvoiceRequest {
  paymentId: string; // наш Payment.id (для сверки в вебхуке)
  amount: number; // сумма
  currency: string; // RUB | USD | USDT …
  description: string;
  returnUrl?: string; // куда вернуть клиента после оплаты
  email?: string;
  saveMethod?: boolean; // сохранить способ оплаты (карту) для рекуррента
}

export interface InvoiceResult {
  url: string; // ссылка на оплату
  externalId?: string; // id платежа у провайдера
}

export interface WebhookResult {
  externalId?: string; // id платежа у провайдера (для поиска нашего Payment)
  paymentId?: string; // наш Payment.id, если провайдер вернул его назад
  status: 'paid' | 'failed' | 'pending';
  savedMethodId?: string; // токен сохранённой карты (если клиент разрешил рекуррент)
  savedCardTitle?: string; // маскированная карта для показа
}

/** Результат рекуррентного (автоматического) списания с сохранённой карты. */
export interface RecurringResult {
  ok: boolean; // списание прошло
  externalId?: string; // id платежа у провайдера
}

export interface PaymentProvider {
  /** машинный id (ключ в настройках: pay.<id>.enabled, pay.<id>.<field>) */
  readonly id: string;
  /** человекочитаемое имя для админки */
  readonly title: string;
  /** какие способы закрывает (для группировки в UI) */
  readonly kinds: PayKind[];
  /** какие поля нужно заполнить в настройках (для формы админки) */
  readonly requiredKeys: string[];

  /** Создать счёт у провайдера → вернуть ссылку на оплату. */
  createInvoice(req: InvoiceRequest, cfg: Record<string, string>): Promise<InvoiceResult>;

  /**
   * Обработать вебхук провайдера. ОБЯЗАН проверить подпись/подлинность (иначе
   * любой сможет «оплатить» бесплатно). rawBody — точные байты тела запроса.
   * Бросить исключение при неверной подписи.
   */
  handleWebhook(
    headers: Record<string, any>,
    rawBody: string,
    cfg: Record<string, string>,
  ): Promise<WebhookResult>;

  /**
   * Рекуррентное списание с ранее сохранённой карты (methodId). Опционально —
   * поддерживают не все провайдеры. Используется автопродлением (без участия клиента).
   */
  chargeRecurring?(
    methodId: string,
    amount: number,
    description: string,
    paymentId: string,
    cfg: Record<string, string>,
  ): Promise<RecurringResult>;
}
