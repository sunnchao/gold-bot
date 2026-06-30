# Gold Bot Monorepo

Gold Bot is a gold and multi-symbol automated trading monorepo. It contains the Go trading engine, the NestJS AI analysis service, the dashboard, EA clients, and shared deployment/monitoring configuration.

## Services

| Service | Path | Runtime | Port |
|---------|------|---------|------|
| Trading engine | `cmd/`, `internal/` | Go 1.24 | `8880` |
| AI agents | `agents/` | NestJS / Node.js 20+ | `3100` |
| Dashboard | `web/dashboard/` | Next.js static export | served by Go |
| Redis | root compose | Redis 7 | `6379` internal |
| Prometheus | `prometheus.yml` | Prometheus | `9090` |
| Grafana | `grafana/` | Grafana | `3000` |

## Architecture

```text
MT4/MT5 EA -> Go trading engine (:8880)
AI agents (:3100) -> GET /api/v2/analysis_payload/:accountId/:symbol
AI agents (:3100) -> GET /api/ai_symbols/:accountId
AI agents (:3100) -> GET /api/pending_signal/:accountId/:symbol
AI agents (:3100) -> POST /api/v2/ai_result/:accountId/:symbol
Go trading engine -> EA /poll commands
Prometheus -> Go /metrics -> Grafana
```

Legacy Python scripts are retained under `legacy/python/`. New AI analysis work belongs in `agents/`.

## Quick Start

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yaml up -d

# Terminal 1: Go engine
go run cmd/server/main.go

# Terminal 2: AI agents
cd agents
npm ci
npm run dev

# Optional: dashboard build
cd web/dashboard
npm ci
npm run build
```

Local URLs:

- Go engine and dashboard: `http://localhost:8880`
- AI agents health: `http://localhost:3100/health`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

## Docker Deployment

```bash
cp .env.example .env
docker compose build app agents
docker compose up -d app agents redis prometheus grafana
```

The production compose keeps `1panel-network` as an external network and exposes service ports on `127.0.0.1`.

## Verification

```bash
go build ./...
go test ./... -count=1

cd agents
npm ci
npm run build
npm run test

cd web/dashboard
npm ci
npm run build

docker compose config
```

## Documentation

- [API contracts](docs/API_CONTRACTS.md)
- [Monorepo guide](docs/MONOREPO_GUIDE.md)
- [System architecture](docs/ARCHITECTURE.md)
- [HTTP API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Monitoring](docs/MONITORING.md)
