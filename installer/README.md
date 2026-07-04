# Kand installer — «Установить за меня»

Маленький сервис, который по запросу с сайта (`setup.html`) заходит на сервер клиента
по SSH и запускает `install.sh` с выбранными опциями, стримя лог обратно.

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
location /api/install {
  proxy_pass http://127.0.0.1:8091;
  proxy_read_timeout 1200s;
  proxy_buffering off;
}
```

## systemd
См. `kand-installer.service` (положить в /etc/systemd/system/, `systemctl enable --now kand-installer`).
