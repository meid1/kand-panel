#!/bin/bash
# Контейнерный старт ноды: разложить bundle → поднять xray → запустить агент.
set -e
[ -n "${NODE_BUNDLE:-}" ] || { echo "нет NODE_BUNDLE"; exit 1; }

NODE_BUNDLE="$NODE_BUNDLE" python3 - <<'PY'
import os,json,base64
b=json.loads(base64.b64decode(os.environ["NODE_BUNDLE"]))
open("/etc/vpanel/agent.crt","w").write(b["cert"])
open("/etc/vpanel/agent.key","w").write(b["key"])
open("/etc/vpanel/ca.crt","w").write(b["ca"])
open("/etc/vpanel/jwt","w").write(b["jwt"])
json.dump(b["xray"],open("/usr/local/etc/xray/config.json","w"),ensure_ascii=False,indent=1)
open("/etc/vpanel/agent_port","w").write(str(b.get("agent_port",8443)))
PY
chmod 600 /etc/vpanel/agent.key /etc/vpanel/jwt

export AGENT_LISTEN=":$(cat /etc/vpanel/agent_port)"
export AGENT_CERT=/etc/vpanel/agent.crt AGENT_KEY=/etc/vpanel/agent.key AGENT_CA=/etc/vpanel/ca.crt
export AGENT_JWT_SECRET="$(cat /etc/vpanel/jwt)"
export XRAY_CONFIG=/usr/local/etc/xray/config.json XRAY_BIN=/usr/local/bin/xray XRAY_API=127.0.0.1:10085

xray -test -c "$XRAY_CONFIG" || { echo "xray-конфиг невалиден"; exit 1; }
xray -c "$XRAY_CONFIG" &   # агент сам супервизит xray (Supervise), но стартуем и тут
exec /usr/local/bin/vpanel-agent
