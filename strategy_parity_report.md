# Strategy Implementation Parity Report: Go vs Node

**Date:** 2026-07-10  
**Go baseline:** `main-backup-20260706` (`internal/strategy/engine/engine.go`)  
**Node current:** `packages/trading-core/src/replay/replay.ts`

---

## Executive Summary

**Critical Gaps Identified:**
1. **counter_pullback**: Node uses H1 SMC data; Go uses M30/M15 (different timeframe = different signals)
2. **Missing Fibonacci extensions** in Node for pullback/breakout_pyramid TP targets
3. **No SR-based SL/TP logic** (pickSLTP) in Node
4. **Missing scale_in strategy** entirely in Node
5. **Momentum_scalp disabled** in Node (by design)
6. **No multi-timeframe trend rating** applied in Node before scoring
7. **No harmonic pattern context** scoring in Node
8. **Volume confirmation** present in Go, missing in Node for some strategies

---

## 1. PULLBACK STRATEGY

### Entry Logic Comparison

| Component | Go Implementation | Node Implementation | Parity |
|-----------|-------------------|---------------------|---------|
| **ADX threshold** | `pullbackConfig.minAdx` (25) | `pullbackConfig.minAdx` (25) | ✅ MATCH |
| **Trend detection** | EMA20 > EMA50 (BUY), EMA20 < EMA50 (SELL) | Same | ✅ MATCH |
| **Price position** | `price > EMA50` (BUY), `price < EMA50` (SELL) | Same | ✅ MATCH |
| **Distance to EMA20** | 2 consecutive bars within `distAtr * 0.5` | Same | ✅ MATCH |
| **RSI gates** | `< rsiOverbought (70)` for BUY, `> rsiOversold (30)` for SELL | Same | ✅ MATCH |
| **Fib retracement** | Checks price in Fib382-618 zone if enabled + H4 trend | Same | ✅ MATCH |
| **M15 RSI confirm** | Checks M15 RSI for early confirmation (optional) | Same | ✅ MATCH |

### Signal Scoring

| Factor | Go Score Logic | Node Score Logic | Parity |
|--------|---------------|------------------|---------|
| Base score | 5 | 5 | ✅ |
| MACD > 0 (BUY) or < 0 (SELL) | +1 | +1 | ✅ |
| RSI < 50 (BUY) or > 50 (SELL) | +1 | +1 | ✅ |
| ADX > 30 | +1 | +1 | ✅ |
| 2 consecutive bars near EMA20 | +1 | +1 | ✅ |
| Fib zone entry | +1 | +1 | ✅ |

### SL/TP Calculation

| Parameter | Go | Node | Gap |
|-----------|-----|------|-----|
| **Initial SL** | `price ± atr * 1.5` | Same | ✅ |
| **SR-based SL override** | `pickSLTP()` checks EMA20/50, BB, Fib, S1/R1 for better SL | ❌ **Missing** | 🔴 |
| **TP1** | `price ± atr * 1.5` | Same | ✅ |
| **TP2** | `price ± atr * 3.0` | Same | ✅ |
| **Fib extension TP** | `applyFibExtensionTP()` for Fib1272/1618 targets | ❌ **Missing** | 🔴 |
| **Fib SL (if Fib enabled)** | `Fib786 ± atr * 0.5` | Same | ✅ |

### Lookback & Data Requirements

- **Go:** Needs 50+ H1 bars, optional H4 for Fib trend, optional M15 for RSI confirm
- **Node:** Same

---

## 2. BREAKOUT_RETEST STRATEGY

### Entry Logic Comparison

| Component | Go | Node | Parity |
|-----------|-----|------|---------|
| **Lookback window** | 50 bars | 50 bars | ✅ |
| **Confirm window** | 3 bars must touch broken level | 3 bars (counted) | ✅ |
| **Resistance/Support** | Max high / Min low in lookback window | Same | ✅ |
| **Breakout detection** | Last 5 bars break resistance/support | Same | ✅ |
| **Retest distance** | `< atr * 0.5` | Same | ✅ |
| **Touch count** | ≥1 touch within confirmWindow | Same | ✅ |
| **Volume confirmation** | `volume > volSMA * 1.5` → +1 score | Same | ✅ |

### Signal Scoring

| Factor | Go | Node | Parity |
|--------|-----|------|---------|
| Base score | 5 | 5 | ✅ |
| Volume > 1.5x SMA | +1 | +1 | ✅ |
| MACD hist aligned | +1 | +1 | ✅ |
| ADX > 20 | +1 | +1 | ✅ |
| RSI aligned | +1 | +1 | ✅ |
| ≥2 touches (BUY only) | +1 | +1 | ✅ |

### SL/TP Calculation

| Parameter | Go | Node | Gap |
|-----------|-----|------|-----|
| **SL** | `brokenLevel ± atr * 1.5` | Same | ✅ |
| **SR override** | `pickSLTP()` checks SR levels | ❌ **Missing** | 🔴 |
| **TP1** | `price ± atr * 2.0` | Same | ✅ |
| **TP2** | `price ± atr * 4.0` | Same | ✅ |

---

## 3. DIVERGENCE STRATEGY

### Entry Logic Comparison

| Component | Go | Node | Parity |
|-----------|-----|------|---------|
| **Window sizes** | recent=15, previous=15 | Same | ✅ |
| **Bullish divergence** | `recentLow < prevLow && recentRSILow > prevRSILow` | Same | ✅ |
| **Bearish divergence** | `recentHigh > prevHigh && recentRSIHigh < prevRSIHigh` | Same | ✅ |
| **RSI threshold** | Bull: RSI < 40, Bear: RSI > 60 | Same | ✅ |
| **MACD divergence** | Secondary confirmation (MACD histogram divergence) | Same | ✅ |
| **Volume check** | `volume < volSMA * 0.7` → +1 | Same | ✅ |
| **Stochastic** | StochK < 20 (bull) or > 80 (bear) → +1 | Same | ✅ |

### Signal Scoring

| Factor | Go | Node | Parity |
|--------|-----|------|---------|
| Base score | 6 | 6 | ✅ |
| MACD divergence | +1 | +1 | ✅ |
| Volume shrinking | +1 | +1 | ✅ |
| StochK extreme | +1 | +1 | ✅ |

### SL/TP Calculation

| Parameter | Go | Node | Gap |
|-----------|-----|------|-----|
| **SL** | `recentLow/High ± atr * 1.0` | Same | ✅ |
| **SR override** | `pickSLTP()` | ❌ **Missing** | 🔴 |
| **TP1** | `price ± atr * 2.0` | Same | ✅ |
| **TP2** | `price ± atr * 4.0` | Same | ✅ |

---

## 4. COUNTER_PULLBACK STRATEGY

### 🔴 CRITICAL DIFFERENCE: Timeframe Used

| Aspect | Go | Node | Impact |
|--------|-----|------|---------|
| **Primary timeframe** | **M30** (preferred), fallback to M15 | **H1** only | 🔴 **Different signals** |
| **SMC context** | `smcCtx.M30Breaks`, `M30Sweeps`, `M30OBs`, `M30FVGs` | `smcCtx.h1_breaks`, `h1_sweeps`, `h1_obs`, `h1_fvgs` | 🔴 **Non-comparable** |

### Entry Logic Comparison

| Component | Go (M30/M15) | Node (H1) | Parity |
|-----------|--------------|-----------|---------|
| **CHoCH detection** | Recent CHoCH within last 10 bars (M30) | Recent CHoCH within last 10 bars (H1) | ⚠️ Different TF |
| **Sweep matching** | CHoCH UP + BULL sweep, or DOWN + BEAR sweep | Same logic, different data | ⚠️ Different TF |
| **Pullback zone** | `sweepLevel ± atr * 0.5` | Same | ✅ |
| **M15 secondary confirm** | If M30 primary, checks M15 CHoCH for resonance (+1 score) | ❌ **Missing** | 🔴 |

### Signal Scoring

| Factor | Go | Node | Parity |
|--------|-----|------|---------|
| Base score | 5 | 5 | ✅ |
| RSI < 45 (BUY) or > 55 (SELL) | +1 | +1 | ✅ |
| Valid OB near price | +1 | +1 | ✅ |
| MACD aligned | +1 | +1 | ✅ |
| FVG near price | +1 | +1 | ✅ |
| M15 CHoCH resonance | +1 | ❌ **Missing** | 🔴 |

### SL/TP Calculation

| Parameter | Go | Node | Gap |
|-----------|-----|------|-----|
| **SL** | `sweepLevel ± atr * 0.5`, fallback `entry ± atr * 1.5` | Same | ✅ |
| **SR override** | `pickSLTP()` | ❌ **Missing** | 🔴 |
| **TP1** | `price ± atr * 2.0` | Same | ✅ |
| **TP2** | `price ± atr * 4.0` | Same | ✅ |

### Risk Assessment

**Frequency:** Node (H1) will produce **fewer, slower signals** than Go (M30/M15)  
**Quality:** M30 structure is more reliable than H1 for reversal detection  
**Recommendation:** Node should use M30 SMC context to match Go behavior

---

## 5. BREAKOUT_PYRAMID STRATEGY

### Entry Logic Comparison

| Component | Go | Node | Parity |
|-----------|-----|------|---------|
| **ADX threshold** | 30 | 30 | ✅ |
| **Bollinger breakout** | `close > BBUpper` (BUY), `close < BBLower` (SELL) | Same | ✅ |
| **Trend alignment** | EMA20 > EMA50 (BUY), EMA20 < EMA50 (SELL) | Same | ✅ |
| **Order block check** | Checks for opposing OBs within 2 ATR ahead | Same | ✅ |
| **Volume confirmation** | `volume > volSMA * 1.5` → +1 | Same | ✅ |
| **M30 confirmation** | Uses breakout cache + M30 close retest | ❌ **Missing** | 🔴 |

### Signal Scoring

| Factor | Go | Node | Parity |
|--------|-----|------|---------|
| Base score | 6 | 6 | ✅ |
| Volume > 1.5x | +1 | +1 | ✅ |
| ADX > 30 | +1 | +1 | ✅ |
| RSI 55-80 (BUY) or 20-45 (SELL) | +1 | +1 | ✅ |
| MACD aligned | +1 | +1 | ✅ |

### SL/TP Calculation

| Parameter | Go | Node | Gap |
|-----------|-----|------|-----|
| **SL** | `EMA20 ± atr * 1.5` | Same | ✅ |
| **TP1** | `price ± atr * 2.0` | Same | ✅ |
| **TP2** | `price ± atr * 5.0` | Same | ✅ |
| **Fib extension TP** | `applyFibExtensionTP()` | ❌ **Missing** | 🔴 |

### M30 Confirmation (Breakout Cache)

**Go has 2-step confirmation:**
1. H1 closes beyond BB → cache the level + side
2. M30 closes beyond BB → confirm signal

**Node:** Direct signal on H1 close, no M30 confirmation

**Impact:** Node produces more false breakouts

---

## 6. SCALE_IN STRATEGY (Missing in Node)

### ❌ **ENTIRELY MISSING FROM NODE**

Go implementation (`checkScaleIn`):
- **Trigger:** Existing position in floating loss
- **Conditions:**
  - ADX ≥ 25
  - Price moved ≥ 1.5 ATR from last entry
  - Floating loss ≥ 1.5 ATR
  - Max 3 scale-in additions
  - Min interval: 30 minutes
  - Price near technical level (Fib382/500/618, Pivot, EMA50/200)
- **Scoring:** Base 5, +1 for ADX>30, RSI extreme, Fib/Pivot near, MACD aligned
- **SL:** Unified SL for all positions (weighted average)
- **TP:** Based on weighted average entry

**Node:** No equivalent logic

---

## 7. MOMENTUM_SCALP STRATEGY (Disabled in Node)

Node has `evaluateMomentumScalpSignal` but it's **disabled** (line 308-309):
```typescript
// NOTE: momentum_scalp strategy disabled for intraday trading focus
// evaluateMomentumScalpSignal(m15, m5, m1, price, momentumConfig, pricePrecision)
```

Go implementation is active and uses M15 trend + M5 EMA alignment + M1 RSI crossover.

---

## 8. CROSS-CUTTING FEATURES

### H4 Trend Filter

| Go | Node | Gap |
|----|------|-----|
| Checks last 3 H4 bars for EMA20>EMA50 consistency | Same | ✅ |
| ADX < 30 → BLOCK all non-momentum signals | Same | ✅ |
| Filters opposite-direction signals | Same | ✅ |

### Multi-Timeframe Trend Rating

| Go | Node | Gap |
|----|------|-----|
| `BuildTrendContext()` combines D1/H4/H1/M30 | `trendConsensus()` exists | ⚠️ |
| `ApplyTrendRating()` applies -1 or -2 penalty | `applyTrendRatingPenalty()` exists | ⚠️ |
| D1=5%, H4=25%, H1=35%, M30=35% weights | Same weights | ✅ |

**Node has the logic but it's simpler** (no `TrendRatingConfig` tuning)

### M15 Confirmation Boost

| Go | Node | Gap |
|----|------|-----|
| Checks M15 RSI < 40 (BUY) or > 60 (SELL) | Same | ✅ |
| Checks proximity to Fib382/618 | Same | ✅ |
| +1 score boost | Same | ✅ |

### SMC Context Scoring

| Go | Node | Gap |
|----|------|-----|
| CHoCH in direction → +1 | ❌ **Missing** | 🔴 |
| Recent liquidity sweep → +1 | ❌ **Missing** | 🔴 |
| Valid OB near price → +1 | ❌ **Missing** | 🔴 |

**Node only uses SMC for counter_pullback and breakout_pyramid entry conditions, not for scoring other strategies**

### Harmonic Pattern Context

| Go | Node | Gap |
|----|------|-----|
| `harmonic.BuildContext()` detects Gartley/Bat/Butterfly/Crab | ❌ **Missing** | 🔴 |
| Active pattern with score ≥5 → +1 or +2 boost | ❌ **Missing** | 🔴 |

### AI Override Logic

| Go | Node | Gap |
|----|------|-----|
| `calculateSL()` validates AI SL within 0.3-3.0 ATR | `applyAIStopLossOverride()` same range | ✅ |
| `calculateTP()` validates AI TP within 0.5-5.0 ATR | `applyAITakeProfitOverride()` range 0.3-5.0 | ⚠️ Min diff |
| Applied at signal generation | Applied after signal selection | ⚠️ Timing diff |

### Position Conflict Filter

| Go | Node | Gap |
|----|------|-----|
| Same side within 1 ATR → block (except scale_in) | Same side within 1 ATR → block (no scale_in) | ⚠️ |
| Opposite side same strategy within 2 ATR → block | Opposite side within 2 ATR → block (no strategy check) | 🔴 |

**Node is more aggressive** (blocks all hedges, not just same-strategy)

