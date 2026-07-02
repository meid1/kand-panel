# Kand

Открытая (AGPLv3) панель управления VPN на xray-core (VLESS-Reality / gRPC / Hysteria2 / XHTTP)
с умной маршрутизацией и нативной интеграцией с Telegram. Ноды подключаются одной командой,
без SSH (mTLS + JWT).

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
- `docs/routing.md` — умная маршрутизация, YouTube, обход, защита нод.
- `docs/migration.md` — перенос клиентов/платежей/трафика/нод + сброс счётчика.

## Безопасность
Исходный код открыт. Не коммить `.env`. Смени `ADMIN_PASSWORD` и `JWT_SECRET`. Для нод под нагрузкой —
хостинг с анти-DDoS (локальные лимиты не спасают от объёмного флуда). Нашёл уязвимость — см. `SECURITY.md`.

## Лицензия
[AGPL-3.0-only](LICENSE). Если запускаешь Kand как публичный сервис — обязан открыть свои изменения.
