# Task: Implement Scale-In (浮亏加仓) Strategy for Gold-Bot

## Overview

Add a `scale_in` strategy that allows adding to existing losing positions at key technical levels,
with proper risk controls. This is Phase 1: server-side engine + domain + config changes.

## Architecture Context

- Strategy engine: `internal/strategy/engine/engine.go` — each strategy is a `check*()` method called from `Analyze()`
- Strategy config: `internal/strategy/engine/config.go` — `StrategyConfig` struct with defaults
- Domain models: `internal/domain/strategy.go` — `Signal`, `Position`, `AnalysisSnapshot`, etc.
- Risk gate: `internal/strategy/riskgate/gate.go` — `Evaluate()` with `AllowAdd` flag
- Pending signals: `internal/store/sqlite/pending_signal.go`
- Position commands: `internal/domain/` — `PositionCommand` with MODIFY/CLOSE actions

## Current Anti-Duplicate Logic (engine.go ~line 377-403)

```go
// Same-direction: block if within 1 ATR
if posSide == best.Side {
    if dist < atr {
        return nil, logs  // BLOCKS ALL same-direction signals
    }
}
```

This MUST be modified to allow `scale_in` strategy through.

## Requirements

### 1. Config (config.go)

Add to `StrategyConfig`:

```go
// ScaleIn strategy — add to losing positions at key technical levels
ScaleInEnabled           bool    `json:"scale_in_enabled" yaml:"scale_in_enabled"`
ScaleInMinADX            float64 `json:"scale_in_min_adx" yaml:"scale_in_min_adx"`
ScaleInMinDistATR        float64 `json:"scale_in_min_dist_atr" yaml:"scale_in_min_dist_atr"`       // min distance from last entry, in ATR
ScaleInMinFloatLossATR   float64 `json:"scale_in_min_float_loss_atr" yaml:"scale_in_min_float_loss_atr"` // min floating loss to trigger (in ATR)
ScaleInMaxAddCount       int     `json:"scale_in_max_add_count" yaml:"scale_in_max_add_count"`      // max number of scale-in adds per direction
ScaleInLotDecay          float64 `json:"scale_in_lot_decay" yaml:"scale_in_lot_decay"`              // each add = prev_lots × decay (e.g. 0.6)
ScaleInSLATR             float64 `json:"scale_in_sl_atr" yaml:"scale_in_sl_atr"`                    // SL from weighted avg entry
ScaleInTP1ATR            float64 `json:"scale_in_tp1_atr" yaml:"scale_in_tp1_atr"`
ScaleInTP2ATR            float64 `json:"scale_in_tp2_atr" yaml:"scale_in_tp2_atr"`
ScaleInMinIntervalMin    int     `json:"scale_in_min_interval_min" yaml:"scale_in_min_interval_min"` // min minutes between scale-ins
ScaleInMaxFloatLossPct   float64 `json:"scale_in_max_float_loss_pct" yaml:"scale_in_max_float_loss_pct"` // max total floating loss % of equity to allow scale-in
```

Defaults (in `DefaultStrategyConfig()`):
```
ScaleInEnabled:         true
ScaleInMinADX:          25.0
ScaleInMinDistATR:      1.5
ScaleInMinFloatLossATR: 0.5
ScaleInMaxAddCount:     2
ScaleInLotDecay:        0.6
ScaleInSLATR:           1.2
ScaleInTP1ATR:          1.5
ScaleInTP2ATR:          3.0
ScaleInMinIntervalMin:  30
ScaleInMaxFloatLossPct: 5.0
```

### 2. Domain (domain/strategy.go)

Add to `Signal` struct:
```go
ScaleInParentTicket int64   `json:"scale_in_parent_ticket,omitempty"` // ticket of the position being scaled into
WeightedAvgEntry    float64 `json:"weighted_avg_entry,omitempty"`     // calculated weighted avg after scale-in
UnifiedSL           float64 `json:"unified_sl,omitempty"`             // new unified SL for all same-direction positions
ScaleInCount        int     `json:"scale_in_count,omitempty"`         // how many scale-ins already done
```

### 3. Engine (engine.go)

#### 3a. New method: `checkScaleIn()`

Signature:
```go
func (e Engine) checkScaleIn(h1 []domain.Bar, price, atr float64, positions []domain.Position) (*domain.Signal, domain.AnalysisLog)
```

Logic:
1. If `!cfg.ScaleInEnabled`, return nil
2. Find all same-direction positions that are in floating loss:
   - BUY positions where `price < pos.OpenPrice` (current price below entry = loss for buy)
   - SELL positions where `price > pos.OpenPrice`
3. Count existing scale-in positions (strategy="scale_in" in comment or track via a convention)
4. If count >= `ScaleInMaxAddCount`, skip
5. Check min distance from most recent entry: `abs(price - lastEntry) >= cfg.ScaleInMinDistATR * atr`
6. Check min floating loss: `abs(price - avgEntry) >= cfg.ScaleInMinFloatLossATR * atr`
7. Check H4 trend alignment (reuse the H4 filter from Analyze — pass h4FilterDir as param or check inside)
8. Check ADX >= `ScaleInMinADX`
9. Technical level check — at least ONE of:
   - Price within 0.3 ATR of a Fibonacci level (382/500/618 from H1 last bar)
   - Price within 0.3 ATR of Pivot S1/R1/PP
   - RSI in oversold(<30 for BUY)/overbought(>70 for SELL) zone
   - Price touching EMA50 or EMA200 (within 0.2 ATR)
10. Calculate:
    - `existingLots = sum of all same-direction position lots`
    - `newLots = max(existingLots * cfg.ScaleInLotDecay, 0.01)` — round to lot step 0.01
    - `weightedAvg = (sum of lot*price for all positions + newLots*price) / (sum of lots + newLots)`
    - `unifiedSL` based on weightedAvg and ScaleInSLATR
11. Score: start at 5, add points for:
    - ADX > 30: +1
    - RSI confirmation: +1
    - Price at Fibonacci level: +1
    - Price at Pivot level: +1
    - MACD histogram confirming: +1
12. Return Signal with `Strategy: "scale_in"`, `Side` = same direction as existing positions,
    the calculated `Entry`, `StopLoss` = unifiedSL, `TP1/TP2` based on weighted avg + ATR multiples.
    Set `ScaleInParentTicket` = ticket of the most recent same-direction position.
    Set `WeightedAvgEntry`, `UnifiedSL`, `ScaleInCount`.

#### 3b. Modify `Analyze()` to call `checkScaleIn()`

After the existing strategy checks (around line 250), add:
```go
if signal, detail := e.checkScaleIn(h1, price, atr, snapshot.Positions); signal != nil {
    signals = append(signals, *signal)
    logs = append(logs, detail)
    log.Printf("[STRATEGY] %s", detail.Message)
} else {
    logs = append(logs, detail)
}
```

#### 3c. Modify anti-duplicate logic (line ~377)

Change the same-direction check to allow `scale_in` strategy:
```go
if posSide == best.Side {
    if dist < atr {
        // Allow scale_in strategy to bypass the 1-ATR same-direction block
        if best.Strategy == "scale_in" {
            log.Printf("[STRATEGY] ➕ 浮亏加仓豁免防重复: 策略=scale_in, 距离=%.2f < ATR=%.2f", dist, atr)
            logs = append(logs, domain.AnalysisLog{
                Level:    "info",
                Strategy: "汇总",
                Message:  fmt.Sprintf("浮亏加仓豁免防重复: 策略=scale_in, 距离=%.2f < ATR=%.2f", dist, atr),
            })
        } else {
            log.Printf("[STRATEGY] 🔒 防重复: 已有同向持仓 @ %.2f,距离 < 1.0 ATR", position.OpenPrice)
            logs = append(logs, domain.AnalysisLog{
                Level:    "warn",
                Strategy: "汇总",
                Message:  fmt.Sprintf("防重复: 已有同向持仓 @ %.2f,距离 < 1.0 ATR", position.OpenPrice),
            })
            return nil, logs
        }
    }
}
```

IMPORTANT: Move the scale_in check BEFORE the anti-duplicate block, so scale_in signals
are generated first, then the anti-duplicate only blocks non-scale_in strategies.
Actually the cleaner approach: the anti-duplicate loop runs AFTER signal selection (best = highest score).
If `best.Strategy == "scale_in"`, skip the same-direction block for that position.

### 4. Risk Gate (riskgate/gate.go)

In `positionConflictRejects()`, when `positionSide == planSide`, also allow if the plan is a scale-in:
The cleanest way: add `AllowScaleIn bool` to `Input` struct, or check if plan has a reason_code containing "scale_in".

Actually, the simplest approach: when the strategy engine produces a `scale_in` signal, the upstream caller
(whoever creates the TradePlan) should set `AllowAdd = true` in the riskgate Input.
So no riskgate code change is needed — just the caller needs to detect `strategy == "scale_in"` and flip AllowAdd.

### 5. Signal Flow Integration

Wherever the signal is converted to a TradePlan or PendingSignal (check `app.go` and `scheduler/`),
ensure:
- `scale_in` signals have `AllowAdd=true` when passed to riskgate
- The EA receives the signal with strategy info so it uses the correct Magic number

### 6. Unified SL Modification

After a scale-in order is executed, generate MODIFY commands for ALL same-direction positions
to set them to the new unified SL.

Add a helper function (could be in engine.go or a new file `internal/strategy/scalein/helpers.go`):

```go
// CalculateUnifiedSL calculates the weighted average entry and unified SL for all same-direction positions
// including the new scale-in order.
func CalculateUnifiedSL(positions []Position, newEntry, newLots, atr, slATR float64, side string) (weightedAvg, unifiedSL float64) {
    totalLots := newLots
    totalWeighted := newEntry * newLots
    for _, pos := range positions {
        if strings.ToUpper(pos.Type) != side {
            continue
        }
        totalLots += pos.Lots
        totalWeighted += pos.OpenPrice * pos.Lots
    }
    weightedAvg = totalWeighted / totalLots
    if side == "BUY" {
        unifiedSL = round2(weightedAvg - atr*slATR)
    } else {
        unifiedSL = round2(weightedAvg + atr*slATR)
    }
    return
}
```

### 7. Tests

Add tests in `internal/strategy/engine/engine_test.go`:
1. Test `checkScaleIn` triggers when there's a losing BUY position + RSI oversold + Fibonacci level nearby
2. Test `checkScaleIn` does NOT trigger when ADX too low
3. Test `checkScaleIn` does NOT trigger when max add count reached
4. Test `checkScaleIn` does NOT trigger when distance < minDistATR
5. Test anti-duplicate allows scale_in but blocks other strategies
6. Test `CalculateUnifiedSL` weighted average calculation
7. Test lot decay calculation (0.10 * 0.6 = 0.06, 0.06 * 0.6 = 0.036 → 0.03)

### 8. Logging

All scale-in decisions MUST be logged with `[STRATEGY] ➕` prefix for easy grep.
Log format:
```
[STRATEGY] ➕ 浮亏加仓 BUY | 原仓均价=3348.50 | 浮亏=1.2ATR | 加仓价=3340.20 | 新手数=0.06 | 加权均价=3345.80 | 统一SL=3339.20
```

## Important Constraints

- Do NOT modify the EA (MQ4) code — that's Phase 2
- Do NOT modify gold-analysis-agent — that's Phase 3
- Keep all existing tests passing
- Follow existing code style (Chinese comments for strategy names, English for technical comments)
- The `round2()` helper already exists in engine.go — reuse it
- All new config fields MUST have sensible defaults in `DefaultStrategyConfig()`
- The `breakout_pyramid` strategy is a DIFFERENT concept (adding on breakout, not on loss) — don't merge them

## Files to Modify

1. `internal/strategy/engine/config.go` — add ScaleIn config fields + defaults
2. `internal/domain/strategy.go` — add ScaleIn fields to Signal
3. `internal/strategy/engine/engine.go` — add `checkScaleIn()`, modify `Analyze()`, modify anti-duplicate
4. `internal/strategy/engine/engine_test.go` — add tests
5. New file: `internal/strategy/scalein/helpers.go` — `CalculateUnifiedSL()` helper (optional, can be in engine.go)

## Verification

After implementation:
1. `go build ./...` must pass
2. `go test ./internal/strategy/...` must pass
3. `go vet ./...` must pass
