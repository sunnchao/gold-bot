# App Server Runtime Authority Design

Date: 2026-07-02

## Summary

This design defines the first execution slice on the path to a fully Node-based Gold Bolt runtime: make `apps/app-server` the sole runtime authority for EA traffic, admin APIs, AI result intake, and SSE, while Go remains only as an oracle and rollback reference until later cutover phases complete.

The scope is intentionally narrower than the final "fully Node" end state. It does not delete Go, does not physically migrate `agents/` or `web/dashboard/` source trees into `apps/*`, and does not modify MQL assets. It does define the runtime boundaries, state model, command pipeline, safety rails, and verification rules required to let Node take over real backend responsibility in a controlled way.

## Design Inputs

Authoritative planning inputs for this design:

- `.planning/full-node-rebuild-plan.md`
- `.planning/phases/02-trading-core-migration/TASKS.md`
- `.planning/phases/03-shadow-cutover-qualification/TASKS.md`
- `.planning/phases/04-cutover-sunset/TASKS.md`
- `.planning/GO_ORACLE_CONTRACT.md`

Current code inputs that shape this design:

- `apps/app-server/src/app.ts`
- `apps/app-server/src/app.spec.ts`
- `packages/trading-core/src/replay/replay.ts`
- `packages/trading-core/src/engine/engine.ts`
- `packages/persistence/src/index.ts`
- `packages/persistence/src/index.spec.ts`
- `packages/observability/src/index.ts`
- `agents/src/tools/goldbot-api.ts`
- `web/dashboard/lib/api.ts`
- `web/dashboard/lib/events.ts`

## Confirmed Constraints

- Existing Go source remains read-only during this slice.
- Existing MT4 and MT5 source remains read-only during this slice.
- EA-facing strategy names stay limited to:
  - `pullback`
  - `breakout_retest`
  - `divergence`
  - `breakout_pyramid`
  - `counter_pullback`
  - `range`
  - `momentum_scalp`
  - `ai_signal`
- Strategy-to-Magic ownership remains EA-side.
- Node must not emit live EA commands until per-account cutover authorization exists.
- Phase 3 and Phase 4 gates from `.planning/` remain mandatory; this slice only prepares for them.
- Testing should be narrowed to the runtime-critical Node packages during fast iteration, but compatibility and safety rails must stay enforced.

## Current State Findings

### 1. `app-server` already owns a meaningful compatibility surface

`apps/app-server/src/app.ts` already implements:

- EA-compatible write routes:
  - `/register`
  - `/heartbeat`
  - `/tick`
  - `/bars`
  - `/positions`
  - `/poll`
  - `/order_result`
- Admin and AI routes:
  - `analysis_payload`
  - `ai_result`
  - `symbols`
  - `ai_symbols`
  - `pending_signal`
  - `overview`
  - `accounts`
  - `audit`
  - `events/stream`

But the file is structurally compressed: protocol parsing, auth, persistence orchestration, read-model shaping, audit placeholders, replay exposure, and trade-plan validation all live in one module.

### 2. `trading-core` is no longer just a stub

`packages/trading-core` already contains:

- indicator parity slices
- replay harness logic
- first-pass strategy translation
- position manager parity slices
- riskgate parity slices

The key limitation is not absence of logic. It is that the logic is still consumed mostly through read-only analysis paths, with live command production explicitly disabled.

### 3. Persistence is still shaped like a snapshot store

`packages/persistence` currently supports:

- account lifecycle snapshots
- one-shot explicit command queue delivery
- pending signals
- AI results
- SQLite reopen persistence

It does not yet model a full runtime command state machine, shadow comparison records, or per-account cutover state.

### 4. Observability is insufficient for shadow and cutover

`packages/observability/src/index.ts` currently exports only a health helper. That is not enough to support:

- shadow metrics
- SSE framing ownership
- cutover readiness reporting
- structured drift and rollback diagnostics

### 5. `agents/` and `web/dashboard/` are already Node applications

The top-level `agents/` NestJS service and `web/dashboard/` Next.js app are real Node applications already. The `apps/app-agent` and `apps/app-web` workspaces are wrappers, not the source of runtime behavior. Because of that, the first slice should not spend effort physically moving those source trees. It should make their backend authority Node-first.

## Goals

- Make `apps/app-server` the default backend authority for all Gold Bolt HTTP runtime surfaces.
- Replace the current single-file `app-server` shape with explicit route, service, middleware, and state boundaries.
- Introduce one unified Node command pipeline shared by EA-triggered analysis, position review, and AI result flows.
- Add runtime account modes that make oracle, shadow, cutover, and rollback behavior explicit and durable.
- Convert audit and shadow readiness from hardcoded placeholders into persisted, queryable runtime state.
- Preserve current Go-compatible error envelopes and route semantics while restructuring internals.

## Non-Goals

- No Go source deletion in this slice.
- No physical source migration of `agents/` into `apps/app-agent/src`.
- No physical source migration of `web/dashboard/` into `apps/app-web/src`.
- No MQL behavior changes.
- No broad CI simplification yet.
- No requirement that every later cutover gate be completed inside this slice.

## Chosen Approach

Use a Node-first modular runtime inside `apps/app-server`, backed by shared workspace packages, while keeping Go alive only as an oracle and rollback reference.

This approach is chosen over a source-tree-first migration because:

- the largest current gap is runtime authority, not language coverage
- `agents/` and `web/dashboard/` already run on Node
- `trading-core` already contains a meaningful computation base
- runtime state, command issuance, and cutover safety are the highest-risk parts of the migration

## Target Runtime Architecture

### app-server boundaries

`apps/app-server` becomes the sole runtime HTTP service, but splits internally into explicit modules:

```text
apps/app-server/src/
  app.ts
  index.ts
  middleware/
    auth/
  routes/
    ea/
    admin/
    ai/
  services/
    scheduler/
    command-lifecycle/
    shadow/
    analysis/
  domain/
    account-runtime/
    command-state/
```

Responsibilities:

- `routes/ea/*`
  - request parsing
  - request normalization
  - Go-compatible response envelopes
  - route-to-service translation
- `routes/admin/*`
  - overview, accounts, audit, symbols, pending-signal, SSE
- `routes/ai/*`
  - analysis payloads
  - AI result intake
- `middleware/auth/*`
  - token extraction priority
  - account authorization
  - admin authorization
- `services/scheduler/*`
  - analysis triggering from bars/positions/AI writes
  - job coordination and dedupe
- `services/command-lifecycle/*`
  - command candidate creation
  - gating
  - queueing
  - delivery
  - order result reconciliation
- `services/shadow/*`
  - oracle comparison
  - shadow metrics
  - readiness report generation
- `services/analysis/*`
  - orchestration layer that loads snapshots and invokes `trading-core`

### trading-core boundary

`packages/trading-core` remains pure computation only:

- indicators
- engine
- replay
- position manager
- riskgate
- market filters

It does not own:

- HTTP behavior
- token handling
- storage
- queue delivery
- SSE
- account cutover mode

### persistence boundary

`packages/persistence` evolves from a snapshot store into a runtime state store. It must own:

- account registrations and heartbeats
- latest ticks and bars
- current positions
- AI result audit snapshots
- pending signals
- command state records
- shadow comparison records
- per-account runtime mode and cutover flags

### observability boundary

`packages/observability` must own:

- health payloads
- SSE framing utilities
- shadow metrics formatting
- readiness report shaping
- structured runtime logging helpers

## Runtime Data Flow

### 1. EA write path

- `POST /register`
  - normalize payload
  - authorize account
  - persist registration snapshot
  - refresh account runtime config
- `POST /heartbeat`
  - normalize payload
  - authorize account
  - persist heartbeat snapshot
  - refresh tradeability baseline
- `POST /tick`
  - normalize payload
  - authorize account
  - persist latest tick snapshot
- `POST /bars`
  - normalize payload
  - authorize account
  - persist bar snapshots
  - enqueue `analysis_job(accountId, symbol, timeframe)`
- `POST /positions`
  - normalize payload
  - authorize account
  - persist current positions
  - enqueue `position_review_job(accountId, symbol)`
- `POST /order_result`
  - normalize payload
  - authorize account
  - persist execution result
  - reconcile delivered command state into terminal state

### 2. Analysis path

Every analysis-capable trigger goes through the same orchestration shape:

```text
runtime snapshots
-> analysis service
-> trading-core engine/replay/position manager/riskgate
-> command candidate
-> command lifecycle
```

The outputs are split into:

- analysis signal
- position advisories
- command candidate

Only the command candidate is eligible to become a queueable EA command.

### 3. AI result path

`POST /api/ai_result/*` must stop being a special-case route that decides behavior inline. It should:

```text
validate body
-> persist AI audit snapshot
-> derive trade-plan candidate
-> run riskgate
-> hand off to command lifecycle
```

This keeps AI-originated actions aligned with the same command state machine used by EA-driven analysis.

### 4. Poll path

`POST /poll` becomes a pure delivery endpoint:

- read commands in `queued` state for the authorized account
- atomically mark them `delivered`
- return Go-compatible payload shape

It must not synthesize commands itself.

## Unified Command Pipeline

There must be only one command pipeline in Node.

EA route handlers, AI route handlers, and scheduler jobs are not allowed to create separate command semantics. They may only produce command candidates and hand them to the same lifecycle service.

### Command states

The Node runtime command model should be:

- `draft`
  - candidate exists but has not passed runtime gating
- `shadow_only`
  - candidate exists for comparison only and may never reach `/poll`
- `queued`
  - approved for live issuance to the account
- `delivered`
  - returned by `/poll`, waiting for `order_result`
- `acked`
  - EA reported success
- `rejected`
  - rejected by riskgate, cutover mode, or protocol gating
- `failed`
  - EA reported failure
- `superseded`
  - invalidated by a newer command before delivery

### Pipeline invariants

- only `queued` commands may be emitted by `/poll`
- `shadow_only` commands must be impossible to emit
- account runtime mode may downgrade a `draft` command to `shadow_only` or `rejected`
- `order_result` may only reconcile previously `delivered` commands

## Account Runtime Modes

Each account requires a persisted runtime mode:

- `oracle`
  - Go remains the authority; Node computes and records only
- `shadow`
  - Node computes full command candidates, but all candidates are forced to `shadow_only`
- `cutover`
  - Node may promote eligible candidates to `queued`
- `rollback`
  - Node live issuance disabled immediately; account returns to Go authority

These modes must live in persistence, not in process memory or ad hoc environment conditionals.

## Error Surface

Current Go-compatible protocol envelopes in `app-server` remain authoritative for this slice:

- `405 {"status":"ERROR","message":"method not allowed"}`
- `401 {"status":"ERROR","message":"invalid token"}`
- `403 {"status":"ERROR","message":"token not authorized for account"}`
- `400 {"status":"ERROR","message":"invalid JSON"}`
- `400 {"status":"ERROR","message":"missing account_id"}`

Design rule:

- protocol errors stay at the route layer and keep the same envelope
- domain rejections move into structured runtime decision payloads rather than new ad hoc HTTP error strings

Examples of structured runtime rejections:

- account mode is `oracle` or `shadow`
- riskgate rejected a trade plan
- command candidate was superseded
- shadow comparison could not produce a cutover-eligible result

## Audit And Shadow Readiness

The current `GET /api/v1/audit` response is a placeholder. It hardcodes:

- `ready: false`
- `protocol_error_rate: 0`
- `signal_drift_rate: 0`
- `command_drift_rate: 0`
- `last_shadow_event_at: 0001-01-01T00:00:00Z`
- `missing_capabilities: ['shadow_traffic']`

This slice replaces those placeholders with persisted runtime facts.

### Required shadow artifacts

For each comparison event, Node should persist:

- input snapshot reference
- Node signal
- Node command candidate
- Go oracle comparison reference
- drift outcome
- event timestamp
- account and symbol

### Required audit outputs

Node must be able to render from real shadow state:

- `protocol_error_rate`
- `signal_drift_rate`
- `command_drift_rate`
- replay coverage status
- `last_shadow_event_at`
- missing capabilities derived from actual missing systems

## Rollback Points

The runtime migration should preserve four rollback points:

1. **Structure split only**
   - route/service/module extraction
   - no behavior change
2. **Command lifecycle introduced**
   - Node still defaults to `shadow_only`
   - no live command emission
3. **Scheduler introduced**
   - Node computes end-to-end
   - account mode remains `oracle` or `shadow`
4. **Per-account cutover enabled**
   - only selected accounts may queue live commands
   - any anomaly can switch the account back to `rollback` or `oracle`

## Verification Strategy For This Slice

### Fast-iteration mandatory checks

These checks stay mandatory for each narrow runtime change:

- `pnpm --filter app-server test`
- `pnpm --filter app-server typecheck`
- `pnpm --filter @gold-bot/persistence test`
- `pnpm --filter @gold-bot/trading-core test`
- `pnpm --filter @gold-bot/shared-contracts test`

### Stage-check mandatory checks

These checks run at integration checkpoints for this slice:

- `pnpm --filter app-server build`
- `pnpm --filter @gold-bot/persistence build`
- `pnpm --filter @gold-bot/trading-core build`
- `GOCACHE=.cache/go-build go test ./internal/... -count=1`

### Explicitly deferred from per-slice gating

These are not mandatory for every small runtime iteration in this slice:

- `pnpm -w run test`
- `apps/app-agent` suite
- `apps/app-web` suite
- `apps/app-mt` suite
- `go test ./...`
- `tests/contracts`
- `tests/replay`

They still matter later. They are not the per-iteration blocking set for this slice because they either cover broader concerns or are known to have existing instability unrelated to the runtime refactor step.

### Safety rails that may not be relaxed

Even with a reduced test set, these invariants must remain covered:

- `/poll` only emits explicitly queueable commands
- `order_result` reconciles command state correctly
- Go-compatible error envelopes remain stable
- `writesLiveCommands=false` remains the default persistence/runtime capability before cutover

## Slice Completion Definition

This first runtime-authority slice is complete only when all of the following are true:

- `app-server` is the default backend implementation for all Gold Bolt HTTP runtime surfaces
- Node can ingest EA writes, trigger analysis, run riskgate, manage command lifecycle, emit queued commands via `/poll`, and reconcile them via `/order_result`
- account runtime modes exist in persistence and control live issuance explicitly
- `audit` and shadow-readiness data come from real runtime state, not hardcoded placeholders
- `agents/` and `web/dashboard/` can rely on Node runtime authority without requiring source-tree relocation

This slice is not complete merely because route parity tests pass or because read-only analysis works.

## Deferred Work After This Slice

The following work is explicitly deferred:

- physical source migration into `apps/app-agent/src` and `apps/app-web/src`
- shadow staging deployment and 72h qualification window
- per-account production cutover waves
- Go source deletion
- Node-only CI and documentation cleanup

Those remain required for the final "fully Node" end state, but they are not bundled into this design slice.
