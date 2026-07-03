/**
 * Реестр редактируемых текстов и кнопок бота. Ключи хранятся в Setting; если в БД
 * пусто — берётся default (поэтому в админке поле НИКОГДА не пустое). Плейсхолдеры
 * {brand}/{support} подставляются при рендере (бренд из настроек/тенанта — без хардкода).
 *
 * kind: 'text' — многострочный текст (welcome/help), можно обычные эмодзи;
 *       'button' — подпись кнопки (Telegram НЕ поддерживает премиум-эмодзи в кнопках);
 * premium: true — у текста возможна премиум-эмодзи версия (задаётся через бота, с entities).
 */
export interface TextDef {
  key: string;
  title: string;
  kind: 'text' | 'button';
  premium?: boolean;
  default: string;
}

export const TEXTS: TextDef[] = [
  // — основные тексты —
  { key: 'text.welcome', title: 'Приветствие', kind: 'text', premium: true,
    default: 'Привет! Это {brand} — быстрый и надёжный VPN.\n\nНажми «Подключиться», чтобы получить доступ.' },
  { key: 'text.help', title: 'Помощь', kind: 'text',
    default: 'Нужна помощь? Напиши в поддержку: {support}' },
  { key: 'text.account', title: 'Личный кабинет (шапка)', kind: 'text', premium: true,
    default: 'Ваш профиль {brand}\nПодписка активна до: {expire}' },
  { key: 'text.trial', title: 'Пробный период', kind: 'text', premium: true,
    default: 'Дарим пробный доступ на {days} дней! Пользуйтесь {brand} бесплатно.' },
  { key: 'text.pay_success', title: 'Успешная оплата', kind: 'text',
    default: 'Оплата прошла ✅ Подписка продлена. Спасибо, что с {brand}!' },
  { key: 'text.expired', title: 'Подписка истекла', kind: 'text',
    default: 'Ваша подписка закончилась. Продлите доступ, чтобы снова пользоваться {brand}.' },
  { key: 'text.bypass_out', title: 'Лимит обхода закончился', kind: 'text',
    default: 'Лимит обхода израсходован. Докупить можно в боте {support}.' },
  { key: 'text.terms', title: 'Условия / оферта', kind: 'text', premium: true,
    default: 'Пользуясь {brand}, вы соглашаетесь с условиями сервиса. Мы не храним логи вашей активности.' },
  { key: 'text.require_sub', title: 'Требование подписки на канал', kind: 'text',
    default: 'Чтобы пользоваться {brand}, подпишитесь на наш канал, затем нажмите «Проверить».' },
  // — кнопки (без премиум-эмодзи по природе Telegram) —
  { key: 'btn.connect', title: 'Кнопка: Подключиться', kind: 'button', default: '🚀 Подключиться' },
  { key: 'btn.account', title: 'Кнопка: Личный кабинет', kind: 'button', default: '👤 Личный кабинет' },
  { key: 'btn.buy', title: 'Кнопка: Купить/Продлить', kind: 'button', default: '💳 Продлить' },
  { key: 'btn.trial', title: 'Кнопка: Пробный период', kind: 'button', default: '🎁 Пробный период' },
  { key: 'btn.support', title: 'Кнопка: Поддержка', kind: 'button', default: '🆘 Поддержка' },
  { key: 'btn.devices', title: 'Кнопка: Мои устройства', kind: 'button', default: '📱 Устройства' },
  { key: 'btn.referral', title: 'Кнопка: Реферальная программа', kind: 'button', default: '🤝 Пригласить друга' },
];

export const TEXTS_BY_KEY: Record<string, TextDef> =
  Object.fromEntries(TEXTS.map((t) => [t.key, t]));
