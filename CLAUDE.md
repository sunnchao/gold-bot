# Gold Bot Monorepo

Gold Bot is a Node.js-based monorepo for the trading engine, AI analysis agents, dashboard, and shared packages.

## Architecture

| Component | Path | Runtime | Port |
|-----------|------|---------|------|
| **Trading Engine** | `apps/app-server` | Node.js 20+ | `3000` (dev) / `8880` (prod) |
| **AI Agents** | `agents/` | NestJS 11 / Node.js 20+ | `3100` |
| **Dashboard** | `web/dashboard/` | Next.js 15 static export | served by app-server |
| **Shared Packages** | `packages/*` | TypeScript libraries | n/a |
| **Legacy Python** | `legacy/python/` | Python (archived) | n/a |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `@gold-bot/trading-core` | SMC, harmonics, indicators, replay engine, risk gate |
| `@gold-bot/persistence` | SQLite/PostgreSQL stores, migrations |
| `@gold-bot/observability` | Prometheus metrics, SSE, shadow validation |
| `@gold-bot/notifications` | Discord/Feishu webhooks |
| `@gold-bot/config` | Environment variable parsing |
| `@gold-bot/shared-contracts` | Shared TypeScript types |
| `@gold-bot/breakout-cache` | Breakout detection cache |

## Local Development

```bash
# Install dependencies
pnpm install

# Shared local infrastructure (Redis)
docker compose -f docker-compose.dev.yaml up -d

# Build all packages
pnpm -w run build

# Run tests
pnpm -w run test

# Trading engine (development mode)
pnpm --filter app-server dev

# AI agents (separate terminal)
cd agents
npm ci
npm run dev

# Dashboard (build only, served by app-server)
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

The production compose file exposes (localhost only):

- Node.js trading engine: `127.0.0.1:8880`
- AI agents: `127.0.0.1:3100`
- Prometheus: `127.0.0.1:9090`
- Grafana: `127.0.0.1:3000`

## Data Flow

```text
MT4/MT5 EA -> Node.js app-server (:8880) -> state, strategy, pending signal
AI agents (:3100) -> GET analysis payload from app-server
AI agents (:3100) -> POST AI result and trade plan to app-server
Node.js app-server -> EA poll endpoint -> trading commands
Prometheus -> app-server /metrics -> Grafana dashboards
```

## API Routes

The Node.js trading engine (`apps/app-server`) exposes:

### EA Legacy Routes
- `POST /register` - EA registration
- `POST /heartbeat` - Account runtime updates
- `POST /tick` - Tick data
- `POST /bars` - Bar data (OHLCV + indicators)
- `POST /positions` - Position updates
- `GET /poll` - Poll trading commands
- `POST /order_result` - Order execution results

### AI Routes
- `GET /api/analysis_payload/{account}` - Legacy single-symbol payload
- `GET /api/v2/analysis_payload/{account}/{symbol}` - Multi-symbol payload
- `POST /api/ai_result/{account}` - Legacy single-symbol result
- `POST /api/v2/ai_result/{account}/{symbol}` - Multi-symbol result

### Admin Routes
- `GET /api/symbols/{account}` - List symbols for account
- `GET /api/pending_signal/{account}/{symbol}` - Get pending signals
- `POST /api/arbitration/{signal_id}` - Approve/reject signal
- `POST /api/arbitration/expire` - Expire stale signals
- `GET /api/tokens` - List API tokens (admin)
- `POST /api/tokens` - Create API token (admin)
- `DELETE /api/tokens/{prefix}` - Revoke API token (admin)
- `GET /api/v1/accounts` - List accounts (admin)
- `GET /api/v1/accounts/{id}` - Account detail (admin)
- `GET /api/v1/overview` - Overview dashboard (admin)
- `GET /api/v1/audit` - Audit data (admin)
- `GET /api/v1/events/stream` - SSE event stream (admin)

### Observability Routes
- `GET /healthz` - Health check
- `GET /metrics` - Prometheus metrics (23 goldbot_* metrics)
- `GET /shadow/metrics` - Shadow validation metrics
- `GET /shadow/qualification` - Cutover readiness report
- `POST /shadow/comparisons` - Record oracle comparison (internal)

## API Contracts

Runtime schemas for the agents live in `agents/src/types/schemas.ts`.

For historical Go → AI agents API contracts, see `docs/API_CONTRACTS.md` (archived).
