#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

server_dockerfile = Path("apps/app-server/Dockerfile").read_text()
agent_dockerfile = Path("apps/app-agent/Dockerfile").read_text()
server_workflow = Path(".github/workflows/docker.yml").read_text()
agent_workflow = Path(".github/workflows/docker-agents.yml").read_text()

assert "FROM node:24-bookworm AS builder" in server_dockerfile, "app-server Dockerfile must use the Node 24 monorepo builder"
assert "pnpm --filter app-web build" in server_dockerfile, "app-server image must build the static dashboard workspace"
assert 'pnpm --filter "app-server..." build' in server_dockerfile, "app-server image must build app-server with its workspace dependencies"
assert "COPY apps/app-mt/mt4_ea" in server_dockerfile, "app-server image must include MT4 release assets"
assert "COPY apps/app-mt/mt5_ea" in server_dockerfile, "app-server image must include MT5 release assets"
assert "golang:" not in server_dockerfile, "app-server Dockerfile must not use the old Go builder"
assert "web/dashboard" not in server_workflow, "docker.yml must not build the removed web/dashboard package"
assert "build-dashboard" not in server_workflow, "docker.yml must not use the old dashboard artifact job"
assert "file: apps/app-server/Dockerfile" in server_workflow, "docker.yml must build apps/app-server/Dockerfile"
assert "apps/**" in server_workflow, "docker.yml should use a compact apps path filter"
assert "packages/**" in server_workflow, "docker.yml should use a compact packages path filter"
assert "pnpm-lock.yaml" in server_workflow, "docker.yml missing pnpm lockfile path filter"
assert "workflow_dispatch:" in server_workflow, "docker.yml missing workflow_dispatch trigger"
assert "push_image" in server_workflow, "docker.yml missing manual push control"
assert "cache-from: type=gha,scope=app-server-" in server_workflow, "docker.yml missing app-server scoped BuildKit cache"

assert "FROM node:20-bookworm AS builder" in agent_dockerfile, "app-agent Dockerfile must keep the Node 20 builder required by its package"
assert "file: apps/app-agent/Dockerfile" in agent_workflow, "docker-agents.yml must build apps/app-agent/Dockerfile"
assert "apps/app-agent/**" in agent_workflow, "docker-agents.yml missing app-agent path filter"
assert "pnpm-lock.yaml" in agent_workflow, "docker-agents.yml missing pnpm lockfile path filter"
assert "cache-from: type=gha,scope=app-agent-" in agent_workflow, "docker-agents.yml missing app-agent scoped BuildKit cache"

compose = Path("docker-compose.yaml").read_text()
assert "GB_EA_STORE_POSTGRES_DSN:" in compose, "compose must pass the Node app-server PostgreSQL DSN variable"
assert "GB_ADMIN_TOKEN:" in compose, "compose must pass the Node app-server admin token variable"
assert "REDIS_URL=redis://redis:6379" in compose, "agents service must use the compose Redis service"
assert "target: /workspace/apps/app-agent/data" in compose, "agent data volume must match the app-agent container workdir"
assert "condition: service_healthy" in compose, "dependent services should wait for app health"

print("docker workflow contract ok")
PY
