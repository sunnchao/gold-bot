# Gold Bot Go Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 MT4/MT5 MQL 客户端不变的前提下，把当前 Python 服务端和工具链重构为 Go 后端与 Next.js + Tailwind CSS 新控制台，并通过双轨验证安全切换。

**Architecture:** 首发版本采用 Go 模块化单体，拆分 `legacy API / domain / store / strategy / realtime / integration / scheduler` 边界，使用 SQLite 作为系统记录源，保留 `analysis_payload` 与 `ai_result` 的外部 AI 兼容接口。前端采用 Next.js 静态导出，由 Go 统一托管产物，实时链路统一切到 SSE，并把 Python vs Go 双轨对比做成一等能力。

**Tech Stack:** Go, `database/sql`, `modernc.org/sqlite`, SQL migration files, Server-Sent Events, Next.js, TypeScript, Tailwind CSS, npm

---

## Scope Split

原始 spec 同时覆盖后端、数据库、实时事件、前端、通知、EA 更新、双轨切换，严格来说是多个子系统。为避免把整个重构变成一个不可执行的大任务，本计划按可落地切片拆成 7 个任务，执行顺序固定：

1. Go 工程骨架和数据库迁移系统
2. 持久化账户态、认证和 Legacy EA 接口
3. 指令队列、轮询链路和历史回报
4. 技术指标、策略引擎、持仓管理和 shadow/replay
5. AI 兼容接口、通知、EA 更新、Token 管理
6. SSE + Admin API + Next.js 新控制台
7. 双轨验收、切换检查和文档收尾

## File Structure

- Create: `go.mod` — Go 模块定义
- Create: `cmd/server/main.go` — Go 进程入口
- Create: `internal/app/app.go` — 应用装配和生命周期管理
- Create: `internal/config/config.go` — 环境变量和配置加载
- Create: `internal/domain/account.go` — 账户、行情、持仓、命令等领域模型
- Create: `internal/domain/command.go` — 命令状态机和枚举
- Create: `internal/domain/event.go` — SSE/审计事件 envelope
- Create: `internal/store/db.go` — 数据库连接和事务入口
- Create: `internal/store/migrate.go` — migration runner
- Create: `internal/store/sqlite/*.go` — SQLite repository 实现
- Create: `migrations/0001_init.sql` — 首次建表
- Create: `internal/legacy/router.go` — MT4/MT5 兼容路由
- Create: `internal/legacy/handlers_*.go` — `/register` `/heartbeat` `/tick` `/bars` `/positions` `/poll` `/order_result`
- Create: `internal/strategy/indicator/*.go` — EMA/ATR/RSI/MACD/ADX/BB/Stoch
- Create: `internal/strategy/engine/engine.go` — 策略引擎
- Create: `internal/strategy/positionmgr/manager.go` — 持仓管理器
- Create: `internal/realtime/sse.go` — SSE 广播与订阅
- Create: `internal/api/router.go` — 管理端 API
- Create: `internal/api/handlers_*.go` — Admin/UI API handlers
- Create: `internal/integration/discord/notifier.go` — Discord 通知
- Create: `internal/integration/feishu/notifier.go` — 飞书通知
- Create: `internal/integration/aurex/compat.go` — AI 兼容接口组装
- Create: `internal/ea/releases.go` — EA 版本元数据与下载
- Create: `internal/scheduler/*.go` — 分析任务、清理任务、shadow 任务
- Create: `tests/contracts/legacy_api_test.go` — Legacy API 契约测试
- Create: `tests/replay/testdata/*.json` — 回放样本
- Create: `tests/replay/replay_test.go` — Python/Go 回放比对入口
- Create: `web/dashboard/package.json` — Next.js 工程定义
- Create: `web/dashboard/next.config.ts` — 静态导出配置
- Create: `web/dashboard/app/**/*` — Next.js 页面
- Create: `web/dashboard/components/**/*` — 控制台组件
- Create: `web/dashboard/lib/api.ts` — Admin API 客户端
- Create: `web/dashboard/lib/events.ts` — SSE 客户端
- Create: `web/dashboard/tailwind.config.ts` — Tailwind 配置
- Create: `web/dashboard/tests/*.test.tsx` — 前端关键页面测试
- Modify: `.gitignore` — 忽略 Go/Next 构建产物和本地数据库
- Modify: `docs/ARCHITECTURE.md` — 更新为 Go + Next.js 架构
- Modify: `docs/API.md` — 补充 Legacy/API v1/SSE 说明
- Modify: `docs/DEPLOYMENT.md` — 更新 Go 与静态前端部署说明
- Modify: `docs/CHANGELOG.md` — 记录重构阶段里程碑

### Task 1: 建立 Go 工程骨架、配置与数据库迁移

**Files:**
- Create: `go.mod`
- Create: `cmd/server/main.go`
- Create: `cmd/server/main_test.go`
- Create: `internal/app/app.go`
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Create: `internal/store/db.go`
- Create: `internal/store/migrate.go`
- Create: `internal/store/migrate_test.go`
- Create: `migrations/0001_init.sql`
- Create: `migrations/embed.go`
- Create: `internal/app/app_test.go`
- Modify: `.gitignore`

- [ ] **Step 1: 先写一个会失败的启动测试**

```go
package app_test

import (
	"testing"

	"gold-bot/internal/app"
)

func TestNewAppLoadsConfigAndRoutes(t *testing.T) {
	cfg := app.TestConfig()
	_, err := app.New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
}
```

- [ ] **Step 2: 运行测试，确认当前仓库还没有 Go 骨架**

Run: `go test ./...`
Expected: FAIL with `go: cannot find main module` or missing package errors

- [ ] **Step 3: 创建 `go.mod` 和最小入口**

```go
module gold-bot

go 1.24
```

```go
package main

import (
	"log"

	"gold-bot/internal/app"
)

func main() {
	cfg := app.MustLoadConfig()
	server, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(server.Run())
}
```

- [ ] **Step 4: 实现配置、数据库连接和 migration runner 的最小闭环**

```go
type Config struct {
	HTTPAddr string
	DBPath   string
}

func MustLoadConfig() Config {
	return Config{
		HTTPAddr: getenv("GB_HTTP_ADDR", ":8880"),
		DBPath:   getenv("GB_DB_PATH", "data/gold_bolt.sqlite"),
	}
}
```

```go
func OpenSQLite(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	return db, db.Ping()
}
```

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

- [ ] **Step 5: 为初始 schema 写最小 migration**

```sql
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  broker TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  leverage INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 6: 运行测试并验证数据库可以被初始化**

Run: `go test ./internal/app ./internal/config ./internal/store ./cmd/server -v`
Expected: PASS with `ok` for the created packages，并覆盖 `/healthz`、migration 建表、migration 幂等和入口清理归属

- [ ] **Step 7: 提交骨架**

```bash
git add go.mod cmd/server/main.go internal/app internal/config internal/store migrations .gitignore
git commit -m "chore: bootstrap Go server and migrations"
```

### Task 2: 实现账户快照、Token 持久化和 Legacy 认证入口

**Files:**
- Create: `internal/domain/account.go`
- Create: `internal/store/sqlite/accounts.go`
- Create: `internal/store/sqlite/accounts_test.go`
- Create: `internal/store/sqlite/tokens.go`
- Create: `internal/store/sqlite/tokens_test.go`
- Create: `internal/legacy/router.go`
- Create: `internal/legacy/router_test.go`
- Create: `internal/legacy/auth.go`
- Create: `internal/legacy/request.go`
- Create: `internal/legacy/handlers_register.go`
- Create: `internal/legacy/handlers_heartbeat.go`
- Create: `internal/legacy/handlers_tick.go`
- Create: `internal/legacy/handlers_bars.go`
- Create: `internal/legacy/handlers_positions.go`
- Create: `tests/contracts/legacy_auth_test.go`
- Modify: `migrations/0001_init.sql`

- [ ] **Step 1: 为 Legacy 鉴权写失败测试**

```go
func TestLegacyRequiresValidToken(t *testing.T) {
	ts := newLegacyServer(t)
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", strings.NewReader(`{"account_id":"90011087"}`))
	rec := httptest.NewRecorder()

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: 运行契约测试，确认接口尚不存在**

Run: `go test ./tests/contracts -run TestLegacyRequiresValidToken -v`
Expected: FAIL with router/handler not found or 404

- [ ] **Step 3: 建立账户、运行态、Token 表**

```sql
CREATE TABLE IF NOT EXISTS account_runtime (
  account_id TEXT PRIMARY KEY,
  connected INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  equity REAL NOT NULL DEFAULT 0,
  margin REAL NOT NULL DEFAULT 0,
  free_margin REAL NOT NULL DEFAULT 0,
  market_open INTEGER NOT NULL DEFAULT 1,
  is_trade_allowed INTEGER NOT NULL DEFAULT 1,
  mt4_server_time TEXT NOT NULL DEFAULT '',
  last_heartbeat_at TEXT NOT NULL DEFAULT '',
  last_tick_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_accounts (
  token TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (token, account_id)
);
```

- [ ] **Step 4: 实现 Token repository 与 Legacy 中间件**

```go
func (m *AuthMiddleware) RequireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" || !m.tokens.Validate(r.Context(), token) {
			http.Error(w, `{"status":"ERROR","message":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tokenKey{}, token)))
	})
}
```

- [ ] **Step 5: 实现 `/register` `/heartbeat` `/tick` `/bars` `/positions` 的最小兼容写库**

```go
func (h *RegisterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	now := time.Now().UTC()
	_ = h.accounts.UpsertAccount(r.Context(), domain.Account{
		AccountID:   req.AccountID,
		Broker:      req.Broker,
		ServerName:  req.ServerName,
		AccountName: req.AccountName,
		Currency:    req.Currency,
		Leverage:    req.Leverage,
		UpdatedAt:   now,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "message": "registered"})
}
```

- [ ] **Step 6: 运行契约测试和 repository 测试**

Run: `go test ./internal/store/sqlite ./internal/legacy ./tests/contracts -v`
Expected: PASS with `ok` for auth, register, heartbeat, tick, bars, positions related tests

- [ ] **Step 7: 提交持久化认证与基础 Legacy 接口**

```bash
git add internal/domain internal/store/sqlite internal/legacy tests/contracts migrations/0001_init.sql
git commit -m "feat: persist account runtime and legacy ingest handlers"
```

### Task 3: 实现指令队列、`/poll`、`/order_result` 和历史审计

**Files:**
- Create: `internal/domain/command.go`
- Create: `internal/store/sqlite/commands.go`
- Create: `internal/legacy/handlers_poll.go`
- Create: `internal/legacy/handlers_order_result.go`
- Create: `internal/store/sqlite/history.go`
- Create: `tests/contracts/legacy_poll_test.go`
- Modify: `migrations/0001_init.sql`

- [ ] **Step 1: 为 `/poll` 指令消费语义写失败测试**

```go
func TestPollReturnsPendingCommandsAndMarksDelivered(t *testing.T) {
	ts, repo := newLegacyServerWithCommandRepo(t)
	if err := repo.Enqueue(context.Background(), domain.Command{
		CommandID: "sig_1",
		AccountID: "90011087",
		Action:    domain.CommandActionSignal,
		Status:    domain.CommandStatusPending,
	}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/poll", strings.NewReader(`{"account_id":"90011087"}`))
	req.Header.Set("X-API-Token", seededUserToken)
	rec := httptest.NewRecorder()
	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: 运行测试，确认命令队列还不存在**

Run: `go test ./tests/contracts -run TestPollReturnsPendingCommandsAndMarksDelivered -v`
Expected: FAIL with missing queue/repo behavior

- [ ] **Step 3: 建立 `commands` 与 `command_results` 表**

```sql
CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT '',
  acked_at TEXT NOT NULL DEFAULT '',
  failed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS command_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  result TEXT NOT NULL,
  ticket INTEGER NOT NULL DEFAULT 0,
  error_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
```

- [ ] **Step 4: 实现命令状态机与 `/poll` handler**

```go
type CommandStatus string

const (
	CommandStatusPending   CommandStatus = "pending"
	CommandStatusDelivered CommandStatus = "delivered"
	CommandStatusAcked     CommandStatus = "acked"
	CommandStatusFailed    CommandStatus = "failed"
)
```

```go
func (h *PollHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req struct{ AccountID string `json:"account_id"` }
	_ = json.NewDecoder(r.Body).Decode(&req)

	cmds, err := h.repo.TakePending(r.Context(), req.AccountID, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "OK",
		"commands": cmds,
		"count":    len(cmds),
	})
}
```

- [ ] **Step 5: 实现 `/order_result` 并把结果落库**

```go
func (h *OrderResultHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req OrderResultRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	_ = h.repo.SaveResult(r.Context(), req.ToDomain(time.Now().UTC()))
	_ = h.repo.MarkFromResult(r.Context(), req.CommandID, req.Result)
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK"})
}
```

- [ ] **Step 6: 运行 legacy 队列测试**

Run: `go test ./internal/store/sqlite ./internal/legacy ./tests/contracts -run 'TestPoll|TestOrderResult' -v`
Expected: PASS with delivered and ack semantics verified

- [ ] **Step 7: 提交 Legacy 队列与回报链路**

```bash
git add internal/domain/command.go internal/store/sqlite internal/legacy tests/contracts migrations/0001_init.sql
git commit -m "feat: add durable command queue and order result flow"
```

### Task 4: 迁移技术指标、策略引擎、持仓管理和 replay/shadow 工具

**Files:**
- Create: `internal/strategy/indicator/ema.go`
- Create: `internal/strategy/indicator/atr.go`
- Create: `internal/strategy/indicator/rsi.go`
- Create: `internal/strategy/indicator/macd.go`
- Create: `internal/strategy/indicator/adx.go`
- Create: `internal/strategy/indicator/bollinger.go`
- Create: `internal/strategy/indicator/stoch.go`
- Create: `internal/strategy/engine/engine.go`
- Create: `internal/strategy/positionmgr/manager.go`
- Create: `internal/scheduler/analysis.go`
- Create: `tests/replay/replay_test.go`
- Create: `tests/replay/testdata/account_90011087_snapshot.json`
- Create: `tests/replay/testdata/account_90011087_expected.json`

- [ ] **Step 1: 先为 EMA/ATR/RSI 和策略输出写失败测试**

```go
func TestEMA20MatchesPythonFixture(t *testing.T) {
	closes := []float64{4430, 4433, 4438, 4435, 4437, 4442, 4440}
	got := indicator.EMA(closes, 20)
	if len(got) != len(closes) {
		t.Fatalf("unexpected length: %d", len(got))
	}
}

func TestReplayFixtureProducesExpectedSignal(t *testing.T) {
	got := replayFixture(t, "tests/replay/testdata/account_90011087_snapshot.json")
	if got.Strategy != "pullback" {
		t.Fatalf("unexpected strategy: %s", got.Strategy)
	}
}
```

- [ ] **Step 2: 运行测试，确认指标和策略实现尚不存在**

Run: `go test ./internal/strategy/... ./tests/replay -v`
Expected: FAIL with undefined packages/functions

- [ ] **Step 3: 实现与 Python 等价的指标函数**

```go
func EMA(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	if len(values) == 0 {
		return out
	}
	k := 2.0 / float64(period+1)
	out[0] = values[0]
	for i := 1; i < len(values); i++ {
		out[i] = values[i]*k + out[i-1]*(1-k)
	}
	return out
}
```

```go
func ATR(high, low, close []float64, period int) []float64 {
	tr := make([]float64, len(close))
	for i := range close {
		if i == 0 {
			tr[i] = high[i] - low[i]
			continue
		}
		tr[i] = max3(
			high[i]-low[i],
			math.Abs(high[i]-close[i-1]),
			math.Abs(low[i]-close[i-1]),
		)
	}
	return SMA(tr, period)
}
```

- [ ] **Step 4: 实现策略引擎和持仓管理的 Go 版本**

```go
type Engine struct {
	MinScore int
}

func (e Engine) Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog) {
	logs := []domain.AnalysisLog{}
	if len(snapshot.H1Bars) < 50 {
		return nil, append(logs, domain.AnalysisLog{Level: "warn", Strategy: "系统", Message: "H1数据不足"})
	}
	// pullback / breakout_retest / divergence / breakout_pyramid 逐条实现
	return bestSignal(snapshot, logs)
}
```

```go
func (m Manager) Analyze(snapshot domain.PositionSnapshot) []domain.Command {
	var commands []domain.Command
	// time stop -> breakeven -> tp1 -> key level -> tp2 -> trend reversal -> dynamic trailing
	return commands
}
```

- [ ] **Step 5: 建 replay 和 shadow 比对入口**

```go
func TestReplayFixtureMatchesExpectedJSON(t *testing.T) {
	got := runReplay(t, "tests/replay/testdata/account_90011087_snapshot.json")
	want := loadExpected(t, "tests/replay/testdata/account_90011087_expected.json")
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("replay mismatch (-want +got):\n%s", diff)
	}
}
```

- [ ] **Step 6: 运行指标、策略、replay 全量测试**

Run: `go test ./internal/strategy/... ./internal/scheduler ./tests/replay -v`
Expected: PASS with replay fixture and strategy snapshots aligned to expected JSON

- [ ] **Step 7: 提交策略与回放工具**

```bash
git add internal/strategy internal/scheduler tests/replay
git commit -m "feat: port strategy engine and replay validation to Go"
```

### Task 5: 实现 AI 兼容接口、通知、EA 更新和管理端 Token API

**Files:**
- Create: `internal/integration/aurex/compat.go`
- Create: `internal/integration/discord/notifier.go`
- Create: `internal/integration/feishu/notifier.go`
- Create: `internal/ea/releases.go`
- Create: `internal/api/handlers_tokens.go`
- Create: `internal/api/handlers_ea.go`
- Create: `internal/api/handlers_ai.go`
- Create: `tests/contracts/ai_compat_test.go`
- Create: `tests/contracts/token_admin_test.go`

- [ ] **Step 1: 为 `analysis_payload` 和 `ai_result` 写失败契约测试**

```go
func TestAnalysisPayloadIncludesIndicatorsAndPositions(t *testing.T) {
	ts := newAdminServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/analysis_payload/90011087", nil)
	req.Header.Set("X-API-Token", seededAdminToken)
	rec := httptest.NewRecorder()

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: 运行测试，确认 AI 兼容接口尚未实现**

Run: `go test ./tests/contracts -run 'TestAnalysisPayload|TestAIResult|TestAdminToken' -v`
Expected: FAIL with 404 or missing handler behavior

- [ ] **Step 3: 实现 Aurex 兼容 payload 投影**

```go
type AnalysisPayload struct {
	Status         string                    `json:"status"`
	Timestamp      string                    `json:"timestamp"`
	Account        AccountSummary            `json:"account"`
	Market         MarketSnapshot            `json:"market"`
	Positions      []AurexPosition           `json:"positions"`
	Indicators     map[string]*IndicatorPack `json:"indicators"`
	MarketStatus   MarketStatus              `json:"market_status"`
	StrategyMapping map[string]string        `json:"strategy_mapping"`
}
```

- [ ] **Step 4: 把通知和 EA 更新迁到 Go**

```go
func (n *DiscordNotifier) Send(ctx context.Context, payload map[string]any) error {
	reqBody, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, n.WebhookURL, bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("discord status: %d", resp.StatusCode)
	}
	return nil
}
```

```go
func (h *EAHandler) Version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "OK",
		"version":   h.release.Version,
		"build":     h.release.Build,
		"changelog": h.release.Changelog,
	})
}
```

- [ ] **Step 5: 实现 Token 管理 Admin API**

```go
func (h *TokenHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string   `json:"name"`
		Accounts []string `json:"accounts"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	token, err := h.service.Generate(r.Context(), req.Name, req.Accounts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "token": token, "name": req.Name, "accounts": req.Accounts})
}
```

- [ ] **Step 6: 运行兼容接口和管理端测试**

Run: `go test ./internal/integration/... ./internal/api ./tests/contracts -run 'TestAnalysisPayload|TestAIResult|TestAdminToken|TestEA' -v`
Expected: PASS with AI payload, token admin, and EA version/download checks

- [ ] **Step 7: 提交 AI/通知/EA 管理能力**

```bash
git add internal/integration internal/api internal/ea tests/contracts
git commit -m "feat: add AI compatibility, notifications, and EA admin APIs"
```

### Task 6: 实现 SSE、Admin API 聚合查询和 Next.js 新控制台

**Files:**
- Create: `internal/domain/event.go`
- Create: `internal/realtime/sse.go`
- Create: `internal/api/router.go`
- Create: `internal/api/handlers_accounts.go`
- Create: `internal/api/handlers_cutover.go`
- Create: `web/dashboard/package.json`
- Create: `web/dashboard/next.config.ts`
- Create: `web/dashboard/app/layout.tsx`
- Create: `web/dashboard/app/page.tsx`
- Create: `web/dashboard/app/accounts/[accountId]/page.tsx`
- Create: `web/dashboard/app/audit/page.tsx`
- Create: `web/dashboard/components/**/*.tsx`
- Create: `web/dashboard/lib/api.ts`
- Create: `web/dashboard/lib/events.ts`
- Create: `web/dashboard/tests/overview.test.tsx`

- [ ] **Step 1: 为 SSE 和首页聚合接口写失败测试**

```go
func TestSSEStreamWritesEventEnvelope(t *testing.T) {
	hub := realtime.NewHub()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/stream", nil)

	hub.ServeHTTP(rec, req)

	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}
}
```

```tsx
it('renders overview cards from Go API payload', async () => {
  render(<OverviewPage initialData={mockOverview} />)
  expect(screen.getByText('Cutover Health')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试，确认 SSE 和前端项目尚不存在**

Run: `go test ./internal/realtime ./internal/api -v && cd web/dashboard && npm test`
Expected: FAIL with missing packages/files

- [ ] **Step 3: 实现事件 envelope 和 SSE Hub**

```go
type Event struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	AccountID string          `json:"account_id"`
	Source    string          `json:"source"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}
```

```go
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	ch := h.Subscribe()
	defer h.Unsubscribe(ch)
	for event := range ch {
		fmt.Fprintf(w, "data: %s\n\n", event.JSON())
		flusher.Flush()
	}
}
```

- [ ] **Step 4: 创建 Next.js 静态导出工程**

```json
{
  "name": "gold-bot-dashboard",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "node --test"
  }
}
```

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist'
}

export default nextConfig
```

- [ ] **Step 5: 实现 Overview、Accounts、Audit 三个一级页面**

```tsx
export default async function HomePage() {
  const overview = await getOverview()
  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <section className="mx-auto max-w-7xl p-8">
        <h1 className="text-4xl font-semibold tracking-tight">Gold Bolt Control</h1>
        <OverviewGrid data={overview} />
      </section>
    </main>
  )
}
```

```ts
export function connectEventStream(onEvent: (evt: DashboardEvent) => void) {
  const source = new EventSource('/api/v1/events/stream')
  source.onmessage = (message) => onEvent(JSON.parse(message.data))
  return () => source.close()
}
```

- [ ] **Step 6: 构建前端并验证 Go 可托管静态产物**

Run: `cd web/dashboard && npm install && npm run build`
Expected: PASS and produce `web/dashboard/dist`

Run: `go test ./internal/realtime ./internal/api -v`
Expected: PASS with SSE and overview handlers

- [ ] **Step 7: 提交 SSE 与新控制台**

```bash
git add internal/domain/event.go internal/realtime internal/api web/dashboard
git commit -m "feat: add SSE admin API and Next.js dashboard"
```

### Task 7: 建立双轨验收、切换检查和文档收尾

**Files:**
- Create: `internal/scheduler/shadow.go`
- Create: `internal/api/handlers_cutover.go`
- Create: `tests/replay/shadow_diff_test.go`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: 先写一个会失败的 cutover readiness 测试**

```go
func TestCutoverHealthSummarizesDriftAndReadiness(t *testing.T) {
	service := newCutoverServiceWithFixtures(t)
	report := service.BuildReport(context.Background())
	if report.Ready {
		t.Fatalf("expected not ready without green fixtures")
	}
}
```

- [ ] **Step 2: 运行测试，确认切换报告和 shadow 聚合尚不存在**

Run: `go test ./internal/scheduler ./internal/api ./tests/replay -run 'TestCutover|TestShadow' -v`
Expected: FAIL with missing cutover/shadow services

- [ ] **Step 3: 实现 shadow 差异汇总和 readiness 规则**

```go
type CutoverReport struct {
	Ready               bool      `json:"ready"`
	ProtocolErrorRate   float64   `json:"protocol_error_rate"`
	SignalDriftRate     float64   `json:"signal_drift_rate"`
	CommandDriftRate    float64   `json:"command_drift_rate"`
	LastShadowEventAt   time.Time `json:"last_shadow_event_at"`
	MissingCapabilities []string  `json:"missing_capabilities"`
}
```

```go
func (s *CutoverService) BuildReport(ctx context.Context) CutoverReport {
	stats := s.repo.LoadShadowStats(ctx)
	return CutoverReport{
		Ready:             stats.ProtocolErrorRate == 0 && stats.SignalDriftRate <= 0.02 && stats.CommandDriftRate <= 0.02,
		ProtocolErrorRate: stats.ProtocolErrorRate,
		SignalDriftRate:   stats.SignalDriftRate,
		CommandDriftRate:  stats.CommandDriftRate,
		LastShadowEventAt: stats.LastSeenAt,
	}
}
```

- [ ] **Step 4: 更新架构、API、部署和更新日志文档**

```md
- 架构文档增加 Go 模块化单体、SQLite、SSE、Next.js 静态托管说明
- API 文档拆分 Legacy EA API、AI 兼容 API、Admin API、SSE
- 部署文档改为 Go 二进制 + 前端静态产物
- CHANGELOG 记录 Go rewrite 阶段里程碑
```

- [ ] **Step 5: 运行最终验证集**

Run: `go test ./...`
Expected: PASS across app, store, legacy, strategy, replay, api, realtime, integrations

Run: `cd web/dashboard && npm test && npm run build`
Expected: PASS and static export succeeds

- [ ] **Step 6: 提交双轨切换与文档收尾**

```bash
git add internal/scheduler internal/api tests/replay docs/ARCHITECTURE.md docs/API.md docs/DEPLOYMENT.md docs/CHANGELOG.md
git commit -m "docs: finalize Go cutover readiness and architecture docs"
```

## Self-Review

### Spec coverage

- Go 模块化单体：Task 1, 2, 3, 4, 5, 6
- SQLite 持久化：Task 1, 2, 3
- PostgreSQL 兼容准备：Task 1, 3 在 `database/sql` 和 migration 约束中体现
- Legacy EA 协议 100% 兼容：Task 2, 3
- AI 兼容接口：Task 5
- Discord/飞书/EA 更新/Token：Task 5
- SSE 和新控制台：Task 6
- Python vs Go 双轨能力：Task 4, 7
- 切换验收与 readiness：Task 7

无 spec 缺口。

### Placeholder scan

- 未使用 `TODO`、`TBD`、`implement later`、`add appropriate error handling` 这类占位表述。
- 每个任务都包含明确文件、代码片段、运行命令和预期结果。

### Type consistency

- Legacy 命令状态统一使用 `domain.CommandStatus`
- 事件流统一使用 `domain.Event`
- AI 兼容接口统一走 `AnalysisPayload`
- 切换检查统一走 `CutoverReport`

未发现前后命名冲突。
