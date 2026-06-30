# Gold Bot Monorepo

Gold Bot is a monorepo for the trading engine, AI analysis agents, dashboard, and shared deployment assets.

## Components

| Path | Component | Runtime | Port |
|------|-----------|---------|------|
| `cmd/`, `internal/` | Trading engine and EA HTTP API | Go 1.24 | `8880` |
| `agents/` | AI analysis service | NestJS 11 / Node.js 20+ | `3100` |
| `web/dashboard/` | Monitoring dashboard | Next.js static export | served by Go |
| `legacy/python/` | Legacy Python scripts | Python | n/a |
| `mt4_ea/`, `mt5_ea/` | EA clients | MQL | n/a |

## Local Development

```bash
# Shared local infrastructure
docker compose -f docker-compose.dev.yaml up -d

# Trading engine
go run cmd/server/main.go

# AI agents
cd agents
npm ci
npm run dev

# Dashboard
cd web/dashboard
npm ci
npm run build
```

## Docker Deployment

```bash
cp .env.example .env
docker compose build app agents
docker compose up -d app agents redis prometheus grafana
```

The production compose file exposes:

- Go engine: `127.0.0.1:8880`
- AI agents: `127.0.0.1:3100`
- Prometheus: `127.0.0.1:9090`
- Grafana: `127.0.0.1:3000`

## Data Flow

```text
MT4/MT5 EA -> Go engine (:8880) -> state, strategy, pending signal
AI agents (:3100) -> GET Go analysis payload and pending signal
AI agents (:3100) -> POST AI result and trade plan back to Go
Go engine -> EA poll endpoint -> trading commands
Prometheus -> Go metrics -> Grafana dashboards
```

## API Contracts

The Go Engine to AI Agents API contract is documented in `docs/API_CONTRACTS.md`.
Runtime schemas for the agents live in `agents/src/types/schemas.ts`.
