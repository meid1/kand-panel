# Kand installer — «Установить за меня» + переезд с других панелей

Маленький сервис, который по запросу с сайта заходит на сервер клиента по SSH:
- `setup.html` → `POST /api/install` — устанавливает Kand с выбранными опциями;
- `migrate.html` → `POST /api/migrate` — переносит клиентов с 3x-ui / Marzban / Remnawave
  в уже установленный Kand (бэкап базы источника → извлечение `tools/extract.mjs` →
  импорт в целевую панель через её `/api/import`; ссылки 3x-ui/Remnawave сохраняются).

Оба стримят лог: `GET /api/install/:id` и `GET /api/migrate/:id`.
Для миграции SQLite-источников (3x-ui, marzban-sqlite) нужен `better-sqlite3`, для
mysql/postgres — `mysql2`/`pg` (ставятся по нужде на сервере установщика).

## Безопасность
- Пароль сервера клиента — **только в оперативной памяти** на время установки. Не пишется
  в БД, не в лог, стирается после. Никакого хранения.
- Строгая валидация IP/логина/опций (белый список символов) → нет shell-инъекций
  (ssh-аргументы передаются массивом, не строкой шелла).
- Рейт-лимит: не больше `MAX_CONCURRENT` установок разом + кулдаун `COOLDOWN_MS` на IP клиента.
- Тайм-аут установки 20 минут.

## Запуск
```
PORT=8091 INSTALL_SH=/opt/kand-landing/install.sh node server.mjs
```
Нужен `sshpass` в системе. Слушает `127.0.0.1:PORT` (наружу — только через nginx).

## nginx (на kandpanel.com)
```
location /api/ {           # /api/install*, /api/migrate*
  proxy_pass http://127.0.0.1:8091;
  proxy_read_timeout 1200s;
  proxy_buffering off;
}
```

## systemd
См. `kand-installer.service` (положить в /etc/systemd/system/, `systemctl enable --now kand-installer`).
