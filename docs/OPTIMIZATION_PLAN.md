# Gold Bot 架构优化方案

**文档版本**: 1.0  
**创建日期**: 2026-06-26  
**目标**: 提升系统稳定性、性能和可维护性

---

## 执行摘要

本文档基于对 Gold Bot 量化交易系统的全面评估，提出了代码清理和架构优化方案。主要发现：

- **遗留代码**: 约 131MB Python 代码已被 Go 替代，可安全删除
- **高优先级问题**: 5 个关键架构问题需在 3 个月内解决（数据库、监控、风控）
- **预期收益**: 系统吞吐量提升 10x，故障响应时间从小时级降至分钟级

---

## 目录

1. [遗留代码清理方案](#1-遗留代码清理方案)
2. [架构优化建议](#2-架构优化建议)
3. [实施路线图](#3-实施路线图)
4. [风险评估与缓解](#4-风险评估与缓解)

---

## 1. 遗留代码清理方案

### 1.1 清理范围

根据 ARCHITECTURE.md，系统已从 Python 迁移到 Go，以下 Python 代码可安全删除：

#### 可删除文件（~131MB）

| 类别 | 文件/目录 | 大小 | 原因 |
|------|----------|------|------|
| **服务端代码** | app.py | 47KB | 已被 cmd/server/main.go 替代 |
| | config.py | 3KB | 已被 internal/config/ 替代 |
| | token_manager.py | 4KB | 已被 internal/store/sqlite/tokens.go 替代 |
| **业务模块** | agents/ | 8KB | 已被 internal/integration/aurex/ 替代 |
| | utils/ | 15KB | Discord/飞书通知已用 Go 重写 |
| | strategy/ | 25KB | 已被 internal/strategy/ 替代 |
| **构建产物** | .venv/ | 131MB | Python 虚拟环境 |
| | __pycache__/ | 80KB | 字节码缓存 |
| **临时文档** | CODEX_*.md (7个) | 50KB | 已完成的开发任务 |

### 1.2 清理脚本

```bash
#!/bin/bash
# cleanup.sh - 遗留代码清理脚本

set -e

echo "📸 创建备份分支..."
git checkout -b backup/before-cleanup-$(date +%Y%m%d)
git add -A
git commit -m "backup: 清理前快照" || true
git checkout main

echo "🗑️  删除 Python 遗留代码..."
rm -rf app.py config.py token_manager.py __init__.py __main__.py
rm -rf agents/ utils/ strategy/
rm -rf .venv/ __pycache__/ .ruff_cache/
rm -f requirements.txt

echo "📦 归档任务文档..."
mkdir -p .planning/archive/2026-06
mv CODEX_*.md .planning/archive/2026-06/ 2>/dev/null || true

echo "✅ 清理完成！"
```


---

## 2. 架构优化建议

### 2.1 高优先级（1-3 个月）

#### 问题 1: SQLite 不适合生产环境

**风险级别**: 🔴 高  
**影响**: 系统可扩展性

**问题描述**:
- 并发写入串行化（`MaxOpenConns=1`）
- 多账户场景成为瓶颈（10 账户 = 120 req/min）
- 无在线热备份能力
- 单文件损坏导致数据全丢失

**性能对比**:
```
SQLite (WAL 模式):
- 写入吞吐: ~1,000 TPS
- 并发写: 1 (串行)

PostgreSQL + TimescaleDB:
- 写入吞吐: ~10,000 TPS
- 并发写: 10+ 连接
- 支持时序数据优化
```

**优化方案**:
```yaml
# docker-compose.yaml
services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: goldbot
      POSTGRES_USER: goldbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    
  app:
    environment:
      DSN: "postgres://goldbot:${DB_PASSWORD}@postgres:5432/goldbot?sslmode=disable"
```

**迁移步骤**:
```bash
# 1. 导出 SQLite 数据
sqlite3 data/gold_bolt.sqlite .dump > backup.sql

# 2. 启动 PostgreSQL 容器
docker-compose up -d postgres

# 3. 运行迁移
go run cmd/migrate/main.go

# 4. 验证数据一致性
go test ./tests/migration_test.go -v
```

**实施难度**: 中等  
**预计工时**: 3 周  
**收益**: 并发性能提升 10x

---

#### 问题 2: Tick 历史数据缺失

**风险级别**: 🔴 高  
**影响**: 合规性、可审计性

**问题描述**:
- 当前覆盖式存储 `account_state.tick_json`
- 无法回测验证策略
- 无法追溯实际滑点成本
- 不满足金融监管要求

**优化方案**:
```sql
-- 使用 TimescaleDB 时序扩展
CREATE TABLE tick_snapshots (
    id BIGSERIAL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    bid DOUBLE PRECISION NOT NULL,
    ask DOUBLE PRECISION NOT NULL,
    spread DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL, -- 'signal_trigger' | 'minute_ohlc'
    PRIMARY KEY (account_id, symbol, timestamp)
);

-- 转换为超表（自动分区）
SELECT create_hypertable('tick_snapshots', 'timestamp');

-- 自动压缩 7 天前数据
ALTER TABLE tick_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'account_id,symbol'
);

SELECT add_compression_policy('tick_snapshots', INTERVAL '7 days');

-- 自动删除 90 天前数据
SELECT add_retention_policy('tick_snapshots', INTERVAL '90 days');
```

**Go 代码修改**:
```go
// internal/legacy/tick.go
func (h *TickHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // ... 解析 tick 数据
    
    // 1. 更新当前快照（保持兼容）
    if err := h.store.SaveTickSnapshot(ctx, accountID, tick); err != nil {
        return err
    }
    
    // 2. 写入历史表（新增）
    if shouldPersist(tick) { // 每分钟或信号触发时
        if err := h.tickHistory.Insert(ctx, tick); err != nil {
            log.Warn("failed to persist tick history", "error", err)
            // 不阻断主流程
        }
    }
}
```

**实施难度**: 中等  
**预计工时**: 2 周  
**收益**: 满足合规要求，支持精确回测

---

#### 问题 3: 缺少系统监控

**风险级别**: 🔴 高  
**影响**: 运维效率

**问题描述**:
- 无 Prometheus 指标暴露
- 故障发现依赖人工检查
- 无法追踪策略表现趋势

**优化方案**:
```go
// internal/metrics/metrics.go
package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
    SignalCounter = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "goldbot_signals_total",
            Help: "Total trading signals generated",
        },
        []string{"account_id", "symbol", "strategy", "side"},
    )
    
    OrderLatency = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "goldbot_order_latency_seconds",
            Help: "Order execution latency",
            Buckets: []float64{0.1, 0.5, 1, 2, 5},
        },
        []string{"account_id", "order_type"},
    )
    
    AccountEquity = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "goldbot_account_equity_usd",
            Help: "Account equity in USD",
        },
        []string{"account_id"},
    )
    
    EAHeartbeat = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "goldbot_ea_last_heartbeat_seconds",
            Help: "Seconds since last EA heartbeat",
        },
        []string{"account_id"},
    )
)

func init() {
    prometheus.MustRegister(SignalCounter, OrderLatency, AccountEquity, EAHeartbeat)
}
```

**集成到 HTTP 服务器**:
```go
// cmd/server/main.go
import (
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    mux := http.NewServeMux()
    
    // 业务接口
    mux.Handle("/register", registerHandler)
    // ...
    
    // Prometheus metrics 端点
    mux.Handle("/metrics", promhttp.Handler())
    
    log.Fatal(http.ListenAndServe(":8880", mux))
}
```

**Grafana 仪表盘配置**:
```yaml
# grafana/dashboards/goldbot.json
{
  "title": "Gold Bot 监控",
  "panels": [
    {
      "title": "账户净值",
      "targets": [{
        "expr": "goldbot_account_equity_usd"
      }]
    },
    {
      "title": "信号成功率",
      "targets": [{
        "expr": "rate(goldbot_signals_total{result=\"success\"}[5m]) / rate(goldbot_signals_total[5m])"
      }]
    },
    {
      "title": "下单延迟 P99",
      "targets": [{
        "expr": "histogram_quantile(0.99, goldbot_order_latency_seconds)"
      }]
    },
    {
      "title": "EA 心跳状态",
      "targets": [{
        "expr": "goldbot_ea_last_heartbeat_seconds < 120"
      }]
    }
  ]
}
```

**Docker Compose 集成**:
```yaml
# docker-compose.yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    
  grafana:
    image: grafana/grafana:latest
    volumes:
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
```

**实施难度**: 低  
**预计工时**: 1 周  
**收益**: 故障发现时间从小时级降至分钟级

---

#### 问题 4: 风控参数固定

**风险级别**: 🔴 高  
**影响**: 收益稳定性

**问题描述**:
- EA 使用固定风控参数（MaxRiskPercent=2%）
- 无法应对市场波动率变化
- 高波动期风险过大，低波动期收益不足

**优化方案**:
```go
// internal/strategy/riskgate/dynamic.go
package riskgate

import (
    "context"
    "math"
)

type DynamicRiskCalculator struct {
    vixProvider VIXProvider
    accountRepo AccountRepository
}

type DynamicRiskParams struct {
    MaxRiskPercent float64 // 动态风险百分比
    MaxPositions   int     // 动态持仓上限
    MaxDailyLoss   float64 // 动态日亏损限制
}

func (c *DynamicRiskCalculator) Calculate(ctx context.Context, accountID string) (DynamicRiskParams, error) {
    // 基础风险参数
    baseRisk := 2.0
    basePositions := 5
    baseDailyLoss := 5.0
    
    // 1. 获取 VIX 指数（市场恐慌指标）
    vix, err := c.vixProvider.GetCurrent(ctx)
    if err == nil {
        // VIX > 30 (高波动): 减半仓位
        // VIX < 15 (低波动): 增加 20%
        if vix > 30 {
            baseRisk *= 0.5
            basePositions = int(math.Floor(float64(basePositions) * 0.6))
        } else if vix < 15 {
            baseRisk *= 1.2
            basePositions = int(math.Ceil(float64(basePositions) * 1.2))
        }
    }
    
    // 2. 获取账户历史表现
    account, err := c.accountRepo.GetStats(ctx, accountID)
    if err == nil {
        // 最大回撤 > 10%: 降低风险
        if account.MaxDrawdown > 0.1 {
            baseRisk *= 0.7
        }
        
        // Sharpe Ratio < 1: 降低持仓数
        if account.SharpeRatio < 1.0 {
            basePositions = int(math.Floor(float64(basePositions) * 0.8))
        }
        
        // 连续亏损 > 3 笔: 暂停交易
        if account.ConsecutiveLosses > 3 {
            baseRisk = 0 // 触发熔断
        }
    }
    
    // 3. 计算动态日亏损限制（基于 30 日波动率）
    volatility, err := c.calculateRollingVolatility(ctx, accountID, 30)
    if err == nil {
        baseDailyLoss = volatility * 1.5
    }
    
    return DynamicRiskParams{
        MaxRiskPercent: baseRisk,
        MaxPositions:   basePositions,
        MaxDailyLoss:   baseDailyLoss,
    }, nil
}
```

**EA 端集成**:
```mql4
// GoldBolt_Client.mq4
void OnTick() {
    // 定期从服务端获取动态风控参数（每 5 分钟）
    if (TimeCurrent() - g_lastRiskUpdate > 300) {
        UpdateDynamicRiskParams();
    }
    
    // 使用动态参数
    double riskPercent = g_dynamicRiskPercent;
    int maxPos = g_dynamicMaxPositions;
    
    if (riskPercent == 0) {
        Print("⚠️ 风控熔断触发，暂停交易");
        return;
    }
    
    // ... 下单逻辑
}

void UpdateDynamicRiskParams() {
    string url = ServerURL + "/api/risk_params?account_id=" + AccountID;
    string response = HttpGet(url, ApiToken);
    
    // 解析 JSON
    g_dynamicRiskPercent = ParseDouble(response, "max_risk_percent");
    g_dynamicMaxPositions = ParseInt(response, "max_positions");
    g_dynamicMaxDailyLoss = ParseDouble(response, "max_daily_loss");
    
    g_lastRiskUpdate = TimeCurrent();
}
```

**实施难度**: 中等  
**预计工时**: 2 周  
**收益**: 自适应风险管理，提升长期稳定性

---

#### 问题 5: 无灾难恢复方案

**风险级别**: 🔴 高  
**影响**: 业务连续性

**问题描述**:
- 无自动备份机制
- 服务器故障可能导致交易历史丢失
- 无高可用部署方案

**优化方案**:
```yaml
# docker-compose.yaml
services:
  # PostgreSQL 自动备份
  pg-backup:
    image: prodrigestivill/postgres-backup-local
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: goldbot
      POSTGRES_USER: goldbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      SCHEDULE: "@daily"           # 每天备份
      BACKUP_KEEP_DAYS: 7          # 保留 7 天
      BACKUP_KEEP_WEEKS: 4         # 保留 4 周
      BACKUP_KEEP_MONTHS: 6        # 保留 6 月
      HEALTHCHECK_PORT: 8080
    volumes:
      - ./backups:/backups
    depends_on:
      - postgres
  
  # PostgreSQL 主从复制（可选）
  postgres-replica:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: goldbot
      POSTGRES_USER: goldbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_MASTER_HOST: postgres
      POSTGRES_REPLICATION_MODE: slave
    volumes:
      - pgdata_replica:/var/lib/postgresql/data
```

**备份策略**:
```bash
#!/bin/bash
# scripts/backup.sh

# 1. 数据库备份到本地
docker exec postgres pg_dump -U goldbot goldbot > backup_$(date +%Y%m%d).sql

# 2. 上传到对象存储（S3/阿里云 OSS）
aws s3 cp backup_$(date +%Y%m%d).sql s3://goldbot-backups/

# 3. 清理 30 天前的本地备份
find ./backups -name "backup_*.sql" -mtime +30 -delete
```

**灾难恢复流程**:
```bash
# 1. 启动新的 PostgreSQL 实例
docker-compose up -d postgres

# 2. 恢复最新备份
latest_backup=$(ls -t backups/*.sql | head -1)
docker exec -i postgres psql -U goldbot goldbot < $latest_backup

# 3. 验证数据完整性
go test ./tests/recovery_test.go

# 4. 切换 DNS 指向新服务器
```

**实施难度**: 低  
**预计工时**: 1 周  
**收益**: RPO < 24 小时，RTO < 1 小时


---

### 2.2 中优先级（3-6 个月）

#### 问题 6: HTTP 轮询延迟

**风险级别**: 🟡 中  
**影响**: 信号执行时效

**问题描述**:
- EA 每 5 秒轮询一次 `/poll`
- 快速行情时可能错失最佳入场点
- 多账户场景服务端压力大

**优化方案**:
```go
// 方案 A: 服务端推送模式（HTTP 长轮询）
// internal/api/longpoll.go
func (h *LongPollHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    accountID := r.URL.Query().Get("account_id")
    
    // 等待命令或超时（最多 30 秒）
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()
    
    cmd, err := h.commands.WaitForCommand(ctx, accountID)
    if err == context.DeadlineExceeded {
        // 返回空响应，EA 重新连接
        json.NewEncoder(w).Encode([]Command{})
        return
    }
    
    json.NewEncoder(w).Encode([]Command{cmd})
}

// internal/store/sqlite/commands.go
func (r *CommandRepository) WaitForCommand(ctx context.Context, accountID string) (Command, error) {
    // 轮询数据库（每 500ms）
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return Command{}, ctx.Err()
        case <-ticker.C:
            cmd, err := r.GetNextPending(ctx, accountID)
            if err == nil {
                return cmd, nil
            }
        }
    }
}
```

**EA 端修改**:
```mql4
// GoldBolt_Client.mq4
void OnTick() {
    // 长轮询模式（阻塞等待，服务端超时返回）
    string url = ServerURL + "/api/longpoll?account_id=" + AccountID + "&timeout=30";
    string response = HttpGet(url, ApiToken); // 最多等 30 秒
    
    if (response != "[]") {
        ProcessCommands(response);
    }
    
    // 无延迟，立即重连
}
```

**方案 B: WebSocket（理想但实施困难）**
- MQL4 不原生支持 WebSocket
- 需要编写 DLL 或使用第三方库
- 维护成本高

**推荐**: 先实施长轮询，观察效果后再考虑 WebSocket

**实施难度**: 中等  
**预计工时**: 3 周  
**收益**: 信号延迟从 5 秒降至 < 1 秒

---

#### 问题 7: 策略计算阻塞主线程

**风险级别**: 🟡 中  
**影响**: HTTP 响应时间

**问题描述**:
- 策略分析在 HTTP 请求线程中同步执行
- AI 调用耗时可能达到数秒
- 影响其他 EA 的轮询响应

**优化方案**:
```go
// internal/app/app.go
type App struct {
    db          *sql.DB
    taskQueue   chan Task
    workerPool  *WorkerPool
}

type Task struct {
    Type      string // "strategy_analysis" | "ai_call"
    AccountID string
    Payload   interface{}
    Callback  chan Result
}

func (app *App) Start() {
    // 启动 worker 池（根据 CPU 核心数）
    app.workerPool = NewWorkerPool(runtime.NumCPU())
    
    // 策略分析 worker
    for i := 0; i < runtime.NumCPU(); i++ {
        go app.strategyWorker()
    }
    
    // AI 调用 worker（单独线程，避免并发冲突）
    go app.aiWorker()
}

func (app *App) strategyWorker() {
    for task := range app.taskQueue {
        if task.Type != "strategy_analysis" {
            continue
        }
        
        // 执行策略分析
        result := app.strategy.Analyze(task.AccountID, task.Payload)
        
        // 发送结果
        task.Callback <- result
    }
}

// HTTP 处理器改为异步
func (h *BarsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // 快速响应 EA
    w.WriteHeader(http.StatusAccepted)
    w.Write([]byte(`{"status":"processing"}`))
    
    // 异步处理
    go func() {
        callback := make(chan Result, 1)
        h.app.taskQueue <- Task{
            Type:      "strategy_analysis",
            AccountID: accountID,
            Payload:   bars,
            Callback:  callback,
        }
        
        // 等待结果
        result := <-callback
        
        // 如果有信号，入队命令
        if result.Signal != nil {
            h.commands.Enqueue(ctx, result.Signal.ToCommand())
        }
    }()
}
```

**实施难度**: 中等  
**预计工时**: 2 周  
**收益**: HTTP 响应时间从 200ms 降至 < 50ms

---

#### 问题 8: 数据无限累积

**风险级别**: 🟡 中  
**影响**: 查询性能

**问题描述**:
- `command_results` 表无限增长
- 查询性能随时间退化
- 备份恢复时间过长

**优化方案**:
```sql
-- 数据归档策略（PostgreSQL）

-- 1. 创建归档表
CREATE TABLE commands_archive (LIKE commands INCLUDING ALL);
CREATE TABLE command_results_archive (LIKE command_results INCLUDING ALL);

-- 2. 归档函数
CREATE OR REPLACE FUNCTION archive_old_data()
RETURNS void AS $$
BEGIN
    -- 移动 30 天前的数据
    WITH moved AS (
        DELETE FROM command_results
        WHERE created_at < NOW() - INTERVAL '30 days'
        RETURNING *
    )
    INSERT INTO command_results_archive
    SELECT * FROM moved;
    
    -- 同步命令表
    WITH moved AS (
        DELETE FROM commands
        WHERE id NOT IN (SELECT command_id FROM command_results)
        AND created_at < NOW() - INTERVAL '30 days'
        RETURNING *
    )
    INSERT INTO commands_archive
    SELECT * FROM moved;
    
    RAISE NOTICE '已归档 % 条记录', (SELECT count(*) FROM moved);
END;
$$ LANGUAGE plpgsql;

-- 3. 定时任务（使用 pg_cron 扩展）
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'archive-old-data',
    '0 3 * * *',  -- 每天凌晨 3 点
    'SELECT archive_old_data()'
);

-- 4. 冷数据导出到 S3（90 天后）
CREATE OR REPLACE FUNCTION export_cold_data()
RETURNS void AS $$
DECLARE
    export_path TEXT;
BEGIN
    export_path := 's3://goldbot-archive/' || to_char(NOW(), 'YYYY-MM') || '.parquet';
    
    EXECUTE format('
        COPY (
            SELECT * FROM command_results_archive
            WHERE created_at < NOW() - INTERVAL ''90 days''
        ) TO PROGRAM ''aws s3 cp - %s''
        WITH (FORMAT parquet)
    ', export_path);
    
    -- 删除已导出数据
    DELETE FROM command_results_archive
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
```

**Go 代码集成**:
```go
// internal/store/sqlite/commands.go
func (r *CommandRepository) ListRecent(ctx context.Context, accountID string, limit int) ([]Command, error) {
    // 默认只查询热数据（7 天内）
    query := `
        SELECT * FROM commands
        WHERE account_id = ? 
        AND created_at > datetime('now', '-7 days')
        ORDER BY created_at DESC
        LIMIT ?
    `
    return r.query(ctx, query, accountID, limit)
}

// 查询归档数据需要显式调用
func (r *CommandRepository) ListArchived(ctx context.Context, accountID string, start, end time.Time) ([]Command, error) {
    query := `
        SELECT * FROM commands_archive
        WHERE account_id = ? 
        AND created_at BETWEEN ? AND ?
        ORDER BY created_at DESC
    `
    return r.query(ctx, query, accountID, start, end)
}
```

**实施难度**: 低  
**预计工时**: 2 周  
**收益**: 主表查询速度提升 3-5x

---

#### 问题 9: 测试覆盖率不足

**风险级别**: 🟡 中  
**影响**: 代码质量

**问题描述**:
- 策略逻辑缺少单元测试
- 回归风险高
- 参数调优依赖人工验证

**优化方案**:
```go
// internal/strategy/engine/pullback_test.go
package engine

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestPullbackStrategy_BullishSignal(t *testing.T) {
    tests := []struct {
        name     string
        snapshot domain.AnalysisSnapshot
        want     *domain.Signal
        wantErr  bool
    }{
        {
            name: "标准看涨信号",
            snapshot: domain.AnalysisSnapshot{
                Symbol:       "XAUUSD",
                CurrentPrice: 2650.0,
                Bars: map[string][]domain.Bar{
                    "H1": {
                        {Close: 2640, ADX: 30.0, RSI: 28.0, EMA20: 2655},
                        {Close: 2650, ADX: 32.0, RSI: 35.0, EMA20: 2655},
                    },
                },
            },
            want: &domain.Signal{
                Side:     "BUY",
                Strategy: "pullback",
                Entry:    2650.0,
                StopLoss: 2640.0,
                Score:    7,
            },
        },
        {
            name: "ADX 不足应拒绝",
            snapshot: domain.AnalysisSnapshot{
                Symbol:       "XAUUSD",
                CurrentPrice: 2650.0,
                Bars: map[string][]domain.Bar{
                    "H1": {
                        {Close: 2640, ADX: 20.0, RSI: 28.0, EMA20: 2655}, // ADX < 25
                        {Close: 2650, ADX: 22.0, RSI: 35.0, EMA20: 2655},
                    },
                },
            },
            want: nil,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            engine := New(WithConfig(DefaultConfig()))
            got, err := engine.Analyze(tt.snapshot)
            
            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            
            assert.NoError(t, err)
            
            if tt.want == nil {
                assert.Nil(t, got)
            } else {
                assert.Equal(t, tt.want.Side, got.Side)
                assert.Equal(t, tt.want.Strategy, got.Strategy)
                assert.InDelta(t, tt.want.Entry, got.Entry, 1.0)
            }
        })
    }
}

// 基准测试
func BenchmarkPullbackStrategy(b *testing.B) {
    engine := New(WithConfig(DefaultConfig()))
    snapshot := /* ... */
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        engine.Analyze(snapshot)
    }
}
```

**测试覆盖率目标**:
```bash
# 运行测试并生成覆盖率报告
go test ./internal/strategy/... -coverprofile=coverage.out
go tool cover -html=coverage.out -o coverage.html

# 目标覆盖率
# - 策略引擎: 80%+
# - 风控模块: 90%+
# - HTTP 处理器: 60%+
```

**实施难度**: 中等  
**预计工时**: 4 周（分阶段补充）  
**收益**: 减少生产事故，加速迭代

---

### 2.3 低优先级（优化项）

#### 问题 10: 配置管理分散

**优化方案**: 使用 PostgreSQL NOTIFY 或 Redis Pub/Sub 实现配置热更新

#### 问题 11: 缺少分布式追踪

**优化方案**: 集成 OpenTelemetry 追踪信号生命周期

#### 问题 12: 单体架构扩展受限

**优化方案**: 账户数超过 50 个时考虑微服务拆分


---

## 3. 实施路线图

### 3.1 时间线

```
2026 Q3 (7-9 月) - 高优先级
├── Week 1-3:  PostgreSQL 迁移 + TimescaleDB 集成
├── Week 4-5:  Tick 历史数据保留
├── Week 6:    Prometheus + Grafana 监控
├── Week 7-8:  动态风控参数
└── Week 9:    灾难恢复方案

2026 Q4 (10-12 月) - 中优先级
├── Week 10-12: HTTP 长轮询实现
├── Week 13-14: 异步任务队列
├── Week 15-16: 数据归档策略
└── Week 17-20: 单元测试补全（分阶段）

2027 H1 - 评估与优化
├── 监控运行指标
├── 评估微服务拆分必要性
└── 性能调优
```

### 3.2 里程碑

| 里程碑 | 目标日期 | 交付物 | 成功标准 |
|--------|---------|--------|---------|
| **M1: 生产就绪** | 2026-09-30 | PostgreSQL + 监控 + 备份 | - 并发写入 > 100 TPS<br>- 故障发现 < 5 分钟<br>- RPO < 24 小时 |
| **M2: 性能优化** | 2026-12-31 | 长轮询 + 异步队列 | - 信号延迟 < 1 秒<br>- HTTP P99 < 100ms<br>- 测试覆盖率 > 70% |
| **M3: 评估扩展** | 2027-06-30 | 运行报告 + 扩展方案 | - 支持 50+ 账户<br>- 99.9% 可用性<br>- 决策微服务拆分 |

### 3.3 资源需求

| 角色 | 工时估算 | 职责 |
|------|---------|------|
| **后端开发** | 12 周 | Go 代码开发、测试 |
| **MQL4 开发** | 4 周 | EA 端集成、风控参数对接 |
| **DevOps** | 4 周 | Docker 配置、监控部署、备份策略 |
| **QA 测试** | 6 周 | 回归测试、性能测试 |

### 3.4 依赖关系

```mermaid
graph TD
    A[PostgreSQL 迁移] --> B[Tick 历史保留]
    A --> C[数据归档]
    A --> D[灾难恢复]
    
    B --> E[精确回测]
    C --> F[查询优化]
    
    G[Prometheus 监控] --> H[告警规则]
    G --> I[性能分析]
    
    J[动态风控] --> K[VIX 数据源]
    J --> L[EA 参数对接]
    
    M[长轮询] --> N[EA 端改造]
    O[异步队列] --> P[HTTP 性能提升]
```

---

## 4. 风险评估与缓解

### 4.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **PostgreSQL 迁移数据丢失** | 低 | 高 | 1. 完整备份 SQLite<br>2. 双写验证<br>3. 灰度切换 |
| **长轮询 EA 端不稳定** | 中 | 中 | 1. 保留轮询兜底<br>2. 超时自动降级<br>3. 充分测试 |
| **监控数据量过大** | 中 | 低 | 1. 设置合理采样率<br>2. 启用 Prometheus 压缩<br>3. 定期清理旧数据 |
| **动态风控误判** | 中 | 高 | 1. 保留人工覆盖开关<br>2. 详细日志记录<br>3. 分阶段灰度 |

### 4.2 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **迁移期间服务中断** | 低 | 高 | 1. 非交易时段操作<br>2. 蓝绿部署<br>3. 快速回滚预案 |
| **参数调优影响收益** | 中 | 中 | 1. 模拟盘先验证<br>2. 小仓位灰度<br>3. 实时监控回撤 |
| **历史数据查询变慢** | 低 | 低 | 1. 归档表单独索引<br>2. 缓存常用查询<br>3. 异步导出报表 |

### 4.3 回滚方案

#### PostgreSQL 迁移回滚
```bash
#!/bin/bash
# rollback_postgres.sh

echo "🔙 回滚到 SQLite..."

# 1. 停止 Go 服务
docker-compose stop app

# 2. 修改环境变量
sed -i 's|DSN=postgres://|#DSN=postgres://|g' .env
sed -i 's|#DSN=data/gold_bolt.sqlite|DSN=data/gold_bolt.sqlite|g' .env

# 3. 从 PostgreSQL 导出最新数据（可选）
docker exec postgres pg_dump -U goldbot goldbot > rollback_$(date +%Y%m%d).sql

# 4. 重启服务
docker-compose up -d app

echo "✅ 已回滚到 SQLite"
```

#### 长轮询回滚
```mql4
// EA 端添加功能开关
input bool UseLongPolling = false; // 可随时切换

void OnTick() {
    if (UseLongPolling) {
        PollCommandsLong(); // 长轮询模式
    } else {
        PollCommandsShort(); // 传统轮询（兜底）
    }
}
```

---

## 5. 成功指标

### 5.1 性能指标

| 指标 | 当前值 | 目标值 | 测量方法 |
|------|--------|--------|---------|
| **并发写入 TPS** | ~50 | 500+ | Prometheus `rate(goldbot_db_writes[1m])` |
| **HTTP P99 延迟** | 200ms | < 100ms | Prometheus `histogram_quantile(0.99, goldbot_http_latency)` |
| **信号执行延迟** | 5 秒 | < 1 秒 | 信号生成时间 - EA 接收时间 |
| **数据库查询 P95** | 未知 | < 50ms | Prometheus slow query log |

### 5.2 可靠性指标

| 指标 | 当前值 | 目标值 | 测量方法 |
|------|--------|--------|---------|
| **系统可用性** | 未统计 | 99.9% | Uptime Kuma / Grafana 监控 |
| **数据丢失风险 (RPO)** | 未知 | < 24 小时 | 最后备份时间 |
| **故障恢复时间 (RTO)** | 未知 | < 1 小时 | 灾难恢复演练 |
| **EA 心跳超时率** | 未知 | < 1% | Prometheus `goldbot_ea_heartbeat_timeout_total` |

### 5.3 业务指标

| 指标 | 测量方法 |
|------|---------|
| **策略胜率** | `成功订单数 / 总订单数` |
| **平均盈亏比** | `平均盈利 / 平均亏损` |
| **最大回撤** | `(峰值净值 - 谷值净值) / 峰值净值` |
| **Sharpe Ratio** | `(年化收益率 - 无风险利率) / 年化波动率` |

---

## 6. 附录

### 6.1 参考文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 当前系统架构
- [API.md](./API.md) - API 接口文档
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 部署指南
- [PostgreSQL 最佳实践](https://www.postgresql.org/docs/current/performance-tips.html)
- [Prometheus 监控实践](https://prometheus.io/docs/practices/)
- [TimescaleDB 时序数据优化](https://docs.timescale.com/timescaledb/latest/)

### 6.2 工具清单

| 工具 | 用途 | 文档 |
|------|------|------|
| **TimescaleDB** | 时序数据库 | https://docs.timescale.com |
| **Prometheus** | 指标采集 | https://prometheus.io/docs |
| **Grafana** | 可视化监控 | https://grafana.com/docs |
| **pg_cron** | PostgreSQL 定时任务 | https://github.com/citusdata/pg_cron |
| **OpenTelemetry** | 分布式追踪 | https://opentelemetry.io/docs |

### 6.3 清理检查清单

在执行清理脚本前，请确认：

- [ ] 已创建备份分支 `backup/before-cleanup-YYYYMMDD`
- [ ] 已验证 Go 服务正常运行（`go run cmd/server/main.go`）
- [ ] 已确认 Python 代码无外部依赖（如定时任务、监控脚本）
- [ ] 已归档临时文档到 `.planning/archive/`
- [ ] 已更新 `.gitignore` 排除构建产物
- [ ] 已通知团队成员即将删除的文件

### 6.4 联系方式

如有疑问或需要支持，请联系：

- **架构负责人**: [待填写]
- **运维负责人**: [待填写]
- **项目文档**: `/docs/`

---

**文档修订历史**

| 版本 | 日期 | 修改人 | 修改内容 |
|------|------|--------|---------|
| 1.0 | 2026-06-26 | Claude | 初始版本 |

---

**附件**

- [cleanup.sh](../scripts/cleanup.sh) - 代码清理脚本
- [rollback_postgres.sh](../scripts/rollback_postgres.sh) - 数据库回滚脚本
- [backup.sh](../scripts/backup.sh) - 备份脚本
