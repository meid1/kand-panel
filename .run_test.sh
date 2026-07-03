#!/bin/bash
. /opt/vpanel/.autobuild_env
cd /opt/vpanel/apps/api
export DATABASE_URL="$(grep -E '^DATABASE_URL=' /opt/vpanel/.env | cut -d= -f2- | tr -d '"')"
export ADMIN_PASSWORD="test123" JWT_SECRET="testsecret_e2e" PANEL_URL="http://localhost:3000" API_PORT=3000 VPANEL_ROOT=/opt/vpanel
export BOT_TOKEN="$TEST_BOT_TOKEN"
exec node dist/main.js
