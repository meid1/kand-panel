#!/usr/bin/env bash
# Kand — установка ПАНЕЛИ одной командой. Ставит Docker, тянет код, генерит .env
# с секретами, поднимает postgres+redis+api. Идемпотентно (повторный запуск = обновление).
#
# Простой запуск (интерактивно спросит домен):
#   curl -fsSL https://get.<домен>/install.sh | bash
#
# Неинтерактивно (для веб-конфигуратора «выбрал опции → одна команда»):
#   curl -fsSL https://get.<домен>/install.sh | bash -s -- --domain vpn.example.com --https
#   ... либо через переменные окружения KAND_DOMAIN, KAND_HTTPS, KAND_ADMIN_PASSWORD и т.д.
#
# Флаги / переменные:
#   --domain <d>        KAND_DOMAIN         домен/хост панели (иначе — IP сервера)
#   --https             KAND_HTTPS=1        поставить nginx + Let's Encrypt (нужен домен, указывающий на сервер)
#   --port <n>          KAND_PORT           внешний порт API (по умолч. 3000; при --https не публикуется наружу)
#   --password <p>      KAND_ADMIN_PASSWORD пароль админки (иначе сгенерится)
#   --bot-token <t>     KAND_BOT_TOKEN      токен клиентского Telegram-бота (опц.)
#   --dir <path>        KAND_DIR            каталог установки (по умолч. /opt/kand)
#   --repo <git-url>    KAND_REPO           репозиторий кода (по умолч. публичный kand-panel)
#   --email <e>         KAND_EMAIL          email для Let's Encrypt (опц.)
#   --yes               KAND_YES=1          не задавать вопросов (принять умолчания)
set -euo pipefail

log(){  echo -e "\033[1;36m[kand]\033[0m $*"; }
warn(){ echo -e "\033[1;33m[kand]\033[0m $*"; }
die(){  echo -e "\033[1;31m[kand] ОШИБКА:\033[0m $*" >&2; exit 1; }

# ── параметры (флаги перекрывают переменные окружения) ──────────────────────
DOMAIN="${KAND_DOMAIN:-}"; HTTPS="${KAND_HTTPS:-0}"; PORT="${KAND_PORT:-3000}"
ADMIN_PASSWORD="${KAND_ADMIN_PASSWORD:-}"; BOT_TOKEN="${KAND_BOT_TOKEN:-}"
DIR="${KAND_DIR:-/opt/kand}"; REPO="${KAND_REPO:-https://github.com/meid1/kand-panel.git}"
EMAIL="${KAND_EMAIL:-}"; ASSUME_YES="${KAND_YES:-0}"
PROTOCOLS="${KAND_PROTOCOLS:-}"; DISABLE="${KAND_DISABLE:-}"; ENABLE="${KAND_ENABLE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2;;
    --https) HTTPS=1; shift;;
    --port) PORT="$2"; shift 2;;
    --password) ADMIN_PASSWORD="$2"; shift 2;;
    --bot-token) BOT_TOKEN="$2"; shift 2;;
    --dir) DIR="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --email) EMAIL="$2"; shift 2;;
    --protocols) PROTOCOLS="$2"; shift 2;;   # список протоколов по умолчанию для новых нод
    --disable) DISABLE="$2"; shift 2;;        # выключить возможности (через запятую): tickets,gifts,…
    --enable) ENABLE="$2"; shift 2;;          # включить дополнительные (по умолч. выкл)
    --yes|-y) ASSUME_YES=1; shift;;
    *) die "неизвестный флаг: $1";;
  esac
done

[ "$(id -u)" = "0" ] || die "нужен root (sudo)"
command -v curl >/dev/null || die "нужен curl"

# ── 0. домен (интерактивно, если не задан и есть терминал) ───────────────────
if [ -z "$DOMAIN" ] && [ "$ASSUME_YES" != "1" ] && [ -t 0 ]; then
  read -rp "Домен панели (Enter — использовать IP сервера): " DOMAIN || true
fi
SERVER_IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
HOST="${DOMAIN:-$SERVER_IP}"
[ -n "$HOST" ] || die "не удалось определить адрес (укажи --domain)"
if [ -z "$DOMAIN" ] && [ "$HTTPS" = "1" ]; then warn "HTTPS без домена невозможен — ставлю по HTTP"; HTTPS=0; fi

# ── 1. зависимости: git, docker, compose ────────────────────────────────────
log "проверяю зависимости…"
export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git >/dev/null || die "не смог поставить git"
fi
if ! command -v docker >/dev/null; then
  log "ставлю Docker (get.docker.com)…"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "не смог поставить Docker"
fi
docker compose version >/dev/null 2>&1 || die "нужен docker compose v2 (обнови Docker)"
systemctl enable --now docker >/dev/null 2>&1 || true

# ── 2. код: clone или update ─────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  log "обновляю код в $DIR…"; git -C "$DIR" pull --ff-only >/dev/null 2>&1 || warn "git pull не удался — продолжаю на текущем коде"
else
  log "клонирую код в $DIR…"; rm -rf "$DIR"; git clone --depth 1 "$REPO" "$DIR" >/dev/null 2>&1 || die "не смог клонировать $REPO (репозиторий приватный? укажи --repo с доступом)"
fi
cd "$DIR"

# ── 3. .env (секреты генерим один раз; при повторной установке сохраняем) ────
rnd(){ head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "${1:-32}"; }
if [ -f .env ]; then
  log ".env уже есть — сохраняю секреты, обновляю адрес"
  get(){ grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(get ADMIN_PASSWORD)}"
  JWT_SECRET="$(get JWT_SECRET)"; POSTGRES_PASSWORD="$(get POSTGRES_PASSWORD)"
  BOT_TOKEN="${BOT_TOKEN:-$(get BOT_TOKEN)}"
fi
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(rnd 20)}"
JWT_SECRET="${JWT_SECRET:-$(rnd 48)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(rnd 24)}"
if [ "$HTTPS" = "1" ]; then PANEL_URL="https://$DOMAIN"; PUBLISH_PORT="127.0.0.1:${PORT}"; else PANEL_URL="http://${HOST}:${PORT}"; PUBLISH_PORT="${PORT}"; fi

cat > .env <<EOF
# Сгенерировано install.sh — не коммить, храни секреты.
API_PORT=${PORT}
PANEL_URL=${PANEL_URL}
CORS_ORIGIN=
ADMIN_PASSWORD=${ADMIN_PASSWORD}
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
BOT_TOKEN=${BOT_TOKEN}
DEFAULT_PROTOCOLS=${PROTOCOLS}
FEATURES_DISABLED=${DISABLE}
FEATURES_ENABLED=${ENABLE}
EOF
chmod 600 .env

# ── 4. запуск стека ──────────────────────────────────────────────────────────
log "собираю и поднимаю панель (это займёт пару минут при первом запуске)…"
API_PORT="$PUBLISH_PORT" docker compose -f infra/docker-compose.prod.yml up -d --build >/dev/null 2>&1 \
  || die "docker compose не поднялся — смотри: cd $DIR && docker compose -f infra/docker-compose.prod.yml logs api"

# ждём готовности API
log "жду готовности API…"
for i in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 && break
  sleep 3; [ "$i" = "60" ] && warn "API долго не отвечает — проверь логи (docker compose logs api)"
done

# ── 5. HTTPS через nginx + certbot (опционально) ─────────────────────────────
if [ "$HTTPS" = "1" ]; then
  log "настраиваю nginx + HTTPS для $DOMAIN…"
  apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null 2>&1 || warn "не смог поставить nginx/certbot"
  cat > /etc/nginx/sites-available/kand.conf <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/kand.conf /etc/nginx/sites-enabled/kand.conf
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || warn "nginx конфиг не применился"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "${EMAIL:-admin@$DOMAIN}" --redirect >/dev/null 2>&1 \
    && log "HTTPS выдан" || warn "certbot не выдал сертификат (проверь, что $DOMAIN указывает A-записью на этот сервер)"
fi

# ── команда управления `kand` ────────────────────────────────────────────────
chmod +x "$DIR/kand.sh" "$DIR/update.sh" 2>/dev/null || true
mkdir -p "$DIR/backups"
if [ -f "$DIR/kand.sh" ]; then ln -sf "$DIR/kand.sh" /usr/local/bin/kand 2>/dev/null || true; fi

# ── ежедневный авто-бэкап БД (systemd-таймер) ─────────────────────────────────
if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/kand-backup.service <<SVC
[Unit]
Description=Kand — авто-бэкап БД
[Service]
Type=oneshot
ExecStart=/usr/local/bin/kand backup
SVC
  cat > /etc/systemd/system/kand-backup.timer <<TMR
[Unit]
Description=Kand — ежедневный бэкап БД
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
TMR
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable --now kand-backup.timer 2>/dev/null || true
  log "авто-бэкап БД: ежедневно 04:30 (kand backup, хранит 14 последних)"
fi

# ── итог ─────────────────────────────────────────────────────────────────────
echo
log "════════════════════════════════════════════"
log " Kand установлен ✅"
log " Панель:  ${PANEL_URL}"
log " Логин:   admin"
log " Пароль:  ${ADMIN_PASSWORD}"
log "════════════════════════════════════════════"
log " Обновление:  kand update      (с бэкапом БД, данные не теряются)"
log " Управление:  kand logs | restart | backup | status"
[ "$HTTPS" = "1" ] || warn "Совет: для боевого использования поставь домен и перезапусти с --https."
