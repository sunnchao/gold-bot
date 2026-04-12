# Gold Bot Go Rewrite Design

Date: 2026-04-12

## Summary

Replace the current Python server and utility scripts with a Go-based backend while keeping the MT4/MT5 MQL clients unchanged. Rebuild the web console as a new `Next.js + Tailwind CSS` dashboard, then serve its built assets from the Go server. Migration will use a dual-track rollout: Python remains production until the Go system matches all required behavior and can take over safely.

## Confirmed Constraints

- MQL4 and MQL5 clients stay in place and their behavior remains unchanged.
- Legacy EA protocol must stay 100% compatible:
  - `/register`
  - `/heartbeat`
  - `/tick`
  - `/bars`
  - `/positions`
  - `/poll`
  - `/order_result`
- All non-MQL backend code moves to Go.
- The monitoring UI is rebuilt with `Next.js + Tailwind CSS`.
- Next.js build output is hosted by the Go service.
- Migration uses dual-track operation with Python and Go running in parallel.
- Production cutover happens only after the Go system covers all current capabilities.
- Development and production both use SQLite for now.
- Data access and schema choices must keep a practical path open for PostgreSQL later.
- The external Aurex/Gateway AI flow stays external.
- The Go server must keep compatible `analysis_payload` and `ai_result` endpoints for the AI agent.
- Priority order from the user:
  - Performance and concurrency stability
  - Maintainability and type safety
  - Readiness for future multi-service or multi-node splitting
  - Single-binary operational simplicity

## Current System Findings

The current codebase is operational but structurally compressed:

- `app.py` owns most runtime concerns:
  - HTTP routes
  - WebSocket pushes
  - in-memory account state
  - command queue state
  - background analysis loop
  - AI compatibility endpoints
  - token admin endpoints
  - EA update endpoints
- `data/manager.py` computes technical indicators from pushed bars using pandas/numpy.
- `strategy/engine.py` generates strategy signals.
- `strategy/position_mgr.py` generates position-management commands.
- Token persistence is currently a JSON file via `token_manager.py`.
- Most runtime trading state is in memory rather than in durable storage.
- Documentation has drifted from the code in some places, so migration must treat current runtime behavior as the source of truth.

## Goals

- Preserve EA protocol and practical behavior while replacing the backend implementation.
- Move core trading state from memory-first storage to durable database-backed state.
- Improve concurrency safety and remove the current single-file concentration of responsibilities.
- Make strategy, indicator, and position-management logic independently testable in Go.
- Rebuild the web console around operational workflows, auditability, and Python-vs-Go cutover visibility.
- Support full replay, shadow comparison, and cutover readiness checks.
- Keep the design modular enough to split into services later if required.

## Non-Goals

- No rewrite of MT4/MT5 MQL clients.
- No protocol redesign for the EA side.
- No immediate move to PostgreSQL in the first release.
- No requirement to introduce microservices in the first release.
- No requirement to embed LLM inference directly into the Go service.

## Chosen Approach

Use a modular monolith in Go plus a separate Next.js frontend project whose static output is served by the Go binary.

This approach is chosen over a full event-platform rebuild or a temporary mixed-language bridge because it best fits the confirmed priorities:

- It raises performance and concurrency safety quickly.
- It creates strong type boundaries and clearer ownership.
- It keeps future service extraction possible through module boundaries.
- It avoids extending the lifetime of a Python/Go hybrid runtime.

## Target Architecture

### Backend Shape

The Go server remains a single deployable service in the first production version, but internal packages define clear subsystem boundaries:

```text
cmd/server
internal/api
internal/app
internal/config
internal/domain
internal/store
internal/strategy
internal/scheduler
internal/realtime
internal/integration
internal/legacy
internal/ea
```

### Responsibility Split

- `cmd/server`
  - process startup
  - dependency wiring
  - HTTP/SSE serving
  - static asset serving
- `internal/api`
  - admin and UI APIs
  - request validation
  - response shaping
- `internal/legacy`
  - exact EA-compatible endpoints and payload adapters
- `internal/domain`
  - typed business models
  - command and state enums
  - pure cross-module contracts
- `internal/store`
  - SQLite-backed repositories
  - migration helpers
  - query interfaces designed to be portable to PostgreSQL later
- `internal/strategy`
  - indicators
  - signal generation
  - position management
  - deterministic, testable business logic
- `internal/scheduler`
  - analysis loops
  - polling cadence
  - periodic maintenance jobs
- `internal/realtime`
  - event envelope generation
  - SSE client fan-out
  - event persistence hooks
- `internal/integration`
  - Discord
  - Feishu
  - Aurex-facing compatibility helpers
- `internal/ea`
  - EA version metadata
  - downloadable EA assets

### Core Runtime Principle

The EA-facing layer remains backward-compatible, but handlers no longer own business state directly. They translate requests into typed commands and repository updates, then invoke domain services. This removes the current pattern where runtime behavior is spread between route handlers and a large shared in-memory store.

## Data Model

The persistent model is split into current-state tables, historical tables, and operational event records.

### Current-State Tables

- `accounts`
  - account identity and broker metadata
- `account_runtime`
  - latest balance/equity/margin snapshot
  - connectivity state
  - market status
  - latest heartbeat and latest tick timestamps
- `positions_current`
  - current open positions per account and ticket
- `strategy_mappings`
  - dynamic `magic -> strategy` mappings received from the EA

### Historical Tables

- `ticks`
  - incoming price history by account, symbol, and timestamp
- `bars`
  - K-line history by account, symbol, timeframe, and bar time
- `positions_history`
  - open/modify/close lifecycle history
- `command_results`
  - execution acknowledgements and failures from the EA
- `ai_reports`
  - Aurex results returned through compatibility endpoints

### Operational Tables

- `commands`
  - server-generated commands for the EA
  - statuses such as `pending`, `delivered`, `acked`, `failed`, `expired`
- `strategy_runs`
  - each analysis pass
  - inputs, analysis logs, candidate signals, selected result, rejection reason
- `position_management_runs`
  - each pass of trailing, breakeven, TP, or close logic
- `notifications`
  - outbound Discord/Feishu attempts and cooldown decisions
- `tokens`
  - token ownership and account bindings
- `ea_releases`
  - EA version info and downloadable asset metadata
- `ui_events`
  - normalized events for the dashboard and cutover audit tools

### Persistence Rules

- Current-state queries should read from dedicated snapshot tables, not rebuild state from history on every request.
- Historical tables exist for replay, debugging, and audit rather than only for UI rendering.
- All timestamps are stored in UTC.
- SQLite-specific tricks should be avoided when they block a PostgreSQL move later.
- Large JSON columns are allowed only for supplemental metadata, not for critical query semantics.
- Tick retention and event retention policies must be defined to keep SQLite practical in production.

## API Design

### 1. Legacy EA API

These endpoints keep their existing paths and response semantics:

- `POST /register`
- `POST /heartbeat`
- `POST /tick`
- `POST /bars`
- `POST /positions`
- `POST /poll`
- `POST /order_result`

Behavioral expectations:

- authentication semantics remain compatible
- field names remain compatible
- polling remains compatible
- command payload semantics remain compatible

The implementation behind those endpoints changes, but the contract seen by MQL must not.

### 2. AI Compatibility API

Keep these endpoints for Aurex/Gateway integration:

- `GET /api/analysis_payload/:account_id`
- `POST /api/ai_result/:account_id`

The compatibility layer can read from new normalized tables internally, but the external response shape must stay stable enough not to break the existing external agent flow.

### 3. Admin and UI API

Introduce versioned APIs for the dashboard and operational tooling, for example:

- `GET /api/v1/accounts`
- `GET /api/v1/accounts/:id/runtime`
- `GET /api/v1/accounts/:id/positions`
- `GET /api/v1/accounts/:id/signals`
- `GET /api/v1/accounts/:id/ai-reports`
- `GET /api/v1/accounts/:id/commands`
- `GET /api/v1/cutover/health`
- `GET /api/v1/tokens`
- `GET /api/v1/ea/releases`

The UI must not depend on legacy EA payload shapes.

## Realtime Design

### Transport Choice

Use Server-Sent Events for the new dashboard instead of carrying Socket.IO forward.

Rationale:

- The dashboard is primarily a consumer of server events.
- SSE is simpler to operate with a Go-hosted static frontend.
- It reduces protocol complexity compared with Socket.IO.
- It is easier to persist and replay through a normalized event envelope.

### Event Envelope

Use a single event envelope shape across runtime broadcasting and persistence:

```json
{
  "event_id": "evt_123",
  "event_type": "signal.created",
  "account_id": "90011087",
  "source": "go-shadow",
  "timestamp": "2026-04-12T14:30:00Z",
  "payload": {}
}
```

Recommended `source` values:

- `python-prod`
- `go-shadow`
- `go-prod`
- `external-ai`

This source label is essential for cutover audit and dual-track comparison.

## Frontend Design

### Stack

- Next.js
- Tailwind CSS
- static build output served by the Go server

### Runtime Model

Use a browser-driven app that consumes Go APIs and SSE streams. Avoid dependence on a live Node SSR runtime in production.

### Dashboard Information Architecture

The rebuilt console should not be a direct clone of the current HTML page. It should be organized around operations and cutover safety:

- `Overview`
  - system health
  - connected accounts
  - market state
  - cutover readiness
- `Accounts`
  - account workspace
  - latest runtime snapshot
  - live positions
  - latest pending commands
- `Signals`
  - strategy runs
  - candidate signals
  - rejected and emitted signals
- `Positions`
  - current positions
  - position-management actions
  - trailing/breakeven/TP history
- `AI Reports`
  - latest Aurex reports
  - risk alerts
  - exit suggestions
- `Audit & Cutover`
  - Python-vs-Go comparison
  - protocol error rates
  - signal drift
  - command drift
  - go-live readiness

### Key UI Principle

Python-vs-Go dual-track comparison becomes a first-class dashboard capability, not an internal engineering afterthought.

## Notifications and External Integrations

### Discord and Feishu

Move notification sending to Go and persist send attempts/results. The new implementation must preserve:

- current webhook behavior
- cooldown logic
- formatting expectations that operators rely on

### Token Management

Replace JSON token storage with database-backed storage while preserving existing token semantics for EA and admin access.

### EA Release Distribution

The Go server must continue serving version metadata and downloadable EA files to support the current update path.

## Migration Plan

### Phase 0: Contract Freeze

Document and capture the actual behavior of:

- EA request/response samples
- command queue behavior
- AI compatibility payloads
- token behavior
- notification behavior

Current runtime behavior takes precedence over outdated docs.

### Phase 1: Go Passive Mode

Build the Go system so it can:

- load schema
- ingest recorded samples
- execute offline replays
- compare indicator and strategy outputs

No production control is transferred in this phase.

### Phase 2: Go Shadow Mode

Mirror live traffic into Go while Python remains the only production authority.

Go will:

- ingest requests
- persist state
- run analysis
- emit shadow events
- record drift from Python

Go will not send live trading commands in this phase.

### Phase 3: Go Dry-Run Command Mode

Go generates full command decisions under live conditions but flags them as non-authoritative. Python remains authoritative for real EA command delivery.

This phase validates:

- strategy stability
- position-management behavior
- command queue semantics
- timing and scheduling correctness

### Phase 4: Controlled Cutover

Transfer production control to Go only when:

- all required capabilities are present
- compatibility gates pass
- dashboard and integrations are validated
- rollback path is clear

Python remains available in a read-only or observation role during the initial cutover period.

## Repo Layout

```text
gold-bot/
├── AGENTS.md
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── cmd/
│   └── server/
├── internal/
│   ├── api/
│   ├── app/
│   ├── config/
│   ├── domain/
│   ├── store/
│   ├── strategy/
│   ├── scheduler/
│   ├── realtime/
│   ├── integration/
│   ├── legacy/
│   └── ea/
├── migrations/
├── web/
│   └── dashboard/
├── mt4_ea/
├── mt5_ea/
├── build/
│   ├── dashboard/
│   └── ea/
├── scripts/
├── go.mod
├── go.sum
└── Makefile
```

## Delivery Sequence

Implementation planning should follow this order:

1. Freeze contracts and capture real behavior samples.
2. Create the Go project skeleton, configuration model, and migration system.
3. Implement the domain model and SQLite-backed repositories.
4. Implement the legacy EA-compatible API in Go.
5. Port indicators, strategy logic, and position-management logic.
6. Build the admin/UI API and SSE event stream.
7. Rebuild the dashboard in Next.js and wire it to Go.
8. Port notifications, token management, EA release endpoints, and AI compatibility support.
9. Run replay, shadow, and dry-run validation.
10. Perform controlled cutover.

## Verification Strategy

### Test Layers

- unit tests
  - indicators
  - signal generation
  - position management
  - command state machines
- contract tests
  - exact EA endpoint compatibility
  - AI compatibility endpoint shape
- replay tests
  - Python and Go output comparison from historical samples
- integration tests
  - SQLite repository behavior
  - notifications
  - token management
  - EA file distribution
- cutover readiness checks
  - shadow drift metrics
  - command drift metrics
  - event-stream stability
  - dashboard critical path checks

### Acceptance Criteria

The Go rewrite is ready for cutover only when all of the following are true:

- EA protocol compatibility is validated end to end.
- All currently required production capabilities are present in Go.
- Strategy outputs are within approved drift thresholds under replay and live shadow traffic.
- Position-management outputs are within approved drift thresholds under replay and live shadow traffic.
- AI compatibility endpoints work with the existing external Aurex/Gateway flow.
- Discord and Feishu integrations are verified.
- Token management and EA update endpoints are verified.
- Dashboard critical workflows are verified against live or mirrored data.
- Rollback procedures are documented and tested.

## Risks and Mitigations

- Risk: runtime behavior differs from docs.
  - Mitigation: capture production-like samples and treat real behavior as the compatibility baseline.
- Risk: indicator or strategy math drifts during porting.
  - Mitigation: use deterministic replay tests and side-by-side drift reports.
- Risk: full persistence increases schema and migration complexity.
  - Mitigation: keep the schema normalized, introduce snapshot tables, and phase storage carefully.
- Risk: SQLite operational limits may appear under higher production load.
  - Mitigation: design repository interfaces and schema conventions to allow a later PostgreSQL migration with minimal domain changes.
- Risk: first release requires full feature parity.
  - Mitigation: use explicit cutover gates and do not switch authority early.

## Open Implementation Assumptions

These assumptions were chosen during design and should carry into planning unless the user changes them:

- The Go system remains a modular monolith for its first production version.
- The dashboard uses static build output rather than production SSR.
- SSE is the primary realtime transport for the new UI.
- SQLite is the initial system of record for both development and production.
- Python remains the production authority until Go passes shadow and dry-run gates.
