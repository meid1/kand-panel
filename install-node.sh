#!/usr/bin/env bash
# VPanel — установка ноды ОДНОЙ КОМАНДОЙ. Запускается так (панель генерирует строку):
#   curl -fsSL https://panel/install-node.sh | NODE_ID=... PANEL_URL=... NODE_BUNDLE='<base64>' bash
#
# Ставит xray + vpanel-agent, раскладывает mTLS-серты и базовый xray-конфиг из
# bundle, поднимает systemd-юниты. Идемпотентно (повторный запуск = обновление).
set -euo pipefail

log(){ echo -e "\033[1;36m[vpanel]\033[0m $*"; }
die(){ echo -e "\033[1;31m[vpanel] ОШИБКА:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "нужен root"
[ -n "${NODE_BUNDLE:-}" ] || die "нет NODE_BUNDLE"
PANEL_URL="${PANEL_URL:-}"
command -v python3 >/dev/null || die "нужен python3"
command -v curl >/dev/null || die "нужен curl"

VPDIR=/etc/vpanel
mkdir -p "$VPDIR"

# ── 1. Распаковка bundle (cert/key/ca/jwt/agent_port/xray) через python3 ──────
log "распаковываю bundle…"
AGENT_PORT=$(NODE_BUNDLE="$NODE_BUNDLE" python3 - <<'PY'
import os,json,base64
b=json.loads(base64.b64decode(os.environ["NODE_BUNDLE"]))
open("/etc/vpanel/agent.crt","w").write(b["cert"])
open("/etc/vpanel/agent.key","w").write(b["key"])
open("/etc/vpanel/ca.crt","w").write(b["ca"])
open("/etc/vpanel/jwt","w").write(b["jwt"])
os.makedirs("/usr/local/etc/xray",exist_ok=True)
json.dump(b["xray"],open("/usr/local/etc/xray/config.json","w"),ensure_ascii=False,indent=1)
print(b.get("agent_port",8443))
PY
)
chmod 600 "$VPDIR/agent.key" "$VPDIR/jwt"
log "серты и xray-конфиг записаны, порт агента: $AGENT_PORT"

# ── 2. xray-core (официальный установщик, если ещё нет) ───────────────────────
if ! command -v xray >/dev/null; then
  log "ставлю xray-core…"
  bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null 2>&1 \
    || die "не удалось поставить xray"
else
  log "xray уже установлен ($(xray version 2>/dev/null | head -1))"
fi

# ── 3. vpanel-agent (качаем с панели; собранный бинарь панель отдаёт по /install) ─
AGENT_BIN=/usr/local/bin/vpanel-agent
if [ -n "$PANEL_URL" ]; then
  log "качаю агент с панели…"
  curl -fsSL "${PANEL_URL%/}/install/vpanel-agent" -o "$AGENT_BIN.new" 2>/dev/null \
    && mv "$AGENT_BIN.new" "$AGENT_BIN" && chmod +x "$AGENT_BIN" \
    || log "не удалось скачать агент с панели (проверь ${PANEL_URL}/install/vpanel-agent)"
fi
[ -x "$AGENT_BIN" ] || die "нет бинаря агента $AGENT_BIN (положи его на панель в /install/vpanel-agent)"

# ── 4. env-файл агента ────────────────────────────────────────────────────────
cat > "$VPDIR/agent.env" <<EOF
AGENT_LISTEN=:$AGENT_PORT
AGENT_CERT=$VPDIR/agent.crt
AGENT_KEY=$VPDIR/agent.key
AGENT_CA=$VPDIR/ca.crt
AGENT_JWT_SECRET=$(cat "$VPDIR/jwt")
XRAY_CONFIG=/usr/local/etc/xray/config.json
XRAY_BIN=/usr/local/bin/xray
XRAY_API=127.0.0.1:10085
EOF
chmod 600 "$VPDIR/agent.env"

# ── 5. systemd-юнит агента ────────────────────────────────────────────────────
cat > /etc/systemd/system/vpanel-agent.service <<EOF
[Unit]
Description=VPanel node agent (mTLS)
After=network.target xray.service
Wants=xray.service

[Service]
EnvironmentFile=$VPDIR/agent.env
ExecStart=$AGENT_BIN
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# ── 5b. базовая защита ядра (безопасно, всегда) ────────────────────────────────
cat > /etc/sysctl.d/99-vpanel.conf <<'SYS'
# защита от SYN-флуда и мелкий тюнинг сети
net.ipv4.tcp_syncookies=1
net.ipv4.tcp_max_syn_backlog=4096
net.core.somaxconn=4096
net.ipv4.conf.all.rp_filter=1
SYS
sysctl -p /etc/sysctl.d/99-vpanel.conf >/dev/null 2>&1 || true

# ── 5c. ОПЦИОНАЛЬНЫЙ фаервол (per-IP лимит + агент только с IP панели) ─────────
# Включается HARDEN_FIREWALL=1. Default drop, НО: активная SSH-сессия (established)
# и SSH-порт всегда открыты — отрезать себя нельзя. Если nft не применится —
# правила просто не встанут (атомарно), инсталл не ломается.
if [ "${HARDEN_FIREWALL:-0}" = "1" ]; then
  log "включаю фаервол ноды…"
  command -v nft >/dev/null || { apt-get update -qq && apt-get install -y -qq nftables >/dev/null 2>&1; } || true
  # порты VPN из xray-конфига (без api), раздельно tcp/udp
  VPN_PORTS=$(python3 - <<'PY'
import json
d=json.load(open("/usr/local/etc/xray/config.json"))
print(",".join(str(i["port"]) for i in d["inbounds"] if i.get("tag")!="api"))
PY
)
  SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}'); SSH_PORT=${SSH_PORT:-22}
  # IP панели (для доступа к агенту 8443)
  PANEL_HOST=$(echo "${PANEL_URL:-}" | sed -E 's#^https?://##; s#[:/].*##')
  PANEL_IP=$(getent hosts "$PANEL_HOST" 2>/dev/null | awk '{print $1}' | head -1)
  AGENT_RULE="tcp dport $AGENT_PORT accept"
  [ -n "$PANEL_IP" ] && AGENT_RULE="tcp dport $AGENT_PORT ip saddr $PANEL_IP accept"
  PORTSET="{ ${VPN_PORTS:-443} }"
  # ЩЕДРЫЙ per-IP лимит: важно НЕ мешать реальным клиентам. За одним IP могут быть
  # ТЫСЯЧИ абонентов моб.оператора (CGNAT) + активный сёрфинг открывает много
  # соединений. Поэтому по умолчанию высокий (ловит только флуд-уровень), настраивается
  # VPN_CONN_RATE / VPN_CONN_BURST. Хочешь без лимита вовсе — не ставь HARDEN_FIREWALL.
  RATE="${VPN_CONN_RATE:-300}"; BURST="${VPN_CONN_BURST:-600}"
  if nft -f - <<NFT 2>/tmp/nfterr
table inet vpanel {
  chain input {
    type filter hook input priority filter; policy drop;
    ct state established,related accept
    ct state invalid drop
    iif "lo" accept
    ip protocol icmp icmp type echo-request limit rate 5/second accept
    tcp dport $SSH_PORT accept
    $AGENT_RULE
    # per-IP лимит НОВЫХ подключений к VPN-портам (щедрый — режет только флуд,
    # обычного/CGNAT-клиента не трогает). Сверх лимита — падает в default drop.
    tcp dport $PORTSET ct state new meter vpn4 { ip saddr limit rate $RATE/second burst $BURST packets } accept
    tcp dport $PORTSET ct state established,related accept
    udp dport $PORTSET accept
  }
}
NFT
  then
    systemctl enable nftables >/dev/null 2>&1 || true
    nft list ruleset > /etc/nftables.conf 2>/dev/null || true
    log "фаервол включён (SSH-порт $SSH_PORT открыт; агент ${PANEL_IP:+только с $PANEL_IP})"
  else
    log "фаервол НЕ применён (nft: $(cat /tmp/nfterr 2>/dev/null | head -1)) — пропускаю, инсталл продолжается"
  fi
fi

# ── 6. запуск ─────────────────────────────────────────────────────────────────
log "проверяю xray-конфиг…"
xray -test -c /usr/local/etc/xray/config.json >/dev/null 2>&1 || die "xray-конфиг невалиден"
systemctl daemon-reload
systemctl enable --now xray >/dev/null 2>&1 || true
systemctl restart xray
systemctl enable --now vpanel-agent >/dev/null 2>&1 || systemctl restart vpanel-agent

sleep 1
if systemctl is-active --quiet vpanel-agent && systemctl is-active --quiet xray; then
  log "✅ нода установлена. xray + агент запущены (порт агента $AGENT_PORT, mTLS)."
  log "   Панель подключится к ней автоматически при ближайшем reconcile."
else
  die "агент/xray не поднялись — смотри: journalctl -u vpanel-agent -u xray -n 40"
fi
