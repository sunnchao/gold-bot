# 系统架构

## 当前架构概览

Gold Bot 已完成服务端向 Go 的主干迁移，MQL4/MQL5 EA 保持不变。当前系统由一个 Go 模块化单体统一承载：

- Legacy EA 兼容接口：保持 `/register`、`/heartbeat`、`/tick`、`/bars`、`/positions`、`/poll`、`/order_result` 协议不变
- Admin/API v1：为新控制台和运维接口提供聚合查询与审计数据
- SSE 实时流：取代旧的 Socket.IO 路径，供控制台订阅事件
- Next.js + Tailwind CSS 控制台：静态导出后由 Go 直接托管
- SQLite：开发和生产统一使用 SQLite，持久化层基于 `database/sql`，为 PostgreSQL 迁移预留接口边界

## 运行拓扑

```text
┌────────────────────────────────────────────────────────────┐
│ MT4 / MT5 Terminal (Windows)                              │
│   Gold Bolt EA (MQL4/MQL5, unchanged)                     │
└──────────────────────────────┬─────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌────────────────────────────────────────────────────────────┐
│ Go Server (`cmd/server`)                                  │
│                                                            │
│  internal/legacy      Legacy EA compatibility             │
│  internal/api         Admin API / AI compatibility / EA   │
│  internal/realtime    SSE hub                             │
│  internal/strategy    Indicators / engine / position mgr  │
│  internal/scheduler   Replay + cutover readiness          │
│  internal/store       SQLite repositories + migrations    │
│  internal/integration Discord / Feishu / Aurex adapter    │
│                                                            │
│  Serves `web/dashboard/dist` at `/`                       │
└───────────────┬───────────────────────────┬────────────────┘
                │                           │
                ▼                           ▼
       SQLite (`data/*.sqlite`)      Browser Dashboard
                                      Next.js static export
                                      `/api/v1/*` + SSE
```

## 模块边界

| 模块 | 职责 |
|------|------|
| `internal/app` | 应用装配、HTTP 路由挂载、静态资源托管 |
| `internal/config` | 环境变量配置加载 |
| `internal/domain` | 账户、运行态、命令、事件、策略领域模型 |
| `internal/store` | SQLite 连接与 migration runner |
| `internal/store/sqlite` | 账户、Token、命令、AI 结果等仓储实现 |
| `internal/legacy` | EA 兼容接口与鉴权 |
| `internal/api` | Admin API、AI 兼容接口、Token Admin、EA 版本接口 |
| `internal/realtime` | SSE 订阅/广播 |
| `internal/strategy` | 技术指标、策略引擎、持仓管理 |
| `internal/scheduler` | replay 校验、shadow/cutover readiness 汇总 |
| `web/dashboard` | Next.js + Tailwind CSS 控制台工程 |

## 核心数据流

### 1. EA 兼容链路

```text
EA -> /register    -> accounts / strategy_mapping
EA -> /heartbeat   -> account_runtime
EA -> /tick        -> tick snapshot + runtime heartbeat
EA -> /bars        -> account_state.bars
EA -> /positions   -> account_state.positions
EA -> /poll        -> commands pending -> delivered
EA -> /order_result-> commands delivered -> success / error
```

### 2. AI 兼容链路

```text
GET  /api/analysis_payload/{account_id}
    -> account + runtime + bars + indicators + positions

POST /api/ai_result/{account_id}
    -> account_state.ai_result_json
    -> optional risk-close command enqueue
    -> publish SSE event `ai_result`
```

### 3. 控制台链路

```text
Browser -> GET /              -> Go serves Next static files
Browser -> GET /api/v1/*      -> Admin aggregation APIs
Browser -> GET /api/v1/events/stream?token=...
       -> SSE event stream
```

控制台当前包含：

- `Overview`
- `Accounts`
- `Account Detail`
- `Audit & Cutover`

## 持久化模型

SQLite 目前是系统记录源，开发和生产保持一致。当前持久化包含：

- `accounts`
- `account_runtime`
- `account_state`
- `tokens` / `token_accounts`
- `commands` / `command_results`
- `schema_migrations`

虽然当前生产仍使用 SQLite，但持久化层已经限制在 `database/sql` + SQL migration 这一层，不把 SQLite 特性泄漏到上层业务接口，便于后续切换 PostgreSQL。

## Cutover / Readiness

双轨切换的两个核心能力已经进入 Go 主干：

- `tests/replay/replay_test.go`：用固定快照验证策略和持仓管理输出
- `internal/scheduler/shadow.go`：统一生成 cutover readiness 报告

当前 readiness 规则：

- `protocol_error_rate == 0`
- `signal_drift_rate <= 0.02`
- `command_drift_rate <= 0.02`
- 已完成 replay 校验
- 已具备 shadow 流量样本

当前默认运行态仍是 `Baseline Only`：

- replay 已验证
- shadow 流量统计入口已就位
- 但默认仓库还没有接入真实 mirrored traffic，因此 overview / audit 会显示待补 shadow 证据

## 前端托管模型

`web/dashboard` 使用 Next.js 静态导出：

- `next build` 输出到 `web/dashboard/dist`
- Go 在运行时直接托管该目录
- `/accounts/{account_id}` 通过静态占位页面 + Go 路由 fallback 实现刷新可用
- 生产环境不需要 Node SSR 进程

## 外部集成

- Discord：`internal/integration/discord`
- 飞书：`internal/integration/feishu`
- EA 版本分发：`internal/ea`
- AI 兼容：`internal/integration/aurex`

## 相关文档

- [API 文档](./API.md)
- [部署指南](./DEPLOYMENT.md)
- [更新日志](./CHANGELOG.md)
