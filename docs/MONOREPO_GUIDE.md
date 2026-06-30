# Monorepo Guide

## Directory Conventions

| Path | Purpose |
|------|---------|
| `cmd/`, `internal/`, `go.mod` | Go trading engine |
| `agents/` | NestJS AI analysis service imported from `gold-analysis-nj` |
| `web/dashboard/` | Dashboard frontend |
| `legacy/python/` | Legacy Python scripts retained for reference |
| `docs/` | Shared architecture, API, deployment, and operations docs |
| `grafana/`, `prometheus.yml`, `alerts.yml` | Monitoring configuration |

Keep component dependencies local to the component. The root Go module, `agents/package-lock.json`, and `web/dashboard/package-lock.json` are independent dependency boundaries.

## Dependency Installation

```bash
# Go engine
go mod download

# AI agents
cd agents
npm ci

# Dashboard
cd web/dashboard
npm ci
```

## Test and Build Commands

```bash
# Go engine
go build ./...
go test ./... -count=1

# AI agents
cd agents
npm run build
npm run test

# Dashboard
cd web/dashboard
npm run build

# Compose validation
docker compose config
```

## Conventional Commit Scopes

Use scopes that identify the component being changed:

- `feat(engine): ...` for Go trading engine changes
- `fix(agents): ...` for AI analysis service changes
- `chore(dashboard): ...` for dashboard maintenance
- `docs(monorepo): ...` for shared docs
- `ci(agents): ...` or `ci(engine): ...` for workflow changes
- `chore(legacy): ...` for legacy Python relocation or cleanup

## Cross-Component API Change Workflow

1. Update `docs/API_CONTRACTS.md` with the intended contract change.
2. Update Go handlers and tests for produced or consumed fields.
3. Update `agents/src/types/schemas.ts` and TypeScript tests for runtime validation.
4. Run Go and agents verification in the same branch.
5. Keep backward compatibility where possible; otherwise document the required rollout order in the PR description.
