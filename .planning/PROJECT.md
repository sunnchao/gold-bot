# gold-bot：Fibonacci 交易法实现

## What This Is

gold-bot 的 Fibonacci 交易法增强项目。在现有 Go 1.24 交易引擎上，新增 Fibonacci 扩展目标管理（方案 B）和 Fibonacci 回撤入场增强（方案 A），提升系统的盈亏比和趋势交易能力。面向 XAUUSD/GBPJPY 等高波动性品种。

Core Value: 在不增加系统复杂度的前提下，通过 Fibonacci 比例关系提升现有策略的盈亏比和入场精度。

## Requirements

### Validated

- **Pullback** — H1 趋势回调策略（已投产）
- **Breakout Retest** — 突破回踩策略（已投产）
- **Divergence** — RSI + MACD 背离策略（已投产）
- **Breakout Pyramid** — 突破加仓策略（已投产）
- **Momentum Scalp** — M15/M5/M1 剥头皮策略（已投产）
- **Scale In** — 浮亏加仓策略（已投产）
- **Fibonacci 指标计算** — `indicator/fibonacci.go` 已实现 23.6%-78.6% 回撤位计算
- **Bar 结构体** — 已包含 Fib236/Fib382/Fib500/Fib618/Fib786 字段
- **API payload** — 已包含 `fib_236`..`fib_786` 数据输出

### Active

- [ ] **FIB-EXT-01**: 新增 Fibonacci 扩展位计算（127.2%/161.8%/261.8%）
- [ ] **FIB-EXT-02**: 引擎层 TP 计算引入动态 Fib 扩展目标
- [ ] **FIB-EXT-03**: Swing High/Low 波动识别器
- [ ] **FIB-EXT-04**: API payload 扩展（fib_1272/fib_1618/fib_2618 字段）
- [ ] **FIB-EXT-05**: 按品种配置向量（XAUUSD vs GBPJPY 独立参数）
- [ ] **FIB-RET-01**: Fib 回撤区检测函数（isInGoldenPocket）
- [ ] **FIB-RET-02**: pullback 策略集成 Fib 回撤过滤器
- [ ] **FIB-RET-03**: 动态坡道挂单（限价单在 50%/61.8% 回撤位）
- [ ] **FIB-RET-04**: Per-symbol 参数配置（ADX 阈值、回撤容差）
- [ ] **FIB-TEST-01**: 扩展位计算单元测试
- [ ] **FIB-TEST-02**: pullback+Fib 集成测试
- [ ] **FIB-TEST-03**: 回测验证（3个月历史数据）

### Out of Scope

- **Fibonacci 时间周期分析** — 缺乏统计学支撑，不建议实施（四模型一致结论）
- **Fibonacci 数列仓位管理（方案 C）** — 正序数列在浮亏场景下风险过高，3/4 模型反对
- **独立「Fibonacci 回撤入场」新策略** — 与 pullback 信号冗余，融合为增强模式更优（Kimi/GLM/Qwen 一致主张）
- **全量替换现有 TP 逻辑** — Fib 扩展目标作为可选项，默认关闭，不影响现有行为

## Context

- **现有基础设施**：`indicator/fibonacci.go` 已计算回撤位，Bar 结构体、API payload 已包含字段
- **现有策略引擎**：`internal/strategy/engine/engine.go` 的 `Analyze()` 函数依次调用各策略方法
- **现有多模型分析**：DeepSeek V4 Pro / Kimi K2.6 / GLM 5.1 / Qwen 3.7 四模型已评估，一致建议实施
- **共识结论**：方案 B（扩展目标）收益风险比最高 → 方案 A（回撤增强）→ 方案 C 和时间周期分析：不做
- **现有 pullback 策略**：在 `engine.go` 的 `checkPullback()` 中实现，基于 H1 EMA 回调 + RSI 确认

## Constraints

- **技术栈**: Go 1.24，纯静态编译（CGO_ENABLED=0）
- **向后兼容**: 新增功能必须默认关闭，不影响现有策略行为和测试
- **配置驱动**: 所有参数通过 `StrategyConfig` 结构体 + 环境变量覆盖
- **代码规范**: 遵循现有策略模式（方法签名 `checkXxx(h1, h4, m30, m15) (*domain.Signal, domain.AnalysisLog)`）
- **测试要求**: 新代码必须附带单元测试，通过 `go test ./internal/strategy/...`
- **数据依赖**: 仅依赖现有指标（ADX/EMA/RSI/ATR/MACD），不引入外部数据源

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 先做 B（扩展目标），后做 A（回撤增强） | B 改动最小、惠及所有策略、风险最低 | ✓ Good |
| A 不做独立策略，作为 pullback 增强 | 避免与 pullback 信号冗余和仓位重叠 | ✓ Good |
| Fib 扩展位在 indicator 层计算，引擎层可选启用 | 分层清晰，策略不感知，零侵入 | — Pending |
| Swing High/Low 基于固定窗口滚动计算 | 复用现有 50-bar 窗口，不与已有计算冲突 | — Pending |
| 扩展位默认关闭，需配置显式开启 | 向后兼容，不影响现有策略行为 | — Pending |

## Evolution

**After each phase:**
1. Requirements validated? → Move to Validated
2. New decisions? → Add to Key Decisions
3. Context update? → Current state

---
*Last updated: 2026-06-13 after multi-model analysis review (DeepSeek/Kimi/GLM/Qwen)*
