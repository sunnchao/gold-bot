# Go Docker Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 Python Docker 发布链路改造成兼容现有 Go 服务端与 Next.js 控制台的单镜像构建与 GHCR 发布流程。

**Architecture:** 使用一个根目录多阶段 Dockerfile，同步构建 `web/dashboard` 静态产物和 `cmd/server` Go 二进制，再放入轻量运行时镜像。GitHub Actions 保留 `v*` tag 自动发布，同时增加 `workflow_dispatch`，支持手动只 build 或 build+push。

**Tech Stack:** Docker multi-stage build, GitHub Actions, GHCR, Go 1.24, Node 20, Next.js, docker/build-push-action@v6

---

## File Structure

- Modify: `Dockerfile` — 从 Python runtime 改为 Node + Go 多阶段构建，输出单运行镜像
- Create: `.dockerignore` — 排除本地缓存、数据库、前端产物、git 元数据
- Modify: `.github/workflows/docker.yml` — 新增 `workflow_dispatch` 与手动 push 控制，适配 Go Dockerfile

### Task 1: 建立 Dockerfile / workflow 的失败校验

**Files:**
- Create: `tests/docker/test_docker_workflow.sh`
- Verify: `Dockerfile`
- Verify: `.github/workflows/docker.yml`

- [ ] **Step 1: 写失败校验脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

grep -q "FROM python:3.11-slim" Dockerfile
grep -q "workflow_dispatch" .github/workflows/docker.yml
```

- [ ] **Step 2: 运行脚本确认当前状态失败**

Run: `bash tests/docker/test_docker_workflow.sh`
Expected: FAIL because workflow currently does not contain `workflow_dispatch`

- [ ] **Step 3: 用更精确的断言替换脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

dockerfile = Path("Dockerfile").read_text()
workflow = Path(".github/workflows/docker.yml").read_text()

assert "FROM python:3.11-slim" not in dockerfile, "Dockerfile still targets Python runtime"
assert "golang:1.24" in dockerfile, "Dockerfile missing Go builder stage"
assert "npm run build" in dockerfile, "Dockerfile missing dashboard build"
assert "workflow_dispatch:" in workflow, "workflow missing workflow_dispatch trigger"
assert "push_image" in workflow, "workflow missing manual push control"
print("docker workflow contract ok")
PY
```

- [ ] **Step 4: 先不要让它通过，后续实现后再回跑**

Run: `bash tests/docker/test_docker_workflow.sh`
Expected: FAIL with one of the new assertions

### Task 2: 改造根目录 Dockerfile 为 Go 单镜像构建

**Files:**
- Modify: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: 把 Dockerfile 改成多阶段构建**

```Dockerfile
FROM node:20-bookworm-slim AS dashboard-builder
WORKDIR /src/web/dashboard
COPY web/dashboard/package.json web/dashboard/package-lock.json ./
RUN npm ci
COPY web/dashboard/ ./
RUN npm run build

FROM golang:1.24-bookworm AS go-builder
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=dashboard-builder /src/web/dashboard/dist ./web/dashboard/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/gold-bot ./cmd/server

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN useradd --system --create-home --uid 10001 goldbot && \
    mkdir -p /data /app/web/dashboard && \
    chown -R goldbot:goldbot /data /app
COPY --from=go-builder /out/gold-bot /app/gold-bot
COPY --from=go-builder /src/web/dashboard/dist /app/web/dashboard/dist
COPY --from=go-builder /src/mt4_ea /app/mt4_ea
ENV GB_HTTP_ADDR=:8880
ENV GB_DB_PATH=/data/gold_bolt.sqlite
EXPOSE 8880
USER goldbot
CMD ["/app/gold-bot"]
```

- [ ] **Step 2: 创建 `.dockerignore`**

```dockerignore
.git
.github
.codex
.superpowers
.worktrees
.DS_Store
data/*.sqlite*
web/dashboard/node_modules
web/dashboard/.next
web/dashboard/dist
coverage.out
*.test
```

- [ ] **Step 3: 检查 Dockerfile 运行时需要的资源路径**

Run: `rg -n "mt4_ea|web/dashboard/dist|GB_DB_PATH|GB_HTTP_ADDR" Dockerfile internal/app`
Expected: PASS and show runtime copies plus Go static hosting path assumptions

### Task 3: 改造 GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/docker.yml`

- [ ] **Step 1: 增加 `workflow_dispatch` 与布尔输入**

```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      push_image:
        description: Push image to GHCR
        required: true
        default: false
        type: boolean
```

- [ ] **Step 2: 保留 metadata-action，但兼容手动触发 tag**

```yaml
      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: |
            ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}},enable=${{ startsWith(github.ref, 'refs/tags/v') }}
            type=semver,pattern={{major}}.{{minor}},enable=${{ startsWith(github.ref, 'refs/tags/v') }}
            type=raw,value=manual-{{sha}},enable=${{ github.event_name == 'workflow_dispatch' }}
```

- [ ] **Step 3: 为 build-push-action 增加手动 push 条件**

```yaml
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: ${{ startsWith(github.ref, 'refs/tags/v') || (github.event_name == 'workflow_dispatch' && inputs.push_image) }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 4: 验证 workflow 配置文本**

Run: `bash tests/docker/test_docker_workflow.sh`
Expected: PASS with `docker workflow contract ok`

### Task 4: 本地验证 Docker 构建与容器启动

**Files:**
- Verify: `Dockerfile`
- Verify: `.dockerignore`
- Verify: `.github/workflows/docker.yml`

- [ ] **Step 1: 本地构建镜像**

Run: `docker build -t gold-bot:test .`
Expected: PASS and finish with successfully built image

- [ ] **Step 2: 后台启动容器**

Run: `docker run --rm -d --name gold-bot-test -p 8880:8880 gold-bot:test`
Expected: PASS and print container id

- [ ] **Step 3: 访问健康检查**

Run: `curl --fail http://127.0.0.1:8880/healthz`
Expected: PASS with `ok`

- [ ] **Step 4: 清理测试容器**

Run: `docker stop gold-bot-test`
Expected: PASS and print `gold-bot-test`

- [ ] **Step 5: 提交实现**

```bash
git add Dockerfile .dockerignore .github/workflows/docker.yml tests/docker/test_docker_workflow.sh
git commit -m "ci: publish docker image for go server"
```

## Self-Review

### Spec coverage

- Go 单镜像：Task 2
- `workflow_dispatch`：Task 3
- 手动 push 控制：Task 3
- 本地镜像验证：Task 4

无覆盖缺口。

### Placeholder scan

- 没有使用 `TODO`、`TBD` 或“稍后实现”这类占位表述。
- 每个任务都给出了明确文件、命令和预期结果。

### Type consistency

- Docker runtime 路径统一使用 `/app`
- 镜像名统一使用 `gold-bot:test`
- workflow 输入名统一使用 `push_image`
