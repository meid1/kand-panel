# Миграция в Kand с других панелей

Переносим: **клиентов, устройства (ключи), платежи-архив, счётчики трафика,
метаданные серверов, промокоды**. Сами серверы (ноды) переустанавливаются нашим
`install-node.sh` — агент между панелями не мигрирует (так у всех).

## Шаг 1. Вытащить данные (CLI-экстрактор)
`tools/extract.mjs` читает чужую БД и пишет наш формат. Драйвер ставится по нужде:

```bash
npm i better-sqlite3            # 3x-ui, marzban(sqlite)
npm i mysql2                    # marzban(mysql)
npm i pg                        # remnawave, marzban(postgres)
```

Готовые пресеты:
```bash
# 3x-ui (SQLite, клиенты в JSON inbounds.settings, срок в мс)
node tools/extract.mjs --preset 3x-ui --db /etc/x-ui/x-ui.db --out import.json

# Marzban (у юзеров нет telegram_id → externalId = marzban_<username>)
node tools/extract.mjs --preset marzban --engine sqlite --db /var/lib/marzban/db.sqlite3 --out import.json
node tools/extract.mjs --preset marzban --engine mysql --conn "mysql://user:pass@host/marzban" --out import.json

# Remnawave (PostgreSQL, есть telegram_id и vless_uuid)
node tools/extract.mjs --preset remnawave --conn "postgresql://user:pass@host:5432/remnawave" --out import.json
```
Результат `import.json` = `{ users:[…], usage:[…] }`.

Своя/нестандартная база? Экспортируй в CSV/JSON и используй режим `mapping`
(карта «твоя колонка → наше поле», с обрезкой префиксов вроде `cat_`) — см. ниже.

## Шаг 2. Проверка без записи (dry-run)
Всегда сначала dry-run — покажет, сколько импортируется и что не так:
```bash
TOKEN=<jwt из /api/auth/login>
curl -sX POST https://<панель>/api/import/dry-run -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"source\":\"normalized\",\"entity\":\"users\",\"rows\":$(jq .users import.json)}"
```

## Шаг 3. Импорт
Порядок: **сначала users**, потом usage/payments (они привязываются к клиентам).
```bash
# клиенты + устройства
curl -sX POST .../api/import/run -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"source\":\"normalized\",\"entity\":\"users\",\"rows\":$(jq .users import.json)}"
# счётчики трафика/обхода
curl -sX POST .../api/import/run -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"source\":\"normalized\",\"entity\":\"usage\",\"rows\":$(jq .usage import.json)}"
```
Импорт **идемпотентен** (повторный прогон не задваивает — дедуп по externalId).

### Произвольная база (mapping)
```json
{ "source":"mapping", "entity":"users",
  "mapping": { "tgId":{"from":"id","stripPrefix":"cat_"}, "externalId":{"from":"id"},
               "expireAt":{"from":"paid_till"}, "devices":{"from":"key"} },
  "rows":[ ...сырые строки экспорта... ] }
```
Сущности: `users | payments | usage | nodes | promocodes`.

### Ноды (метаданные)
`entity:"nodes"` создаёт записи и **возвращает команды установки** — выполни их на
серверах, только тогда ноды заработают (агент не переносится).

## ⚠️ Если счётчик трафика перенёсся неправильно
Бывает, что чужой формат байт/лимитов разошёлся — клиент ошибочно «исчерпал лимит
обхода». Сброс счётчика (лимит/докупки НЕ трогает):

```bash
# один клиент (userId — наш id клиента)
curl -sX POST https://<панель>/api/bypass/<userId>/reset -H "Authorization: Bearer $TOKEN"

# ВСЕ клиенты сразу (после массового кривого импорта)
curl -sX POST https://<панель>/api/bypass/reset-all -H "Authorization: Bearer $TOKEN"
```
Сброс обнуляет использованный трафик (used=0), снимает блокировку обхода и
начинает период заново. В веб-админке то же — в карточке клиента.

## Единицы (частые грабли)
- **3x-ui**: `expiryTime` — **миллисекунды**; трафик/лимит — байты (не ГБ, хоть и «totalGB»).
- **Marzban**: `expire` — **секунды** (unix); лимиты/трафик — байты; telegram_id у юзеров нет.
- **Remnawave**: `expire_at` — timestamp; трафик — байты; `used_traffic` в отдельной таблице.
Экстрактор эти единицы уже приводит к нашему формату.
