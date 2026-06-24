# GSD: Candlestick Pattern Detection for Gold Trading System

**Author**: 太傅 (Hermes)
**Date**: 2026-06-24
**Status**: Reviewed — v1.2 (fixed 4 P0 blockers identified by claude-opus-4)

---

## 1. Goal

Add Japanese candlestick pattern detection to the gold-bot strategy engine, covering single-candle, dual-candle, and triple-candle formations. Patterns enrich every bar in the `EnrichBars()` pipeline, flow into the LLM analysis payload, and become usable by live strategy logic.

---

## 2. Why

| Reason | Detail |
|--------|--------|
| **Missing capability** | gold-bot has no candlestick detection. gold-analysis-agent has wedge/triangle/channel/elliott-wave but no candlestick primitives (hammer, doji, engulfing, etc.). |
| **LLM leverage** | Candlestick patterns are classic price-action signals — feeding them into the LLM prompt dramatically improves its reversal/continuation reasoning. |
| **Strategy engine** | Hammer/engulfing can gate pullback/breakout entries (e.g., only enter pullback after a bullish engulfing at support). |
| **EA visualization** | Patterns can be drawn on MT4 charts as annotations (arrows, labels), same as existing divergence alerts. |
| **Industry standard** | Every professional trading platform (TradingView, MT4/5, cTrader) has candlestick pattern recognition. |

---

## 3. Design

### 3.1 MVP Scope (v1.1 — reduced from 27 to 10 patterns)

Two AI reviewers independently identified that 27 patterns would produce excessive noise on gold H1. The MVP focuses on 10 high signal-to-noise patterns validated by Bulkowski's statistical backtests for precious metals.

| Pattern | Bars | Direction | Signal Strength |
|---------|------|-----------|----------------|
| Hammer | 1 | Bullish | ★★★★ (reversal at support) |
| Shooting Star | 1 | Bearish | ★★★★ (reversal at resistance) |
| Bullish Engulfing | 2 | Bullish | ★★★★★ (strongest reversal) |
| Bearish Engulfing | 2 | Bearish | ★★★★★ (strongest reversal) |
| Piercing Line | 2 | Bullish | ★★★ (needs ≥63% penetration for strong) |
| Dark Cloud Cover | 2 | Bearish | ★★★ (needs ≥63% penetration for strong) |
| Morning Star | 3 | Bullish | ★★★★ (rare but reliable) |
| Evening Star | 3 | Bearish | ★★★★ (rare but reliable) |
| Three White Soldiers | 3 | Bullish | ★★★ (trend continuation) |
| Three Black Crows | 3 | Bearish | ★★★ (trend continuation) |

**Removed from MVP** (noise/low-value on gold H1):
- All Doji variants (dragonfly, gravestone, standard) — appear every 10-20 bars on H1, flood LLM context
- Spinning Top — "indecision" signal with no actionable edge
- Hanging Man / Inverted Hammer — same shape as Hammer/Shooting Star but poor statistical performance
- Harami (bull/bear) — weak reversal signal on gold
- Tweezer Top/Bottom — 1-pip tolerance impossible on gold at scale
- Marubozu — rare on liquid gold markets
- Three Inside Up/Down — redundant with Engulfing + confirmation
- Abandoned Baby — essentially never occurs in 24h forex (requires two gaps)
- Belt Hold, Kicking — exotic, extremely rare

### 3.2 Architecture

```
gold-bot/
├── internal/
│   ├── domain/
│   │   └── strategy.go          ← add CandlestickPatterns []string to Bar
│   ├── strategy/
│   │   └── indicator/
│   │       ├── candlestick.go   ← NEW: pattern detection logic
│   │       ├── candlestick_test.go ← NEW: tests
│   │       └── apply.go         ← call DetectAll() in EnrichBars()
│   └── api/
│       └── handlers_indicator.go ← expose via /indicator_alerts endpoint (optional)
```

### 3.3 Pattern Catalog (Precise Rules)

#### Index Convention

For multi-bar patterns, `bar[0]` = earlier bar, `bar[len-1]` = latest/current bar. Detection runs in `EnrichBars()` forward loop at every index `i ≥ 2`, checking `bars[i-2]`, `bars[i-1]`, `bars[i]`.

#### Trend Context Detection

Reversal patterns require trend context. **P0 Fix**: TrendContext is NOT available in EnrichBars() — it's constructed later in the live trading flow. Use a simple local trend check instead:

```go
// localTrend returns "bull", "bear", or "neutral" based on 10-bar price action + EMA50
func localTrend(bars []domain.Bar, idx int) string {
    if idx < 10 {
        return "neutral"
    }
    
    // 10-bar higher-highs/lower-lows check
    highCount := 0
    lowCount := 0
    for i := idx - 9; i < idx; i++ {
        if bars[i+1].High > bars[i].High {
            highCount++
        }
        if bars[i+1].Low < bars[i].Low {
            lowCount++
        }
    }
    
    // EMA50 slope check (current vs 5 bars ago)
    ema50Current := bars[idx].EMA50
    ema50Prior := bars[idx-5].EMA50
    emaSlope := (ema50Current - ema50Prior) / ema50Prior
    
    // Combined signal
    if highCount >= 6 && emaSlope > 0.001 {
        return "bull"
    }
    if lowCount >= 6 && emaSlope < -0.001 {
        return "bear"
    }
    return "neutral"
}
```

For reversal patterns:
- Bullish reversal (Hammer, Bullish Engulfing, Morning Star): requires `localTrend != "bull"`
- Bearish reversal (Shooting Star, Bearish Engulfing, Evening Star): requires `localTrend != "bear"`
- Continuation patterns (Three White Soldiers, Three Black Crows): require matching trend

#### Single-candle

| Pattern | Detection Rule (Go pseudocode) |
|---------|-------------------------------|
| **Hammer** | `lowerShadow ≥ max(body*2, ATR*0.15) && upperShadow ≤ body*0.3 && close ≥ (high+low)/2` |
| **Shooting Star** | `upperShadow ≥ max(body*2, ATR*0.15) && lowerShadow ≤ body*0.3 && close ≤ (high+low)/2` |

**P0 Fix**: Added `ATR*0.15` absolute minimum to prevent tiny-body false positives. On XAUUSD H1 (ATR ~20), this means shadow must be ≥ 3 points.

#### Dual-candle

| Pattern | Detection Rule |
|---------|----------------|
| **Bullish Engulfing** | `bars[i-1] bearish && bars[i] bullish && bars[i].open ≤ bars[i-1].close && bars[i].close ≥ bars[i-1].open && bars[i].body > bars[i-1].body` |
| **Bearish Engulfing** | `bars[i-1] bullish && bars[i] bearish && bars[i].open ≥ bars[i-1].close && bars[i].close ≤ bars[i-1].open && bars[i].body > bars[i-1].body` |
| **Piercing Line** | `bars[i-1] bearish && bars[i] bullish && bars[i].open < bars[i-1].close && bars[i].close ≥ bars[i-1].open — (bars[i-1].body * (1-penetration))` |
| **Dark Cloud Cover** | `bars[i-1] bullish && bars[i] bearish && bars[i].open > bars[i-1].close && bars[i].close ≤ bars[i-1].close + (bars[i-1].body * (1-penetration))` |

**Penetration tiers**: ≥50% → weak (strength 0.5), ≥63% → strong (strength 0.8). Use the higher for PIERCING/DARK.

#### Triple-candle

| Pattern | Detection Rule |
|---------|----------------|
| **Morning Star** | `bars[i-2] bearish (body ≥ ATR*0.3), bars[i-1] small body (≤ ATR*0.15) positioned lower than bars[i-2] (bars[i-1].high ≤ bars[i-2].close), bars[i] bullish (body ≥ ATR*0.3) penetrating ≥ midpoint of bars[i-2] body` |
| **Evening Star** | Reverse: `bars[i-2] bullish large, bars[i-1] small body positioned higher, bars[i] bearish large penetrating midpoint` |
| **Three White Soldiers** | `bars[i-2] bullish, bars[i-1] bullish, bars[i] bullish; each close > prior close; each open in prior bar's upper half; bodies similar size (max/min ≤ 1.5)` |
| **Three Black Crows** | Reverse: 3 bearish, each close < prior, open in lower half, similar body sizes |

**Key fix**: Removed strict gap requirement from Morning/Evening Star — 24h forex markets rarely have true gaps. Instead use "positioned lower/higher than neighbors" with small body constraint.

#### Strength Calculation (per-pattern)

**P0 Fix**: Add divide-by-zero guards for `body == 0` (doji-like bars).

```go
func patternStrength(signal CandleSignal, bars []domain.Bar, i int, atr float64) float64 {
    base := 0.5  // pattern detected = 0.5 minimum
    bar := bars[i]
    body := math.Abs(bar.Close - bar.Open)
    
    // Guard: if body is too small, use ATR as denominator
    if body < atr * 0.01 {
        body = atr * 0.01  // minimum 1% of ATR
    }

    // 1. Body/shadow ratio above minimum (0.0–0.2)
    ratioBonus := 0.0
    switch signal {
    case CandleHammer, CandleShootingStar:
        requiredRatio := 2.0
        actualRatio := shadowLength(bar, signal) / body
        if actualRatio > requiredRatio {
            ratioBonus = min((actualRatio - requiredRatio) / (requiredRatio * 2), 0.2)
        }
    // ... other patterns
    }

    // 2. Trend context alignment (0.0–0.2)
    trendBonus := 0.0
    trend := localTrend(bars, i)
    if (isBullishReversal(signal) && trend != "bull") || 
       (isBearishReversal(signal) && trend != "bear") {
        trendBonus = 0.2  // perfect counter-trend setup
    }

    // 3. S/R proximity bonus (0.0–0.1)
    srBonus := 0.0
    // Check if price near pivot points (bars[i] has PP, S1, S2, R1, R2 fields)
    if isBullishReversal(signal) {
        if math.Abs(bar.Close - bar.S1) < atr*0.5 || math.Abs(bar.Close - bar.S2) < atr*0.5 {
            srBonus = 0.1
        }
    } else if isBearishReversal(signal) {
        if math.Abs(bar.Close - bar.R1) < atr*0.5 || math.Abs(bar.Close - bar.R2) < atr*0.5 {
            srBonus = 0.1
        }
    }

    return clamp(base + ratioBonus + trendBonus + srBonus, 0.0, 1.0)
}
```

#### Existing Pattern Catalog (27 → 10 reduction)

The original 27-pattern catalog is preserved for reference in appendix. MVP implements only the 10 validated patterns above.

### 3.3 Data Types

```go
// candlestick.go

type CandleSignal string

const (
    // Single
    CandleDoji          CandleSignal = "doji"
    CandleDragonfly     CandleSignal = "dragonfly_doji"
    CandleGravestone    CandleSignal = "gravestone_doji"
    CandleHammer        CandleSignal = "hammer"
    CandleInvHammer     CandleSignal = "inverted_hammer"
    CandleShootingStar  CandleSignal = "shooting_star"
    CandleHangingMan    CandleSignal = "hanging_man"
    CandleMarubozuBull  CandleSignal = "bullish_marubozu"
    CandleMarubozuBear  CandleSignal = "bearish_marubozu"
    CandleSpinningTop   CandleSignal = "spinning_top"

    // Dual
    CandleBullishEngulfing CandleSignal = "bullish_engulfing"
    CandleBearishEngulfing CandleSignal = "bearish_engulfing"
    CandlePiercingLine     CandleSignal = "piercing_line"
    CandleDarkCloudCover   CandleSignal = "dark_cloud_cover"
    CandleBullishHarami    CandleSignal = "bullish_harami"
    CandleBearishHarami    CandleSignal = "bearish_harami"
    CandleTweezerTop       CandleSignal = "tweezer_top"
    CandleTweezerBottom    CandleSignal = "tweezer_bottom"

    // Triple
    CandleMorningStar       CandleSignal = "morning_star"
    CandleEveningStar       CandleSignal = "evening_star"
    CandleThreeWhiteSoldiers CandleSignal = "three_white_soldiers"
    CandleThreeBlackCrows   CandleSignal = "three_black_crows"
    CandleThreeInsideUp     CandleSignal = "three_inside_up"
    CandleThreeInsideDown   CandleSignal = "three_inside_down"
    CandleAbandonedBabyBull CandleSignal = "abandoned_baby_bull"
    CandleAbandonedBabyBear CandleSignal = "abandoned_baby_bear"
)

type CandlestickResult struct {
    Signal   CandleSignal `json:"signal"`
    Bullish  bool         `json:"bullish"`
    BarIndex int          `json:"bar_index"`
    Strength float64      `json:"strength"` // 0.0-1.0
}

// IsBullish returns whether the signal is a bullish pattern.
func IsBullish(s CandleSignal) bool { ... }
```

### 3.4 Bar Field Addition

```go
// domain/strategy.go — Bar struct addition
type Bar struct {
    // ... existing fields ...

    // Candlestick patterns detected on this bar
    CandlestickPatterns []string `json:"candlestick_patterns,omitempty"`
}
```

### 3.5 Integration Points

**A. EnrichBars() in apply.go**
```go
// After divergence detection (line ~132), add:
for i := range out {
    patterns := DetectAll(out, i, 2, 3)
    out[i].CandlestickPatterns = patterns
}
```

**B. LLM Analysis Prompt** (gold-analysis-agent, comprehensive-analyst.ts)
Add candlestick signals to the technical section:
```
Candlestick Signals (latest bar): doji, bullish_engulfing
Recent candlestick context: 3-bar window shows morning_star formation
```

**C. Strategy Engine** (future)
Strategy rules like: "pullback entry only after hammer/bullish engulfing at support"

**D. EA Visualization** (future)
Draw candlestick pattern labels on the MT4 chart via `/indicator_alerts` polling.

### 3.6 Context Awareness

All reversal patterns (hammer, shooting star, engulfing, morning/evening star) require trend context:

- **Bullish reversal**: must be in a local downtrend (price below EMA20 or lower lows in prior 5 bars)
- **Bearish reversal**: must be in a local uptrend (price above EMA20 or higher highs in prior 5 bars)

Trend-neutral patterns (doji, spinning top, marubozu) are always reported regardless of context.

---

## 4. Implementation Plan (v1.2)

| Phase | Task | Files | Lines |
|-------|------|-------|-------|
| 1 | Add `CandleSignal` constants (10 patterns) + `CandlestickResult` struct | `candlestick.go` | ~40 |
| 2 | Implement helper functions: `body()`, `upperShadow()`, `lowerShadow()`, `isBullish()`, `isBearish()`, `localTrend()` (30 lines) | `candlestick.go` | ~80 |
| 3 | Implement single-candle detectors: `detectHammer()`, `detectShootingStar()` with ATR guard | `candlestick.go` | ~60 |
| 4 | Implement dual-candle detectors: `detectEngulfing()` (body constraint), `detectPiercingDark()` (penetration tiers) | `candlestick.go` | ~120 |
| 5 | Implement triple-candle detectors: `detectMorningEveningStar()` (no gap), `detectThreeSoldiersCrows()` | `candlestick.go` | ~160 |
| 6 | Implement `patternStrength()` with divide-by-zero guards, trend/SR bonuses | `candlestick.go` | ~80 |
| 7 | Implement `DetectAll(bars, i)` dispatcher — gates on `i ≥ 2` for multi-bar patterns | `candlestick.go` | ~50 |
| **8+9 ATOMIC** | Add `CandlestickPatterns []string` to `Bar` + update `safeBar()` in `aurex/compat.go` + update `UnmarshalJSON` if needed | `domain/strategy.go` + `aurex/compat.go` | ~25 |
| 10 | Call `DetectAll()` in `EnrichBars()` — only for bars i ≥ 2, pass ATR from existing calculation | `indicator/apply.go` | ~10 |
| 11 | Add `CandlestickPatterns` to `IndicatorPack` struct for LLM payload | `domain/strategy.go` | ~5 |
| 12 | Unit tests: table-driven, 10 patterns × 2 directions × edge cases (body=0, i<2, trend mismatch) | `candlestick_test.go` | ~400 |
| 13 | Integration test: run EnrichBars on 100-bar XAUUSD H1 sample, verify no panics/zeros | `candlestick_test.go` | ~80 |
| **Total** | | | **~1,110 lines** |

### Critical Notes (P0 Fixes)

**Phase 8+9 MUST be atomic** — If `Bar.CandlestickPatterns` is added but `safeBar()` is not updated in the same commit, the field will silently disappear from LLM payload. Check `aurex/compat.go:333` — `safeBar()` manually copies every Bar field.

**Phase 2 localTrend()** — 30 lines of logic to replace TrendContext access. Must handle `idx < 10` gracefully.

**Phase 6 divide-by-zero** — Every pattern detector that divides by `body` must guard with `if body < atr*0.01 { body = atr*0.01 }`.

**Phase 3+4+5 ATR parameter** — All detectors need `atr float64` parameter. Get it from `bars[i].ATR` (already populated by EnrichBars).

---

## 5. Risks & Mitigations (v1.2 — P0 Fixes Applied)

| Risk | Severity | Status |
|------|----------|--------|
| **P0-1**: Hammer/Shooting Star tiny-body false positives | 🔴 | ✅ Fixed: `max(body*2, ATR*0.15)` |
| **P0-2**: TrendContext not available in EnrichBars() | 🔴 | ✅ Fixed: `localTrend()` with 10-bar HH/LL + EMA50 slope |
| **P0-3**: safeBar() not synced → LLM never sees patterns | 🔴 | ✅ Fixed: Phase 8+9 atomic |
| **P0-4**: Divide-by-zero when body=0 | 🔴 | ✅ Fixed: `if body < atr*0.01 { body = atr*0.01 }` |
| Engulfing without body engulfment check → false positives | 🟡 | ✅ Fixed in v1.1: added `bars[i].body > bars[i-1].body` |
| Morning/Evening Star gap requirement → never triggers | 🟡 | ✅ Fixed in v1.1: "positioned lower/higher + small body" |
| Piercing/Dark Cloud 50% threshold too weak | 🟡 | ✅ Fixed in v1.1: two-tier (50%/63%) |
| Multi-bar detection at i=0,1 → index out of bounds | 🟡 | ✅ Phase 7: gates on `i ≥ 2` |
| IndicatorPack not updated → patterns not in LLM payload | 🟡 | ✅ Phase 11 explicit |
| Too many patterns flood LLM context | 🟢 | ✅ Reduced 27→10, strength ≥ 0.5 filter |

## 6. Decisions Made (Final)

1. **Where**: gold-bot Go (indicator package) ✅
2. **How many**: 10 patterns in MVP ✅
3. **Detection mode**: Per-bar in EnrichBars() forward loop, `i ≥ 2` ✅
4. **Trend context**: `localTrend()` (10-bar HH/LL + EMA50 slope) ✅
5. **Strength calculation**: 3-factor with divide-by-zero guards ✅
6. **LLM integration**: IndicatorPack.CandlestickPatterns + safeBar sync ✅
7. **Implementation estimate**: ~1,110 lines (was 650, updated after P0 fixes) ✅

## 7. Review History

| Version | Reviewer | Key Findings | Status |
|---------|----------|--------------|--------|
| v1.0 | Initial draft | 27 patterns, no P0 issues identified | Superseded |
| v1.1 | glm (deepseek-v4-pro) + gpt-5.5 | 6 high-severity: Engulfing body, Morning/Evening Star gap, 27→10 reduction | Applied |
| v1.1 | deepseek-v4-pro | 4 P0 blockers: ATR guard, TrendContext, safeBar, divide-by-zero | Noted |
| v1.2 | claude-opus-4 | Validated 4 P0s, estimated lines 650→1,110 | **Applied ✅** |

**Final Status**: Ready for implementation with all P0 blockers resolved.