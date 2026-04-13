FROM node:22-bookworm-slim AS dashboard-builder

ARG PREBUILT_DASHBOARD=false
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /src/web/dashboard

COPY web/dashboard/package.json web/dashboard/package-lock.json ./
RUN if [ "$PREBUILT_DASHBOARD" = "false" ]; then npm ci; fi
COPY web/dashboard/ ./
RUN if [ "$PREBUILT_DASHBOARD" = "false" ]; then npm run build; fi

FROM golang:1.24-bookworm AS go-builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=dashboard-builder /src/web/dashboard/dist ./web/dashboard/dist

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -o /out/gold-bot ./cmd/server

FROM debian:bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN useradd --system --create-home --uid 10001 goldbot && \
    mkdir -p /data /app/web/dashboard && \
    chown -R goldbot:goldbot /app /data

COPY --from=go-builder /out/gold-bot /app/gold-bot
COPY --from=go-builder /src/web/dashboard/dist /app/web/dashboard/dist
COPY --from=go-builder /src/mt4_ea /app/mt4_ea
COPY --from=go-builder /src/mt5_ea /app/mt5_ea

ENV GB_HTTP_ADDR=:8880
ENV GB_DB_PATH=/data/gold_bolt.sqlite

EXPOSE 8880

USER goldbot

CMD ["/app/gold-bot"]
