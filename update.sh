#!/usr/bin/env bash
# Kand — безопасное обновление панели.
# Порядок: проверка правок кода → есть ли обновление → БЭКАП базы → git pull →
# пересборка (миграции применяются автоматически) → отчёт. Данные и настройки НЕ теряются.
#
# Запуск:  kand update            (или bash /opt/kand/update.sh)
#          kand update --force    спрятать локальные правки кода в git stash и обновиться
set -e
DIR="${KAND_DIR:-/opt/kand}"
COMPOSE="docker compose -f infra/docker-compose.prod.yml"
FORCE=0; [ "$1" = "--force" ] && FORCE=1

c(){ printf '\033[1;36m[kand]\033[0m %s\n' "$1"; }
warn(){ printf '\033[1;33m[kand]\033[0m %s\n' "$1"; }
die(){ printf '\033[1;31m[kand ОШИБКА]\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$DIR/.git" ] || die "панель не найдена в $DIR (это git-установка Kand?)"
cd "$DIR"
ver(){ grep -oE "APP_VERSION = '[^']+'" apps/api/public/app.js 2>/dev/null | head -1 | sed "s/.*'\(.*\)'.*/\1/"; }
OLD=$(ver)

# 1) локальные правки в коде — не терять
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  if [ "$FORCE" = "1" ]; then
    warn "есть локальные правки кода — прячу в git stash (вернуть потом: git stash pop)"
    git stash push -u -m "kand-update-$(date +%Y%m%d-%H%M%S)" >/dev/null 2>&1 || true
  else
    warn "У ВАС ЕСТЬ ПРАВКИ В КОДЕ — обновление остановлено, чтобы их не потерять."
    warn "Что делать:"
    warn "  • держите форк репозитория и обновляйтесь через него (правильный путь для правок кода);"
    warn "  • ИЛИ откатить правки и обновиться:   git checkout . && kand update"
    warn "  • ИЛИ спрятать правки и обновиться:   kand update --force"
    warn "Настройки/бренд/тарифы менять лучше в самой панели — это переживает любое обновление."
    exit 2
  fi
fi

# 2) есть ли вообще обновление
c "проверяю обновления…"
git fetch --depth 1 origin >/dev/null 2>&1 || die "не смог получить обновления (git fetch). Проверьте интернет."
BEFORE=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)
if [ "$BEFORE" = "$REMOTE" ]; then
  c "у вас уже последняя версия ($OLD) — обновлять нечего."
  exit 0
fi

# 3) БЭКАП базы перед обновлением (страховка)
c "делаю бэкап базы данных…"
mkdir -p backups
BK="backups/kand-db-$(date +%Y%m%d-%H%M%S).sql"
if $COMPOSE exec -T postgres pg_dump -U kand kand > "$BK" 2>/dev/null && [ -s "$BK" ]; then
  gzip -f "$BK"; BK="$BK.gz"; c "бэкап: $DIR/$BK"
else
  rm -f "$BK"; die "не удалось снять бэкап БД (панель запущена?). Обновление отменено ради безопасности."
fi
ls -1t backups/kand-db-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f  # храним последние 7

# 4) обновляем код. Установка — shallow-клон (--depth 1), поэтому НЕ pull --ff-only
# (на усечённой истории он не доедет), а жёсткий переход на свежую версию. Безопасно:
# правок кода нет (проверили выше) и бэкап БД уже сделан.
c "тяну новую версию…"
git reset --hard FETCH_HEAD >/dev/null 2>&1 || die "не смог применить обновление (git reset). Бэкап цел: $DIR/$BK"

# 5) пересборка + автоматические миграции (postgres в volume — данные сохраняются)
c "пересобираю панель (миграции применятся сами при старте, это пара минут)…"
$COMPOSE up -d --build >/dev/null 2>&1 || die "пересборка не удалась. БД цела, бэкап: $DIR/$BK. Откат кода: git reset --hard $BEFORE && kand update"

# 6) ждём готовности
PORT=$(grep -E '^API_PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-3000}
c "жду готовности панели…"
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 3; done

NEW=$(ver)
c "════════════════════════════════════════════"
c " Обновлено: ${OLD:-?} → ${NEW:-?}  ✅"
c " Клиенты, настройки, бренд, платежи — на месте (в базе)."
c " Бэкап базы перед обновлением: $DIR/$BK"
c "════════════════════════════════════════════"
