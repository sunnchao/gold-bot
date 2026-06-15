# ROADMAP.md

**Project:** Fibonacci 交易法实现  
**Milestone:** v1.3.0  
**Created:** 2026-06-13

## Phase Overview

| # | Phase | Goal | Effort | Status |
|---|-------|------|--------|--------|
| 1 | Fib Extension Target Management | 新增 Fibonacci 扩展位计算 + 引擎 TP 增强层 | Medium | ✅ Complete |
| 2 | Fib Retracement Pullback Enhancement | 将 Fib 回撤区融合为 pullback 策略增强过滤器 | Medium | ✅ Complete |
| 3 | AI Signal Pending Order | AI approve 直通 PENDING 挂单，手数减半，4h 过期 | Small | Pending |

## Phase Details

### Phase 1 — Fib Extension Target Management

**Goal:** 所有现有策略可选择使用 Fibonacci 扩展位作为动态止盈，提升盈亏比。

**Requirements:** FIB-EXT-01 ~ FIB-EXT-12, FIB-TEST-01 ~ FIB-TEST-04

**Files to modify:**
- `internal/strategy/indicator/fibonacci.go` — 新增扩展位计算
- `internal/strategy/engine/engine.go` — 新增 TP 建议层
- `internal/strategy/engine/config.go` — 新增配置参数
- `internal/domain/strategy.go` — 新增字段
- `internal/strategy/engine/engine_test.go` — 单元测试

**Success Criteria:**
- [ ] `CalculateFibExtension()` 对 XAUUSD/GBPJPY 典型 Swing 返回正确扩展值
- [ ] `Enabled=false` 时，所有策略的 TP 行为与修改前完全一致
- [ ] `Enabled=true` 时，策略首次输出带有 Fib 扩展位的 Signal
- [ ] 所有已有测试通过（`go test ./internal/strategy/... -v`）
- [ ] API payload 包含新增扩展位字段

**Risks:**
- Swing High/Low 识别在极端行情中可能不稳定
- H4 vs H1 扩展位冲突时需定义优先级规则

---

### Phase 2 — Fib Retracement Pullback Enhancement

**Goal:** pullback 策略集成 Fibonacci 38.2%-61.8% 回撤区作为入场强确认条件，提升胜率。

**Requirements:** FIB-RET-01 ~ FIB-RET-12, FIB-TEST-05 ~ FIB-TEST-08

**Files to modify:**
- `internal/strategy/indicator/fibonacci.go` — 新增 GoldenPocket 判断
- `internal/strategy/engine/engine.go` — 修改 checkPullback()
- `internal/strategy/engine/config.go` — 新增 Per-symbol Fib 参数
- `internal/strategy/engine/engine_test.go` — 单元测试

**Success Criteria:**
- [ ] 价格在 38.2%-61.8% 回撤区内 → pullback 信号增强触发
- [ ] 价格在回撤区外但其他条件满足 → 非增强模式仍可触发（若关闭 Fib 过滤器）
- [ ] XAUUSD 和 GBPJPY 使用不同的 ADX 阈值 (25 vs 28)
- [ ] `Enabled=false` 时 pullback 行为完全不变
- [ ] 所有已有测试通过

**Risks:**
- 假突破可能导致价格短暂进入回撤区后继续反向
- 多周期确认可能延迟入场，错过强单边行情

---

### Phase 3 — AI Signal Pending Order

**Goal:** AI approve 信号直通 PENDING 挂单执行，手数减半，4h 过期，保持策略引擎独立。

**Requirements:** AI-PEND-01 ~ AI-PEND-17

**Files to modify:**
- `internal/api/handlers_ai.go` — 新增 AI approve 命令生成逻辑 (+80行)
- `internal/legacy/live_trading.go` — 导出 `OrderTypeForSignal()`
- `internal/legacy/store.go` — `CommandStore` 接口新增 `FindPendingAI()`
- `internal/store/sqlite/commands.go` — SQLite 实现 `FindPendingAI()`
- `internal/store/pg/commands.go` — PostgreSQL 实现 `FindPendingAI()`
- `gold-analysis-agent/src/agents/sr-analyst.ts` — 移除 M5 周期
- `gold-analysis-agent/src/agents/risk-manager.ts` — 移除 M5 周期

**Success Criteria:**
- [ ] AI approve 信号正确生成 PENDING 命令，手数减半
- [ ] 4h 过期时间正确设置
- [ ] 5层保护全部生效（RiskGate/置信度/去重/价格校验/手数下限）
- [ ] 现有 handleAIResult() 的风险命令处理不受影响
- [ ] 所有已有测试通过（`go test ./internal/... -count=1`）
- [ ] gold-analysis-agent 不再使用 M5 周期

**Risks:**
- AI 信号质量未经历史验证，假阳性直接实盘
- 频率控制不够紧可能生成过多挂单
- RiskGate 当前只评估单笔 trade_plan，不掌握全局敞口

---

## Dependency Graph

```
Phase 1 (Fib Extension)
    └── 提供 CalculateFibExtension() 和 swing detection
            │
            ▼
Phase 2 (Fib Pullback Enhancement)
    └── 依赖 Phase 1 的扩展位计算
```

**Note:** Phase 2 必须在 Phase 1 完成后启动，因为 Phase 2 的 TP 计算依赖 Phase 1 的扩展位函数。

---
*Last updated: 2026-06-13 after multi-model analysis*
