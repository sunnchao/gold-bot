# Go Docker Workflow Design

## Goal

把当前仍基于 Python 的 Docker 构建与 GitHub Actions 发布流程，改造成适配现有 Go 服务端的单镜像发布链路：

- 镜像内包含 Go 服务端二进制
- 镜像内包含 Next.js 控制台静态产物
- 运行时由 Go 直接托管 `web/dashboard/dist`
- 支持 `workflow_dispatch`
- 继续支持 `v*` tag 发布 GHCR 镜像

## Current State

当前仓库状态：

- `.github/workflows/docker.yml` 已存在，触发方式仅为 `v*` tag push
- 根目录 `Dockerfile` 仍然使用 `python:3.11-slim`
- 当前主程序入口已经是 `cmd/server/main.go`
- 控制台采用 `web/dashboard` 静态导出，由 Go 托管

结论：现有 Docker 构建链路与当前代码主干不兼容，必须改为 Go + Next.js 多阶段构建。

## Scope

本次只修改容器构建与 CI 发布链路：

- 修改根目录 `Dockerfile`
- 新增根目录 `.dockerignore`
- 修改 `.github/workflows/docker.yml`

不在本次范围：

- 不调整业务 API
- 不调整运行时代码结构
- 不新增第二个前端镜像
- 不改 GHCR 仓库命名规则

## Recommended Approach

采用单 Dockerfile 多阶段构建，配合单 workflow 发布。

### Why this approach

- 与当前“Go 统一托管前端静态文件”的架构完全一致
- 镜像交付物单一，部署路径最简单
- 对现有 GHCR tag 发布逻辑改动最小
- 可以在 `workflow_dispatch` 下复用同一套构建逻辑

## Alternatives Considered

### Option A: Single Dockerfile, single workflow

内容：

- 一个多阶段 Dockerfile
- 一个 workflow
- `v*` tag 自动发布
- `workflow_dispatch` 手动触发

优点：

- 改动最小
- 最符合当前需求
- 维护成本最低

缺点：

- workflow 内条件逻辑略多

### Option B: Single workflow with separate build and publish jobs

优点：

- 职责更清晰
- 可把 build 验证与 push 分开

缺点：

- 对当前需求偏重
- 额外引入 job 依赖关系

### Option C: Separate validation and publish workflows

优点：

- CI 职责拆分最清楚

缺点：

- 维护复杂度最高
- 当前没有足够收益

### Recommendation

选择 Option A。

## Dockerfile Design

### Stage 1: Dashboard builder

使用 `node:20`：

- 工作目录进入 `web/dashboard`
- 复制 `package.json` 与 `package-lock.json`
- 执行 `npm ci`
- 复制 dashboard 源码
- 执行 `npm run build`

输出：

- `web/dashboard/dist`

### Stage 2: Go builder

使用 `golang:1.24`：

- 先复制 `go.mod` 与 `go.sum`（如存在）
- 执行 `go mod download`
- 再复制 Go 源码、migrations、EA 元数据和前端静态产物
- 执行 `go build -o /out/gold-bot ./cmd/server`

### Stage 3: Runtime image

运行时镜像采用轻量 Linux 基础镜像，包含：

- `/app/gold-bot` 二进制
- `/app/web/dashboard/dist`
- `/app/mt4_ea` 与版本元数据

默认环境变量：

- `GB_HTTP_ADDR=:8880`
- `GB_DB_PATH=/data/gold_bolt.sqlite`

运行时行为：

- 容器启动直接执行 Go 二进制
- Go 在容器内托管 dashboard 静态页面

## .dockerignore Design

需要排除：

- `.git`
- `.github` 中与构建无关的大文件（如无则不做特判）
- `web/dashboard/node_modules`
- `web/dashboard/.next`
- `web/dashboard/dist`
- `data/*.sqlite*`
- `.codex`
- `.superpowers`
- 其他本地工具缓存

目标：

- 减少构建上下文
- 避免把本地产物或数据库文件打进镜像

## Workflow Design

### Triggers

保留：

- `push.tags: v*`

新增：

- `workflow_dispatch`

### Manual Inputs

`workflow_dispatch` 增加：

- `push_image`
  - 类型：boolean
  - 默认值：`false`

行为：

- tag 触发时总是 push
- 手动触发时只有 `push_image=true` 才 push
- 手动触发且 `push_image=false` 时仅验证镜像可构建

### Metadata and tags

tag 发布时：

- 继续使用 semver tags
- 输出 `{{version}}` 与 `{{major}}.{{minor}}`

手动触发时：

- 输出一个可区分的非正式 tag
- 推荐 `manual-{{sha}}`

### Build settings

- `docker/setup-qemu-action@v3`
- `docker/setup-buildx-action@v3`
- `docker/login-action@v3`
- `docker/metadata-action@v5`
- `docker/build-push-action@v6`

平台继续保持：

- `linux/amd64`
- `linux/arm64`

## Error Handling

### Frontend build failure

如果 `npm ci` 或 `npm run build` 失败，Docker build 直接失败，workflow 停止。

### Go build failure

如果 `go build ./cmd/server` 失败，Docker build 直接失败，workflow 停止。

### Manual non-push path

手动触发但 `push_image=false` 时，必须仍然完成完整镜像 build，只是不推送 registry。

### Runtime path

镜像不依赖 Python。若容器启动失败，问题必须限定在：

- Go 二进制
- 静态资源路径
- 环境变量

而不是遗留 Python entrypoint。

## Verification Plan

### Red-Green checks

先写失败校验，确认当前状态仍是旧 Python 构建：

1. `Dockerfile` 不应再引用 `python:3.11-slim`
2. `Dockerfile` 必须包含 dashboard build 和 Go build
3. workflow 必须包含 `workflow_dispatch`
4. workflow 必须支持手动控制 push 行为

### Local verification

实施后执行：

```bash
docker build -t gold-bot:test .
```

然后至少验证：

```bash
docker run --rm -p 8880:8880 gold-bot:test
curl http://127.0.0.1:8880/healthz
```

必要时再补：

```bash
docker run --rm --entrypoint /app/gold-bot gold-bot:test
```

## Acceptance Criteria

- `Dockerfile` 已切换为 Go + Next.js 多阶段构建
- workflow 同时支持 `v*` tag 与 `workflow_dispatch`
- 手动触发支持只 build 不 push
- 镜像内包含 Go 二进制与 dashboard 静态产物
- 本地 `docker build` 成功
- 容器启动后 `/healthz` 可访问
