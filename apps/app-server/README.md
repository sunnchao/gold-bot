# app-server

Node app-server runtime authority surface.

Current behavior:
- `GET /healthz` returns `{"status":"ok","phase":1}`.
- EA routes, admin APIs, AI routes, and SSE all run through Node.
- Runtime modes control whether commands stay `shadow_only` or are allowed to queue for `/poll`.
- Go remains oracle-only until later cutover phases.

Migration source paths:
- `internal/app/app.go`
- `internal/legacy/`
- `internal/api/`
