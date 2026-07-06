# Gold Bot Monorepo

Gold Bot is a Node.js-based automated trading system for gold and multi-symbol trading. This monorepo contains the trading engine, AI analysis agents, monitoring dashboard, and shared packages.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         MT4/MT5 EA Clients                      │
│                  (mt4_ea/, mt5_ea/ - archived)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/JSON
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Node.js Trading Engine (app-server)                │
│                         Port 8880                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ EA Routes: /register, /heartbeat, /tick, /bars, /poll   │  │
│  │ AI Routes: /api/analysis_payload, /api/ai_result        │  │
│  │ Admin: /api/tokens, /api/v1/accounts, /api/v1/overview  │  │
│  │ Metrics: /metrics, /healthz, /shadow/*                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Core Services:                                                 │
│  • Analysis Scheduler   • Arbitration Manager                  │
│  • Shadow Validation    • Command Lifecycle                    │
│  • AI Approve Gate      • Notification (Discord/Feishu)        │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐
  │   Agents      │  │  Dashboard   │  │  Prometheus  │
  │   (NestJS)    │  │  (Next.js)   │  │   + Grafana  │
  │   Port 3100   │  │  Static      │  │  9090 / 3000 │
  └───────────────┘  └──────────────┘  └──────────────┘
          │
          ▼
  ┌───────────────┐
  │  Redis (7.x)  │
  │  Port 6379    │
  └───────────────┘
```

## Directory Structure

```
gold-bot/
├── apps/                           # Applications
│   ├── app-server/                 # Node.js trading engine (port 8880)
│   │   ├── src/
│   │   │   ├── routes/            # HTTP route handlers
│   │   │   ├── services/          # Background services
│   │   │   ├── middleware/        # Auth, validation
│   │   │   └── app.ts             # Main application
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── app-agent/                  # AI agents wrapper (planned)
│   ├── app-web/                    # Dashboard wrapper (planned)
│   └── app-mt/                     # MT4/MT5 assets (read-only)
│
├── packages/                       # Shared libraries
│   ├── trading-core/              # SMC, harmonics, indicators, replay
│   ├── persistence/               # SQLite/PostgreSQL stores, migrations
│   ├── observability/             # Metrics, SSE, shadow reports
│   ├── notifications/             # Discord, Feishu webhooks
│   ├── config/                    # Environment variable parsing
│   ├── shared-contracts/          # TypeScript types
│   └── breakout-cache/            # Breakout detection cache
│
├── agents/                         # AI analysis service (NestJS)
│   ├── src/
│   ├── Dockerfile
│   └── package.json
│
├── web/dashboard/                  # Monitoring dashboard (Next.js)
│   ├── src/
│   └── package.json
│
├── legacy/python/                  # Archived Python scripts
├── docs/                          # Documentation
├── prometheus.yml                 # Prometheus config
├── grafana/                       # Grafana dashboards
├── docker-compose.yaml            # Production deployment
├── docker-compose.dev.yaml        # Local infrastructure
└── .env.example                   # Environment variables template
```

## Services

| Service | Path | Runtime | Port | Description |
|---------|------|---------|------|-------------|
| **Trading Engine** | `apps/app-server` | Node.js 20+ | 8880 | Main HTTP API, EA routes, background services |
| **AI Agents** | `agents/` | NestJS 11 / Node.js 20+ | 3100 | AI analysis and decision-making |
| **Dashboard** | `web/dashboard/` | Next.js 15 (static) | served by app-server | Monitoring UI |
| **Redis** | Docker | Redis 7-alpine | 6379 | Cache and pub/sub |
| **Prometheus** | Docker | Prometheus latest | 9090 | Metrics collection |
| **Grafana** | Docker | Grafana latest | 3000 | Metrics visualization |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10.32.1+ (install via `npm install -g pnpm`)
- Docker & Docker Compose (for infrastructure)

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment template
cp .env.example .env

# 3. Start local infrastructure (Redis)
docker compose -f docker-compose.dev.yaml up -d

# 4. Build all packages
pnpm -w run build

# 5. Run tests
pnpm -w run test

# 6. Start trading engine (development mode)
pnpm --filter app-server dev
```

The app-server will start on `http://localhost:3000` (or the port specified in `GB_APP_SERVER_PORT`).

### AI Agents (separate terminal)

```bash
cd agents
npm ci
npm run dev
```

Agents will start on `http://localhost:3100`.

### Dashboard (optional)

```bash
cd web/dashboard
npm ci
npm run build
```

The built static files are served by app-server.

## Docker Deployment

### Production Deployment

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with production values

# 2. Build images
docker compose build app agents

# 3. Start services
docker compose up -d app agents redis prometheus grafana

# 4. Verify deployment
docker compose ps
curl http://localhost:8880/healthz
curl http://localhost:3100/health
```

### Service URLs (localhost only)

- Trading engine: `http://127.0.0.1:8880`
  - Health: `/healthz`
  - Metrics: `/metrics`
  - Shadow validation: `/shadow/metrics`, `/shadow/qualification`
- AI agents: `http://127.0.0.1:3100`
- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3000`

All services are bound to `127.0.0.1` for security.

## Environment Variables

See `.env.example` for full configuration. Key variables:

### Trading Engine (app-server)

```bash
GB_APP_ENV=production
GB_APP_SERVER_HOST=0.0.0.0
GB_APP_SERVER_PORT=3000

# Persistence
GB_EA_STORE_SQLITE_PATH=data/gold_bolt.sqlite
GB_EA_STORE_POSTGRES_DSN=  # Optional

# Authentication
GB_ADMIN_TOKEN=your-admin-token
GB_LEGACY_TOKENS_PATH=tokens.json  # Optional

# Notifications
GB_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
GB_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
GB_FEISHU_SECRET=your-feishu-secret
```

### AI Agents

```bash
GOLDBOT_API_URL=http://app:8880
GOLDBOT_API_TOKEN=your-api-token
REDIS_URL=redis://redis:6379
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

## Development Workflow

### Adding New Features

1. Create feature branch from `main`
2. Implement changes in appropriate package/app
3. Add tests (unit + integration)
4. Run `pnpm -w run build && pnpm -w run test`
5. Update documentation
6. Create pull request

### Package Development

```bash
# Work on a specific package
pnpm --filter @gold-bot/trading-core build
pnpm --filter @gold-bot/trading-core test

# Add dependency to a package
pnpm --filter @gold-bot/trading-core add lodash

# Add dev dependency to workspace root
pnpm add -Dw vitest
```

### Testing

```bash
# Run all tests
pnpm -w run test

# Run tests for specific package
pnpm --filter app-server test
pnpm --filter @gold-bot/trading-core test

# Run tests in watch mode
pnpm --filter app-server test:watch
```

## Production Verification

```bash
# 1. Build check
pnpm -w run build

# 2. Test check
pnpm -w run test

# 3. Type check
pnpm -w run typecheck

# 4. Lint check
pnpm -w run lint

# 5. Docker build check
docker compose build app agents

# 6. Docker compose validation
docker compose config
```

## Monitoring & Observability

### Prometheus Metrics

Available at `http://localhost:8880/metrics`:

- `goldbot_http_requests_total` - HTTP request count by method, path, status
- `goldbot_http_request_duration_seconds` - HTTP request latency
- `goldbot_ea_account_equity` - Account equity by account_id
- `goldbot_ea_account_balance` - Account balance
- `goldbot_ea_open_positions_total` - Open positions count
- `goldbot_ea_floating_pl` - Floating P/L
- `goldbot_ea_daily_pl` - Daily P/L
- `goldbot_ea_heartbeat_timestamp` - Last heartbeat timestamp
- `goldbot_ea_spread` - Current spread by symbol
- ... (23 metrics total)

### Shadow Validation Endpoints

- `GET /shadow/metrics` - Current shadow validation metrics
- `GET /shadow/qualification` - Cutover readiness report
- `POST /shadow/comparisons` - Record oracle comparison (internal)

### Health Checks

- `GET /healthz` - App server health (returns 200 OK or 503)
- `GET /health` - AI agents health (agents service)

## Documentation

- [CLAUDE.md](CLAUDE.md) - Project instructions for AI agents
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines and phase model
- [API Contracts](docs/API_CONTRACTS.md) - Go ↔ AI agents API spec
- [Monorepo Guide](docs/MONOREPO_GUIDE.md) - Monorepo structure and workflows
- [Architecture](docs/ARCHITECTURE.md) - System architecture
- [Deployment](docs/DEPLOYMENT.md) - Deployment guide

## Migration Status

This monorepo has completed a full Go → Node.js rewrite:

- ✅ All HTTP routes migrated (27/27)
- ✅ All trading core logic migrated (SMC, harmonics, candlestick, indicators)
- ✅ All persistence layer migrated (SQLite + PostgreSQL)
- ✅ All background services migrated (analysis, arbitration, scheduler)
- ✅ All observability migrated (23 Prometheus metrics, SSE)
- ✅ All notifications migrated (Discord, Feishu)
- ✅ Enhanced with shadow validation and cutover infrastructure
- ✅ 334 tests passing (141 app-server + 14 observability + 179 trading-core)

**Go code has been removed as of 2026-07-06.** The legacy Go codebase is preserved in git history.

## License

Proprietary - All rights reserved.
