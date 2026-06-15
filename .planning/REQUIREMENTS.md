# Requirements: Fibonacci 交易法

**Defined:** 2026-06-13  
**Core Value:** 通过 Fibonacci 比例关系提升现有策略的盈亏比和入场精度

## Phase 1: Fibonacci Extension Target Management (方案B)

### Indicator Layer

- [ ] **FIB-EXT-01**: 新增 `CalculateFibExtension()` 函数，计算 127.2%/161.8%/261.8% 扩展位
- [ ] **FIB-EXT-02**: 扩展位结构体 `FibExtension` 定义（Level1272/Level1618/Level2618）
- [ ] **FIB-EXT-03**: 扩展位基于 swing high/low + trend direction 计算
- [ ] **FIB-EXT-04**: 新增 `IsPriceInFibZone()` 函数，带 ATR 缓冲的价格区间判断

### Engine TP Layer

- [ ] **FIB-EXT-05**: `StrategyConfig` 新增 `FibExtensionTP` 配置块（Enabled/MinADX/Levels）
- [ ] **FIB-EXT-06**: 引擎 `Analyze()` 函数增加 Fib TP 建议层（非侵入式，默认关闭）
- [ ] **FIB-EXT-07**: `calculateDynamicTP()` 函数，根据策略类型和 Fib 扩展位选择最优 TP
- [ ] **FIB-EXT-08**: 新增 `ExtensionSignal` 结构体，携带扩展位字段

### Swing High/Low Detector

- [ ] **FIB-EXT-09**: `detectLastSwing()` 函数，基于 fixed-window high/low 极值识别
- [ ] **FIB-EXT-10**: 支持 per-symbol swing 参数（窗口大小可配置）

### API & Payload

- [ ] **FIB-EXT-11**: API payload 新增 `fib_1272`/`fib_1618`/`fib_2618` 字段
- [ ] **FIB-EXT-12**: Bar 结构体新增 `FibExtension` 嵌套字段

### Testing

- [ ] **FIB-TEST-01**: `TestCalculateFibExtension` — 验证扩展位计算正确性
- [ ] **FIB-TEST-02**: `TestIsPriceInFibZone` — 验证价格区间判断
- [ ] **FIB-TEST-03**: `TestDynamicTPSelection` — 验证 TP 选择逻辑
- [ ] **FIB-TEST-04**: 集成测试：Fib TP 不影响现有策略默认行为（Enabled=false）

## Phase 2: Fibonacci Retracement Pullback Enhancement (方案A)

### Indicator Layer

- [ ] **FIB-RET-01**: 新增 `IsInGoldenPocket()` 函数，判断价格是否在 38.2%-61.8% 回撤区间
- [ ] **FIB-RET-02**: 新增 `CalculateFibExtensionTargets()` 复用函数（与 Phase 1 共享）

### Pullback Strategy Enhancement

- [ ] **FIB-RET-03**: `checkPullback()` 增加 Fib 回撤区过滤器（默认关闭，配置开启）
- [ ] **FIB-RET-04**: `StrategyConfig.Pullback` 新增 `FibRetracementEnabled`/`FibRetracementZone`/`RSIDivConfirmThreshold`
- [ ] **FIB-RET-05**: 当 Fib 过滤器开启：价格必须在 38.2%-61.8% 区域内才允许入场
- [ ] **FIB-RET-06**: 当 Fib 过滤器开启：TP 改用方案 B 的扩展目标（127.2%/161.8%）
- [ ] **FIB-RET-07**: 当 Fib 过滤器开启：止损移至 78.6% 外侧 + ATR 缓冲

### Entry Optimization

- [ ] **FIB-RET-08**: 限价挂单在 50%/61.8% 回撤位（距市价 > 0.3×ATR 时）
- [ ] **FIB-RET-09**: M15 RSI 回调结束确认逻辑（超卖区回归 45-55）

### Per-Symbol Configuration

- [ ] **FIB-RET-10**: `GetStrategyConfigBySymbol` 为 XAUUSD/GBPJPY 分别配置 Fib 参数
- [ ] **FIB-RET-11**: XAUUSD：Fib ADX 阈值=25, 回撤容差=0.5×ATR
- [ ] **FIB-RET-12**: GBPJPY：Fib ADX 阈值=28, 回撤容差=0.3×ATR（更严格，减少假信号）

### Testing

- [ ] **FIB-TEST-05**: `TestPullbackFibFilter` — 验证 Fib 过滤器生效/跳过逻辑
- [ ] **FIB-TEST-06**: `TestPullbackFibGoldenPocket` — 验证价格在区间内触发信号
- [ ] **FIB-TEST-07**: `TestPullbackFibOutOfZone` — 验证价格在区间外跳过信号
- [ ] **FIB-TEST-08**: 集成测试：pullback+Fib 不破坏现有 pullback 非增强模式

## Phase 3: AI Signal Pending Order (新增)

**Defined:** 2026-06-15

### Service-Side (Go)

- [ ] **AI-PEND-01**: 导出 `OrderTypeForSignal()` 为包级函数（`live_trading.go` → `legacy` 包导出）
- [ ] **AI-PEND-02**: `CommandStore` 接口新增 `FindPendingAI(ctx, accountID, symbol, side) (bool, error)`
- [ ] **AI-PEND-03**: SQLite 实现 `FindPendingAI`：查询 commands 表 status=pending + source=ai_approve + 同 symbol+同方向+未过期
- [ ] **AI-PEND-04**: PostgreSQL 实现 `FindPendingAI`：兼容 `JSON_EXTRACT` / `json_extract_path_text` 语法

### AI Approve Command Generation

- [ ] **AI-PEND-05**: `shouldQueueAIPending(plan, gateResult) bool` — 条件检查
- [ ] **AI-PEND-06**: `calcAILots(maxLots) float64` — Ceil(maxLots*0.5/0.01)*0.01
- [ ] **AI-PEND-07**: `pickEntryPrice(zone) float64` — EntryZone midpoint
- [ ] **AI-PEND-08**: `pickTakeProfit(tp []float64) float64` — 取第一个正 TP
- [ ] **AI-PEND-09**: `hasExistingAIPendingOrder(ctx, accountID, symbol, side) bool`
- [ ] **AI-PEND-10**: 主逻辑：handleAIResult() 中新增 AI approve 命令生成块
- [ ] **AI-PEND-11**: PENDING command payload 构造（含 order_type/lots/expiration=4h/source=ai_approve）
- [ ] **AI-PEND-12**: 价格合理性校验（entry 偏离市价 > 3×ATR 拒绝）
- [ ] **AI-PEND-13**: 频率控制 + 去重（同 symbol 同方向已有 AI 挂单时跳过）

### AI Analysis Cycle

- [ ] **AI-PEND-14**: gold-analysis-agent sr-analyst.ts 移除 M5 周期
- [ ] **AI-PEND-15**: gold-analysis-agent risk-manager.ts 移除 M5 周期

### Testing

- [ ] **AI-PEND-16**: 验证现有测试全部通过（`go test ./internal/... -count=1`）
- [ ] **AI-PEND-17**: 验证构建通过（`go build ./...`）

## Out of Scope

| Feature | Reason |
|---------|--------|
| 策略引擎融合层 | 两条路径触发机制不同，不强融 |
| AI 信号 Dashboard | 后续单独考虑 |
| AI 信号历史回测 | 独立的数据科学任务 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AI-PEND-01 ~ AI-PEND-17 | Phase 3 | Pending |

**Coverage:**
- Phase 3 requirements: 17 total
- Mapped to phases: 17 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-13*
*Last updated: 2026-06-13 after initial definition*
