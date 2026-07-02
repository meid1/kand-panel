# Нода VPanel в контейнере: xray-core + vpanel-agent. Тот же bundle через env.
# Сборка:  docker build -t vpanel-node -f agent/Dockerfile .
# Запуск:  docker run -d --name vpanel-node --network host \
#            -e NODE_BUNDLE='<base64>' vpanel-node
# (host-сеть нужна для reality/inbound-портов и egress; иначе пробрось порты вручную.)

# ---- этап сборки агента ----
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY agent/go.mod agent/go.sum* ./
RUN go mod download 2>/dev/null || true
COPY agent/ ./
RUN CGO_ENABLED=0 go build -o /vpanel-agent ./...

# ---- рантайм ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl unzip bash python3 && \
    # xray-core
    curl -fsSL https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip -o /tmp/x.zip && \
    unzip -o /tmp/x.zip xray -d /usr/local/bin/ && chmod +x /usr/local/bin/xray && rm /tmp/x.zip && \
    mkdir -p /etc/vpanel /usr/local/etc/xray
COPY --from=build /vpanel-agent /usr/local/bin/vpanel-agent
COPY agent/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8443 443
ENTRYPOINT ["/entrypoint.sh"]
