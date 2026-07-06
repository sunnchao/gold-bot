# Contributing

## Node Rebuild Phases

Use the phase documents under `.planning/phases/` as the source of truth for Node migration work.

| Phase | Branch convention | Required verification before merge |
|---|---|---|
| Phase 0 — Go oracle freeze | `feat/node-oracle-freeze` | `go build ./...`, `go test ./internal/... -count=1`, fixture JSON parse |
| Phase 1 — pnpm workspace scaffold | `feat/monorepo-scaffold` | `pnpm -w run build`, `pnpm -w run test`, `go build ./...`, `go test ./internal/... -count=1` |
| Phase 2 — trading-core and persistence migration | `feat/node-trading-core-migration` | package tests, replay parity against Phase 0 fixtures |
| Phase 3 — shadow/cutover qualification | `feat/node-shadow-cutover` | replay plus shadow drift gates |
| Phase 4 — cutover and Go sunset | `feat/node-cutover-sunset` | account-level cutover checklist and explicit user approval |

## Boundaries

- `apps/app-server`: Node HTTP app boundary for EA routes, admin APIs, SSE, scheduling, and integrations.
- `apps/app-agent`: wrapper around the existing `agents/` service.
- `apps/app-web`: wrapper around the existing `web/dashboard/` app.
- `apps/app-mt`: read-only MT4/MT5 asset boundary.
- `packages/shared-contracts`: route constants and runtime schemas.
- `packages/trading-core`: future strategy, indicator, position manager, riskgate, SMC, and harmonic code.
- `packages/persistence`: future Node store adapters.
- `packages/observability`: health, metrics, logger, and SSE helpers.
- `packages/config`: shared Node environment parsing.

Do not modify Go or MQL source during Node scaffold work. Do not enable Node live EA command generation before replay, shadow, and cutover gates pass.
