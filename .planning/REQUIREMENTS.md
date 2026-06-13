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

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fibonacci 独立入场策略 | 与 pullback 信号冗余，融合增强更优 |
| Fibonacci 时间周期分析 | 四模型一致认为缺乏统计学支撑 |
| Fibonacci 数列仓位管理（方案 C） | 风险过高，3/4 模型反对 |
| 全量替换现有 TP 逻辑 | 扩展目标为可选项，不影响现有行为 |
| 前端 UI 可视化 | 超出当前范围，后续单独考虑 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIB-EXT-01 ~ FIB-EXT-12 | Phase 1 | Pending |
| FIB-RET-01 ~ FIB-RET-12 | Phase 2 | Pending |
| FIB-TEST-01 ~ FIB-TEST-04 | Phase 1 | Pending |
| FIB-TEST-05 ~ FIB-TEST-08 | Phase 2 | Pending |

**Coverage:**
- Phase 1 requirements: 16 total
- Phase 2 requirements: 16 total
- Mapped to phases: 32 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-13*
*Last updated: 2026-06-13 after initial definition*
