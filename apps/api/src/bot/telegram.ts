// Тонкий клиент Telegram Bot API (без фреймворков). Все методы принимают токен.

const base = (token: string) => `https://api.telegram.org/bot${token}`;

async function call(token: string, method: string, params: any): Promise<any> {
  const r = await fetch(`${base(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000), // жёсткий HTTP-таймаут: не блокируем воркер при зависшем TCP
  });
  return r.json();
}

export interface InlineButton { text: string; callback_data?: string; url?: string }

export const tg = {
  async getUpdates(token: string, offset: number, timeout = 25) {
    // long-poll: HTTP-таймаут = poll-таймаут + запас, чтобы не висеть вечно при обрыве сети
    const r = await fetch(`${base(token)}/getUpdates?offset=${offset}&timeout=${timeout}`, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
    const j = await r.json();
    return j.ok ? j.result : [];
  },
  // entities заданы → шлём как есть (сохраняются премиум-эмодзи); иначе parse_mode HTML
  sendMessage(token: string, chatId: number | string, text: string, buttons?: InlineButton[][], entities?: any[]) {
    return call(token, 'sendMessage', {
      chat_id: chatId, text, disable_web_page_preview: true,
      ...(entities && entities.length ? { entities } : { parse_mode: 'HTML' }),
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  },
  editMessage(token: string, chatId: number | string, msgId: number, text: string, buttons?: InlineButton[][]) {
    return call(token, 'editMessageText', {
      chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  },
  answerCallback(token: string, id: string, text?: string) {
    return call(token, 'answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  },
  getMe(token: string) { return call(token, 'getMe', {}); },
  getChatMember(token: string, chatId: string | number, userId: number) {
    return call(token, 'getChatMember', { chat_id: chatId, user_id: userId });
  },
  // Счёт в Telegram Stars (валюта XTR, provider_token пустой). amount = число звёзд.
  sendInvoice(token: string, chatId: number | string, opts: { title: string; description: string; payload: string; amount: number }) {
    return call(token, 'sendInvoice', {
      chat_id: chatId,
      title: opts.title,
      description: opts.description,
      payload: opts.payload,
      provider_token: '', // для XTR — пусто
      currency: 'XTR',
      prices: [{ label: opts.title, amount: opts.amount }],
    });
  },
  answerPreCheckoutQuery(token: string, id: string, ok = true, errorMessage?: string) {
    return call(token, 'answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, ...(ok ? {} : { error_message: errorMessage || 'Оплата недоступна' }) });
  },
};
