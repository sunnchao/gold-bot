# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gold Bot Monorepo

Node.js pnpm/turbo monorepo for an automated gold/multi-symbol trading system: trading engine, LangGraph AI analysis agents, dashboard, and shared packages. The system was fully rewritten from Go to Node.js (Go removed 2026-07-06; preserved in git history).

> Note: `README.md`, `AGENTS.md`, and some docs still reference old paths (`agents/`, `web/dashboard/`, `legacy/python/`, Go code). Those moved: AI agents → `apps/app-agent`, dashboard → `apps/app-web`. Trust the layout below.

## Commands

```bash
pnpm install                                  # install all workspace deps
docker compose -f docker-compose.dev.yaml up -d   # local Redis (needed by app-agent)

pnpm -w run build                             # turbo build (packages build before apps)
pnpm -w run test                              # all tests (vitest; test depends on ^build)
pnpm -w run typecheck                         # typecheck everything
pnpm -w run lint                              # lint == typecheck in most packages

# Per-package (filter by package name)
pnpm --filter app-server dev                  # trading engine, tsx watch, port 3000 (GB_APP_SERVER_PORT)
pnpm --filter app-agent dev                   # AI agents, port 3100
pnpm --filter app-web build                   # Next.js static export, served by app-server
pnpm --filter @gold-bot/trading-core test

# Single test file / single test name
pnpm --filter app-server exec vitest run src/routes/ai.spec.ts
pnpm --filter app-server exec vitest run -t "test name"
```

Tests are colocated with source as `.spec.ts` / `.test.ts`. Root `tests/` holds legacy Python contract/replay tests and fixtures. Because turbo's `test` task depends on `^build`, run a workspace build first if a package's tests import stale `dist/` output from a dependency.

## Docker Deployment

```bash
cp .env.example .env
docker compose build app agents
docker compose up -d app agents redis prometheus grafana
```

Production ports (all bound to 127.0.0.1): app-server `8880`, agents `3100`, Prometheus `9090`, Grafana `9092` (container port 3000). In dev, app-server defaults to port `3000`.

## Architecture

### Apps (`apps/*`, all pnpm workspace members)

| App | What it is |
|-----|-----------|
| `app-server` | Trading engine (plain Node HTTP, no framework). EA routes, AI routes, admin API, SSE, metrics. Entry: `src/index.ts` → `src/app.ts`; routes in `src/routes/` (ea, ai, admin, visual, indicator-alert); background services in `src/services/` (analysis, arbitration, ai-approve gate, command-lifecycle, scheduler, shadow validation). |
| `app-agent` | AI analysis service: NestJS 11 + LangChain/LangGraph + BullMQ (Redis). Multi-agent workflow in `src/graph/` (workflow.service.ts, workflow-nodes.service.ts) orchestrating `src/agents/` — technical/sr/wave/chanlun/comprehensive analysts, mao-arbitrator, risk-manager, publisher. Runtime zod schemas in `src/types/schemas.ts`. Scheduling via `src/scheduler/` BullMQ processors. |
| `app-web` | Next.js 15 static-export dashboard (`output: 'export'`), React 19 + Tailwind. Built output served by app-server. |
| `app-mt` | **Read-only** MT4/MT5 EA sources (`mt4_ea/GoldBolt_Client.mq4`, `mt5_ea/*.mq5`) served via app-server `/api/ea/download` + `/api/ea/version`. Do not modify MQL code. |

### Shared Packages (`packages/*`, `@gold-bot/*`)

| Package | Purpose |
|---------|---------|
| `trading-core` | SMC, harmonics, indicators, candlestick, replay engine, risk gate |
| `persistence` | SQLite (better-sqlite3) / PostgreSQL stores, migrations |
| `observability` | Prometheus metrics (23 `goldbot_*` metrics), SSE, shadow validation |
| `notifications` | Discord/Feishu webhooks |
| `config` | `GB_*` environment variable parsing |
| `shared-contracts` | Route constants and shared runtime schemas/types |
| `breakout-cache` | Breakout detection cache |

### Data Flow

```text
MT4/MT5 EA -> app-server (/register /heartbeat /tick /bars /positions) -> state, strategy, pending signal
app-agent  -> GET  app-server /api/v2/analysis_payload/{account}/{symbol}
app-agent  -> LangGraph multi-agent analysis (LLM via OpenAI-compatible API)
app-agent  -> POST app-server /api/v2/ai_result/{account}/{symbol}
app-server -> ai-approve gate + arbitration -> EA /poll -> trading commands -> /order_result
Prometheus -> app-server /metrics -> Grafana
```

### Key Constraints

- **Strategy names are an EA-side contract.** `signal.strategy` must be one of the names the EA maps to magic numbers: `pullback`, `breakout_retest`, `divergence`, `breakout_pyramid`, `counter_pullback`, `range`, `momentum_scalp`, `ai_signal`. Never invent new strategy names; pass subtype identifiers in payload fields instead.
- **Market-status freshness gates trading**: stale tick/heartbeat data closes the market state on read and blocks LLM analysis (see recent app-server commits) — be careful with clock/timestamp handling in `/tick` and `/heartbeat` paths.
- Do not push or cut releases without explicit user approval.

## API Routes (app-server)

- **EA legacy**: `POST /register`, `/heartbeat`, `/tick`, `/bars`, `/positions`, `/order_result`; `GET /poll`
- **AI**: `GET /api/v2/analysis_payload/{account}/{symbol}`, `POST /api/v2/ai_result/{account}/{symbol}` (v1 single-symbol variants exist for legacy)
- **Admin**: `/api/symbols/{account}`, `/api/pending_signal/{account}/{symbol}`, `/api/arbitration/{signal_id}`, `/api/arbitration/expire`, `/api/tokens` (CRUD), `/api/v1/accounts`, `/api/v1/overview`, `/api/v1/audit`, `/api/v1/events/stream` (SSE)
- **EA assets**: `GET /api/ea/download`, `GET /api/ea/version` (`?platform=mt5` for MT5)
- **Observability**: `/healthz`, `/metrics`, `/shadow/metrics`, `/shadow/qualification`, `POST /shadow/comparisons`

## Configuration

`.env.example` is the reference. App-server uses `GB_*` vars (`GB_APP_SERVER_PORT`, `GB_EA_STORE_SQLITE_PATH`, `GB_ADMIN_TOKEN`, `GB_DISCORD_WEBHOOK_URL`, …); app-agent uses `GOLDBOT_API_URL`/`GOLDBOT_API_TOKEN` (points at app-server), `REDIS_URL`, and `LLM_*` (OpenAI-compatible provider config).
