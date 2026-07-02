# Kand

Открытая (AGPLv3) панель управления VPN на xray-core (VLESS-Reality / gRPC / Hysteria2 / XHTTP)
с умной маршрутизацией и нативной интеграцией с Telegram. Ноды подключаются одной командой,
без SSH (mTLS + JWT).

> 💬 **Поможем с установкой и переносом клиентов** — пиши в Telegram **[@marius_support](https://t.me/marius_support)**.

## Чем отличается от Remnawave / Marzban / 3x-ui
- 🇷🇺 **Умная маршрутизация**: РФ-сервисы (банки, госуслуги, маркетплейсы) — напрямую, остальное — через VPN.
- ▶️ **YouTube без рекламы** — через ноду с ролью РФ-выхода.
- 🛡 **Обход белых списков с лимитом ГБ** — учёт трафика, докупка/списание, авто-стоп при исчерпании.
- 🤖 **Клиентский Telegram-бот** — приветствие/кнопки/подписка/оплата/триал, все тексты правятся в вебе.
- 💳 **7 платёжек РУ-рынка** из коробки: ЮKassa, Platega, RollyPay, Wata, Lava, CryptoBot, Cryptomus.
- 🏷 **Франшизы (опционально)** — свой бренд/бот/домен, изоляция клиентов; без них панель одиночная.
- 🔁 **Миграция** с 3x-ui / Marzban / Remnawave (готовые пресеты) + импорт любой базы по маппингу.
- 🔒 Безопасность заложена: mTLS нод, аудит действий, rate-limit, проверка подписей платёжек.

## Стек
NestJS + PostgreSQL (Prisma) + Redis. Ноды — xray-core + Go-агент (mTLS+JWT). Веб-админка — статика.

## Быстрый старт (dev)
```bash
cp .env.example .env          # заполни ADMIN_PASSWORD, JWT_SECRET, PANEL_URL
npm install
docker compose -f infra/docker-compose.dev.yml up -d   # postgres + redis
npm run prisma:push                                    # накатить схему
npm --prefix apps/api run build && node apps/api/dist/main.js
# админка: http://localhost:3000  (вход по ADMIN_PASSWORD)
```

## Прод (docker-compose)
```bash
cp .env.example .env          # выставь секреты
docker compose -f infra/docker-compose.prod.yml up -d --build
```

## Добавление ноды (одной командой)
В админке «Ноды → добавить» → скопируй команду вида `curl -fsSL https://<панель>/install-node.sh | ... bash`
и выполни на сервере ноды. Он поставит xray + агент, сам подключится к панели. Защита нод от DDoS:
`HARDEN_FIREWALL=1` (см. `docs/routing.md`).

## Миграция с других панелей
Экстрактор `tools/extract.mjs` (3x-ui / Marzban / Remnawave) → dry-run → импорт. Полностью: `docs/migration.md`.

## Документация
- `docs/install.md` — установка «с нуля» для новичка (пошагово).
- `docs/routing.md` — умная маршрутизация, YouTube, обход, защита нод.
- `docs/migration.md` — перенос клиентов/платежей/трафика/нод + сброс счётчика.

## Структура проекта (что где)
```
apps/api/            — бэкенд (NestJS) и веб-админка
  src/auth           — вход по паролю → JWT, анти-брутфорс
  src/crypto         — своя CA, mTLS-сертификаты нод, ключи Reality
  src/nodes          — CRUD нод + генерация команды установки «одной командой»
  src/nodes-agent    — mTLS-клиент к агентам нод (apply/state/health/stats)
  src/reconcile      — раскатка ключей по нодам (идемпотентно)
  src/users          — клиенты (изоляция по тенанту, триал)
  src/devices        — устройства = vless-uuid + токен подписки
  src/subscription   — выдача подписки: список ссылок + умный xray-конфиг (RU-direct, YouTube)
  src/bypass         — обход белых списков: лимит ГБ, докупка/списание, сброс счётчика
  src/stats          — сбор трафика с нод (раз в 5 мин) → лимиты
  src/payments       — реестр платёжек (ЮKassa/Platega/RollyPay/Wata/Lava/CryptoBot/Cryptomus)
  src/settings       — тексты/кнопки бота (не пустые, из БД или дефолт) + бренд
  src/broadcast      — рассылка через бота (текст и копия с премиум-эмодзи)
  src/import         — импорт базы (users/payments/usage/nodes/promocodes) + маппинг
  src/tenants        — франшизы (опционально): бренд/бот/домен, изоляция
  src/bot            — клиентский Telegram-бот (меню/подписка/оплата/триал)
  src/cabinet        — клиентский веб-кабинет (/cabinet/<токен>)
  src/audit          — аудит действий в админке (секреты скрыты)
  src/install        — раздача install-node.sh и бинаря агента
  public/            — веб-админка (index.html/app.js) и кабинет (cabinet.html)
agent/               — Go-агент ноды (xray reconcile, mTLS+JWT, /stats) + Dockerfile
packages/db/         — схема БД (Prisma/PostgreSQL)
tools/extract.mjs    — экстрактор для миграции (SQLite/MySQL/PostgreSQL)
docs/                — install / routing / migration
infra/               — docker-compose (dev и prod)
```

## Безопасность
Исходный код открыт. Не коммить `.env`. Смени `ADMIN_PASSWORD` и `JWT_SECRET`. Для нод под нагрузкой —
хостинг с анти-DDoS (локальные лимиты не спасают от объёмного флуда). Нашёл уязвимость — см. `SECURITY.md`.

## Лицензия
[AGPL-3.0-only](LICENSE). Если запускаешь Kand как публичный сервис — обязан открыть свои изменения.
