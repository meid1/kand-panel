# Kand API (+ встроенный бинарь агента для раздачи). Prod-образ.
# NB: собери и протестируй `docker build .` перед публикацией (в этом окружении
# Docker недоступен, поэтому образ не билд-тестирован — логика приложения проверена на хосте).

# ── этап 1: сборка Go-агента (его раздаёт /install/vpanel-agent) ──
FROM golang:1.22-alpine AS agent
WORKDIR /a
COPY agent/ ./
RUN go build -o vpanel-agent ./...

# ── этап 2: сборка и запуск API ──
# node:20-slim (Debian), НЕ alpine: Prisma-движку нужен openssl/libssl (на alpine/musl
# движок не грузится — "Could not parse schema engine response").
FROM node:20-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY . .
COPY --from=agent /a/vpanel-agent ./agent/vpanel-agent
RUN npm install --no-audit --no-fund \
 && npm run prisma:generate \
 && npm --prefix apps/api run build
ENV VPANEL_ROOT=/app
EXPOSE 3000
# накатываем схему и стартуем
CMD ["sh","-c","npm run prisma:push && node apps/api/dist/main.js"]
