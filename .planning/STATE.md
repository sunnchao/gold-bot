# STATE.md

**File:** `.planning/STATE.md`  
**Updated:** 2026-06-15

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-15)

**Current focus:** Phase 3 — AI Signal Pending Order

**Core value:** 让 AI 分析的高质量开仓信号通过 PENDING 挂单直接执行，手数减半，4h 过期。

## Current Position

- **Phase 1:** ✅ Complete — Fib Extension Target Management
- **Phase 2:** ✅ Complete — Fib Retracement Pullback Enhancement
- **Phase 3:** 🔄 In Progress — AI Signal Pending Order

## Completed Deliverables

### Phase 1 — Fib Extension Target (方案B)

- [x] `CalculateFibExtension()` — 127.2%/161.8%/261.8% 扩展位计算
- [x] `IsPriceInFibZone()` — 价格在回撤区判断
- [x] `FibExtensionTPConfig` — 配置开关 (Enabled=false 默认)
- [x] `detectLastSwing()` — Swing High/Low 识别
- [x] `applyFibExtensionTP()` — 引擎非侵入 TP 增强层
- [x] API payload 扩展 `fib_1272`/`fib_1618`/`fib_2618`
- [x] Per-symbol ADX 阈值 (XAUUSD=25, GBPJPY=28)

### Phase 2 — Fib Retracement Pullback Enhancement (方案A)

- [x] `PullbackFibConfig` — 完整配置结构 (RetracementEnabled=false 默认)
- [x] `checkPullback()` 新增 H4/m15 参数
- [x] H4 EMA 趋势方向校验 (方向不一致则跳过)
- [x] 38.2%-61.8% Golden Pocket 价格区间过滤
- [x] 可选 M15 RSI 确认 (默认关闭)
- [x] 止损移至 FIB786 + ATR 缓冲
- [x] TP 联动 Phase 1 扩展目标
- [x] 日志标签 `[STRATEGY] 🌀 pullback+FIB`
- [x] XAUUSD: buffer=0.5, GBPJPY: buffer=0.3 (更严格)
- [x] 5 个新增测试全部通过

## Active Context

### Phase 3 — AI Signal Pending Order

**Current task:** 代码实现 — 通过 Codex 执行

**Files to modify:**
1. `internal/legacy/live_trading.go` — 导出 `OrderTypeForSignal()`
2. `internal/legacy/store.go` — `CommandStore` 接口新增 `FindPendingAI()`
3. `internal/store/sqlite/commands.go` — SQLite 实现
4. `internal/store/pg/commands.go` — PostgreSQL 实现
5. `internal/api/handlers_ai.go` — 核心逻辑 (+80行)
6. `gold-analysis-agent/src/agents/sr-analyst.ts` — M5 移除
7. `gold-analysis-agent/src/agents/risk-manager.ts` — M5 移除

**Risks:**
- AI 信号质量未经验证，假信号直接实盘
- RiskGate 当前只评估单笔 trade_plan，不掌握全局敞口
- 两条独立开仓路径可能在极端行情下产生冲突

---
*Last updated: 2026-06-15*
