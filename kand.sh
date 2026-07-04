#!/usr/bin/env bash
# Kand — управление панелью одной командой. Ставится install.sh как /usr/local/bin/kand.
DIR="${KAND_DIR:-/opt/kand}"
COMPOSE="docker compose -f infra/docker-compose.prod.yml"
cd "$DIR" 2>/dev/null || { echo "Kand не найден в $DIR (задайте KAND_DIR)"; exit 1; }

case "$1" in
  update)
    bash "$DIR/update.sh" "${@:2}" ;;
  backup)
    mkdir -p backups
    F="backups/kand-db-$(date +%Y%m%d-%H%M%S).sql"
    if $COMPOSE exec -T postgres pg_dump -U kand kand > "$F" 2>/dev/null && [ -s "$F" ]; then
      gzip -f "$F"; echo "бэкап: $DIR/$F.gz"
    else rm -f "$F"; echo "не удалось снять бэкап (панель запущена?)"; exit 1; fi ;;
  logs)    $COMPOSE logs -f --tail=100 api ;;
  restart) $COMPOSE restart api; echo "перезапущено" ;;
  up)      $COMPOSE up -d; echo "запущено" ;;
  down)    $COMPOSE down; echo "остановлено" ;;
  status)  $COMPOSE ps ;;
  version) grep -oE "APP_VERSION = '[^']+'" apps/api/public/app.js 2>/dev/null | sed "s/.*'\(.*\)'.*/версия: \1/" ;;
  *)
    echo "Kand — управление панелью:"
    echo "  kand update [--force]   обновить (сначала бэкап БД, данные не теряются)"
    echo "  kand backup             бэкап базы данных"
    echo "  kand logs               логи панели (Ctrl+C выйти)"
    echo "  kand restart|up|down    перезапуск / старт / остановка"
    echo "  kand status             статус контейнеров"
    echo "  kand version            текущая версия" ;;
esac
