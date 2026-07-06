# Gold Bot Monorepo Structure

This document describes the organization of the Gold Bot monorepo after the Node.js rewrite.

## Top-Level Structure

```
gold-bot/
├── apps/              # Applications (deployable services)
├── packages/          # Shared libraries
├── agents/            # AI analysis service (NestJS)
├── web/              # Frontend applications
├── legacy/           # Archived code
├── docs/             # Documentation
├── .planning/        # Project planning artifacts
└── [config files]    # Docker, environment, tooling configs
```

## Applications (`apps/`)

Deployable services that depend on shared packages.

```
apps/
├── app-server/           # Main trading engine (Node.js HTTP server)
│   ├── src/
│   │   ├── routes/      # HTTP route handlers
│   │   │   ├── ea.ts              # EA legacy routes (/register, /heartbeat, etc.)
│   │   │   ├── ai.ts              # AI routes (/api/analysis_payload, /api/ai_result)
│   │   │   ├── admin.ts           # Admin routes (/api/tokens, /api/v1/accounts)
│   │   │   ├── indicator-alert.ts # Indicator alert routes
│   │   │   └── visual.ts          # Visual assistant routes
│   │   ├── services/    # Background services
│   │   │   ├── analysis/          # Analysis scheduler
│   │   │   ├── arbitration/       # Arbitration manager
│   │   │   ├── shadow/            # Shadow validation
│   │   │   ├── command-lifecycle/ # Command lifecycle manager
│   │   │   ├── scheduler/         # Cron scheduler
│   │   │   └── ai-approve/        # AI approval cooldown gate
│   │   ├── middleware/  # Auth, validation, error handling
│   │   ├── http/        # HTTP utilities (JSON parsing, responses)
│   │   ├── bootstrap/   # Startup tasks (token seeding)
│   │   ├── app.ts       # Main application logic
│   │   └── index.ts     # Entry point
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── app-agent/           # Agents wrapper (planned)
├── app-web/             # Dashboard wrapper (planned)
└── app-mt/              # MT4/MT5 assets (read-only, archived)
```

### app-server (Port 8880)

The main Node.js trading engine. Handles:
- EA client HTTP routes (register, heartbeat, tick, bars, positions, poll, order_result)
- AI analysis payload generation and result processing
- Admin API (tokens, accounts, overview, audit)
- Background services (scheduling, arbitration, shadow validation)
- Observability (Prometheus metrics, health checks, SSE)
- Notifications (Discord, Feishu)

**Key dependencies:** `@gold-bot/trading-core`, `@gold-bot/persistence`, `@gold-bot/observability`, `@gold-bot/notifications`

## Shared Packages (`packages/`)

Reusable libraries shared across applications.

```
packages/
├── trading-core/        # Core trading logic
│   ├── src/
│   │   ├── smc/                  # Smart Money Concepts detection
│   │   │   ├── types.ts          # SwingPoint, FVG, OrderBlock, etc.
│   │   │   ├── detector.ts       # SMC detection algorithms
│   │   │   └── index.ts
│   │   ├── harmonic/             # Harmonic pattern detection
│   │   │   ├── types.ts          # HarmonicPattern types
│   │   │   ├── detector.ts       # Gartley, Bat, Butterfly, Crab, ABCD
│   │   │   └── index.ts
│   │   ├── indicators/           # Technical indicators
│   │   │   ├── candlestick.ts    # 10 candlestick patterns
│   │   │   ├── ema.ts            # EMA calculation
│   │   │   ├── atr.ts            # ATR calculation
│   │   │   ├── rsi.ts            # RSI calculation
│   │   │   └── [others]
│   │   ├── engine/               # Strategy configuration
│   │   │   └── config.ts         # Per-symbol configs (9 symbols)
│   │   ├── replay/               # Replay engine & coverage
│   │   │   ├── replay.ts         # Signal replay from snapshots
│   │   │   └── coverage.ts       # Replay fixture coverage metric
│   │   ├── positionmgr/          # Position management
│   │   └── riskgate/             # Risk gate & market filters
│   │       └── riskgate.ts       # evaluateMarketFilters, evaluateRiskGate
│   └── package.json
│
├── persistence/         # Database & storage
│   ├── src/
│   │   ├── types.ts              # EaStore interface, EaRecord
│   │   ├── sqlite.ts             # SQLite implementation
│   │   ├── postgres.ts           # PostgreSQL implementation
│   │   ├── memory.ts             # In-memory store (testing)
│   │   ├── migrate.ts            # Schema migrations (0001-0007)
│   │   └── index.ts
│   └── package.json
│
├── observability/       # Metrics & monitoring
│   ├── src/
│   │   ├── metrics.ts            # Prometheus metrics (23 goldbot_* metrics)
│   │   ├── sse.ts                # Server-Sent Events hub
│   │   ├── shadow.ts             # Shadow report builder
│   │   └── index.ts
│   └── package.json
│
├── notifications/       # External notifications
│   ├── src/
│   │   ├── discord.ts            # Discord webhook notifier
│   │   ├── feishu.ts             # Feishu webhook notifier
│   │   └── index.ts
│   └── package.json
│
├── config/              # Environment configuration
│   ├── src/
│   │   └── env.ts                # GB_* env var parsing & validation
│   └── package.json
│
├── shared-contracts/    # Shared TypeScript types
│   ├── src/
│   │   ├── strategy.ts           # Strategy types, DecisionEvent
│   │   └── index.ts
│   └── package.json
│
└── breakout-cache/      # Breakout detection cache
    ├── src/
    │   └── cache.ts
    └── package.json
```

### Package Dependency Graph

```
app-server
├── @gold-bot/trading-core
│   ├── @gold-bot/shared-contracts
│   └── @gold-bot/breakout-cache
├── @gold-bot/persistence
│   └── @gold-bot/shared-contracts
├── @gold-bot/observability
│   └── @gold-bot/persistence
├── @gold-bot/notifications
├── @gold-bot/config
└── @gold-bot/shared-contracts
```

## AI Agents (`agents/`)

NestJS-based AI analysis service.

```
agents/
├── src/
│   ├── modules/
│   │   ├── analysis/     # Analysis module
│   │   ├── llm/          # LLM provider abstraction
│   │   └── scheduler/    # Cron scheduler
│   ├── app.module.ts
│   └── main.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

**Port:** 3100  
**Dependencies:** Redis, app-server API

## Dashboard (`web/dashboard/`)

Next.js monitoring dashboard (static export).

```
web/dashboard/
├── src/
│   ├── app/              # Next.js 15 app directory
│   ├── components/       # React components
│   └── lib/              # Utilities
├── public/
├── package.json
└── next.config.mjs
```

**Build output:** `web/dashboard/dist/` (served by app-server)

## Legacy Code (`legacy/`)

Archived code no longer in active use.

```
legacy/
└── python/               # Original Python Flask scripts
    ├── app.py
    ├── agents/
    └── utils/
```

## Documentation (`docs/`)

```
docs/
├── API_CONTRACTS.md      # Go ↔ AI agents API spec (archived)
├── MONOREPO_GUIDE.md     # Monorepo structure & workflows
├── ARCHITECTURE.md       # System architecture
├── API.md                # HTTP API reference
├── DEPLOYMENT.md         # Deployment guide
├── MONITORING.md         # Monitoring guide
└── superpowers/          # AI development workflow docs
```

## Configuration Files

```
gold-bot/
├── .env.example          # Environment variable template
├── docker-compose.yaml   # Production Docker deployment
├── docker-compose.dev.yaml  # Local infrastructure (Redis)
├── prometheus.yml        # Prometheus scrape config
├── grafana/              # Grafana dashboards
│   └── dashboards/
├── turbo.json            # Turborepo build cache config
├── pnpm-workspace.yaml   # pnpm workspace definition
├── package.json          # Workspace root package.json
├── tsconfig.json         # Base TypeScript config
├── .gitignore
└── README.md
```

## Planning Artifacts (`.planning/`)

Project management and planning documents.

```
.planning/
├── PROJECT.md            # Project context & vision
├── REQUIREMENTS.md       # Scoped requirements
├── ROADMAP.md            # Phase structure
├── STATE.md              # Current state & progress
├── config.json           # Workflow preferences
├── research/             # Domain research
├── phases/               # Phase-specific artifacts
│   ├── 01-fib-extension-target/
│   ├── 02-fib-retracement-enhanced/
│   └── 03-ai-signal-pending/
└── codebase/             # Codebase analysis (planned)
```

## Build & Test Artifacts

```
[package]/
├── dist/                 # Compiled TypeScript output (gitignored)
├── node_modules/         # Dependencies (gitignored)
└── .turbo/               # Turborepo cache (gitignored)
```

## Migration Notes

### Removed Directories (as of 2026-07-06)

- `cmd/` - Go server entry point (replaced by `apps/app-server`)
- `internal/` - Go internal packages (replaced by `packages/`)
- `mt4_ea/` - MT4 EA clients (archived, functionality remains in MT4/MT5)
- `mt5_ea/` - MT5 EA clients (archived, functionality remains in MT4/MT5)

### Removed Files

- `go.mod`, `go.sum` - Go modules
- `Dockerfile` - Go multi-stage build (replaced by `apps/app-server/Dockerfile`)
- `docker-compose.shadow.yaml` - Shadow deployment config (merged into main compose)

### Preserved in Git History

All removed Go code is preserved in git history before commit "refactor: remove Go code, Node.js rewrite complete".

## Adding New Code

### New Shared Package

```bash
mkdir -p packages/new-package/src
cd packages/new-package

# Create package.json
cat > package.json <<EOF
{
  "name": "@gold-bot/new-package",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
EOF

# Create tsconfig.json
cat > tsconfig.json <<EOF
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
EOF

# Add to pnpm workspace (already covered by packages/*)
# Build from root
cd ../..
pnpm install
pnpm --filter @gold-bot/new-package build
```

### New Application

```bash
mkdir -p apps/new-app/src
cd apps/new-app

# Create package.json (similar to app-server)
# Create tsconfig.json
# Create Dockerfile (if deployable)

# Update docker-compose.yaml if needed
```

## Development Workflow

1. **Make changes** in packages or apps
2. **Rebuild packages** that changed: `pnpm --filter <package> build`
3. **Run tests**: `pnpm --filter <package> test`
4. **Type check**: `pnpm -w run typecheck`
5. **Commit**: Follow conventional commit style (`feat:`, `fix:`, `refactor:`)

## Production Deployment

1. `pnpm install --frozen-lockfile`
2. `pnpm -w run build`
3. `pnpm -w run test`
4. `docker compose build app agents`
5. `docker compose up -d`

---

**Last updated:** 2026-07-06 (after Go → Node.js rewrite completion)
