# STATE.md

**File:** `.planning/STATE.md`
**Updated:** 2026-07-04

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-03)

**Current focus:** Phase 1 — Core Trading Logic Parity

**Core value:** Node.js app-server 完全替代 Go engine，生产级功能对等

## Current Position

- **Previous Phases (Fibonacci):** ✅ Complete
- **Monorepo Migration:** ✅ Complete — Node.js monorepo 结构建立，~70% 功能对等
- **Phase 1 (Core Trading Logic Parity):** 🔄 In Progress
  - Wave 1 (parallel): ✅ Complete
  - Wave 2 (serial): ⏳ Next
- **Phase 2 (Observability & Ops):** ⏳ Pending
- **Phase 3 (Infrastructure Extensions):** ⏳ Pending

## Completed Deliverables

### Phase 1 Wave 1 — Core Modules (Completed 2026-07-04)

- [x] **1A: SMC Detection** — `packages/trading-core/src/smc/`
  - `types.ts` — SwingPoint, StructureBreak, FVG, OrderBlock, LiquiditySweep, SMCContext
  - `detector.ts` — findSwingPoints, determineTrendDirection, detectStructureBreaks, detectFVGs, detectLiquiditySweeps, detectOrderBlocks, buildSMCContext + helpers
  - `index.ts` — re-export
  - `detector.spec.ts` — 15 tests passing
- [x] **1B: Harmonic Patterns** — `packages/trading-core/src/harmonic/`
  - `types.ts` — HarmonicPattern, HarmonicContext
  - `detector.ts` — detectPatterns, buildContext, extractSwings, 5 pattern specs (Gartley/Bat/Butterfly/Crab/ABCD)
  - `index.ts` — re-export
  - `detector.spec.ts` — 5 tests passing
- [x] **1C: Candlestick Patterns** — `packages/trading-core/src/indicators/candlestick.ts`
  - 10 patterns + detectAllCandlestickPatterns + patternStrength
  - `candlestick.spec.ts` — 7 tests passing
- [x] **1E: Per-Symbol Strategy Config** — `packages/trading-core/src/engine/config.ts`
  - StrategyConfig (50+ fields), TrendConfig, FibExtensionTPConfig, PullbackFibConfig
  - 9 per-symbol configs: Gold, Silver, GBPJPY, JPYCross, EURUSD, GBPUSD, USDCAD, US100CASH, Oil
  - `config.spec.ts` — 14 tests passing
- [x] **1F: Trend Context** — `packages/trading-core/src/engine/config.ts` (TrendConfig type)
  - TrendConfig with enable/disable flag, weights, thresholds
  - Lot multiplier not yet wired into replay.ts (tracked in REWRITE-06)

### Shared Changes

- [x] `packages/trading-core/src/index.ts` — re-export smc, harmonic, candlestick, config
- [x] `packages/shared-contracts/src/strategy.ts` — added `scale_in` strategy name
- [x] `packages/trading-core/src/replay/replay.ts` — added `scale_in` to ReplayStrategyName type

### Test Results

- **10 test files, 179 tests all passing**

## Active Context

### Phase 1 Wave 2 — Scale-in + Integration

**Next tasks:**
1. Add `scaleInSignal()` strategy evaluator in replay.ts
2. Add `calculateUnifiedSL()` + `roundDownScaleInLot()`
3. Wire trend lot multiplier into replay.ts
4. Integrate SMC/harmonic/candlestick/per-symbol-config into replay.ts
5. Update `apps/app-server/src/app.ts` analysisPayload

**Risks:**
- replay.ts 已有 ~2900 行，新增代码需注意可维护性
- SMC/harmonic 集成需要确保与 Go 的输出一致性

---
*Last updated: 2026-07-04*
