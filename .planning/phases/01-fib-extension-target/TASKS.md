# TASKS: Phase 1 — Fib Extension Target Management

**Status:** Pending  
**Dependencies:** None  
**Branch naming convention:** `fib/ext-extension-target`

---

## Task 1.1: 扩展位计算函数

**File:** `internal/strategy/indicator/fibonacci.go`  
**Requirements:** FIB-EXT-01 ~ FIB-EXT-04

**Step 1** — Define `FibExtension` struct:
```go
type FibExtension struct {
    Level1272 float64
    Level1618 float64
    Level2618 float64
}
```

**Step 2** — Implement `CalculateFibExtension(swingHigh, swingLow, trend) FibExtension`:
```go
func CalculateFibExtension(swingHigh, swingLow float64, trend string) FibExtension {
    diff := math.Abs(swingHigh - swingLow)
    ext := FibExtension{}
    if trend == "UP" {
        ext.Level1272 = swingHigh + diff*1.272
        ext.Level1618 = swingHigh + diff*1.618
        ext.Level2618 = swingHigh + diff*2.618
    } else { // "DOWN" or default
        ext.Level1272 = swingLow - diff*1.272
        ext.Level1618 = swingLow - diff*1.618
        ext.Level2618 = swingLow - diff*2.618
    }
    return ext
}
```

**Step 3** — Implement `IsPriceInFibZone(price, fib382, fib618, atr, trend string) bool`:
- buffer = atr * 0.5
- UP trend: price <= fib382 + buffer && price >= fib618 - buffer
- DOWN trend: price >= fib382 - buffer && price <= fib618 + buffer

**Step 4** — Write tests:
- `TestCalculateFibExtension_UPTrend`: Known swing (100-80), verify 127.2=105.44, 161.8=112.36
- `TestCalculateFibExtension_DOWNtrend`: Known swing (80-100), verify 127.2=74.56, 161.8=67.64
- `TestCalculateFibExtension_Extreme`: Zero diff → all levels equal
- `TestIsPriceInFibZone`: Price inside/outside zone with ATR buffer

**Verification:** `go test ./internal/strategy/indicator/... -run TestCalculateFibExtension -v`

---

## Task 1.2: 配置参数

**File:** `internal/strategy/engine/config.go`  
**Requirements:** FIB-EXT-05

**Step 1** — Add `FibExtensionTPConfig` struct:
```go
type FibExtensionTPConfig struct {
    Enabled         bool
    MinADX          float64
    SwingWindow     int
    UseH4Preference bool
    ExtensionLevels []float64
}
```

**Step 2** — Default values in `DefaultStrategyConfig()`:
```go
FibExtension: FibExtensionTPConfig{
    Enabled:         false,  // 默认关闭，向后兼容
    MinADX:          25.0,
    SwingWindow:     50,
    UseH4Preference: true,
},
```

**Step 3** — Per-symbol config in `GetStrategyConfigBySymbol()`:
```go
case "XAUUSD":
    cfg.FibExtension.MinADX = 25.0
    cfg.FibExtension.SwingWindow = 50
case "GBPJPY":
    cfg.FibExtension.MinADX = 28.0  // 更严格
    cfg.FibExtension.SwingWindow = 60
```

**Step 4** — Write tests:
- `TestFibConfigDefaults`: Verify Enabled=false, MinADX=25

---

## Task 1.3: Swing High/Low Detection

**File:** `internal/strategy/engine/engine.go`  
**Requirements:** FIB-EXT-09 ~ FIB-EXT-10

**Step 1** — Implement `detectLastSwing(bars []domain.Bar, window int) (high, low float64, trend string)`:
```go
func detectLastSwing(bars []domain.Bar, window int) (float64, float64, string) {
    if len(bars) < window {
        window = len(bars)
    }
    start := len(bars) - window
    high := bars[start].High
    low := bars[start].Low
    for i := start + 1; i < len(bars); i++ {
        if bars[i].High > high { high = bars[i].High }
        if bars[i].Low < low { low = bars[i].Low }
    }
    // 最近 bar 的收盘价决定趋势方向
    last := bars[len(bars)-1].Close
    first := bars[start].Close
    trend := "UP"
    if last < first { trend = "DOWN" }
    return high, low, trend
}
```

**Step 2** — Write tests:
- `TestDetectLastSwing_UPTrend`: Upward-sloping data
- `TestDetectLastSwing_DOWNtrend`: Downward-sloping data
- `TestDetectLastSwing_ShortData`: Less data than window

---

## Task 1.4: 引擎 TP 增强层

**File:** `internal/strategy/engine/engine.go`  
**Requirements:** FIB-EXT-06 ~ FIB-EXT-08

**Step 1** — Add `applyFibExtensionTP()` method:
```go
func (e Engine) applyFibExtensionTP(
    signal *domain.Signal,
    h4, h1 []domain.Bar,
    price, atr float64,
) *domain.Signal {
    if signal == nil || !e.Config.FibExtension.Enabled {
        return signal
    }
    // H4 优先
    cfg := e.Config.FibExtension
    swingHigh, swingLow, trend := detectLastSwing(h4, cfg.SwingWindow)
    adx := h4[len(h4)-1].ADX
    if adx < cfg.MinADX {
        // H4 ADX不足，试H1
        swingHigh, swingLow, trend = detectLastSwing(h1, cfg.SwingWindow)
        if h1[len(h1)-1].ADX < cfg.MinADX {
            return signal // ADX都不足，不应用Fib TP
        }
    }
    ext := indicator.CalculateFibExtension(swingHigh, swingLow, trend)
    // 根据信号方向选择扩展位
    if signal.Side == "BUY" && trend == "UP" {
        if ext.Level1272 > price && ext.Level1272-price > atr*0.5 {
            signal.TP1 = round2(ext.Level1272)
        }
        if ext.Level1618 > price && ext.Level1618-price > atr*1.0 {
            signal.TP2 = round2(ext.Level1618)
        }
    } else if signal.Side == "SELL" && trend == "DOWN" {
        if ext.Level1272 < price && price-ext.Level1272 > atr*0.5 {
            signal.TP1 = round2(ext.Level1272)
        }
        if ext.Level1618 < price && price-ext.Level1618 > atr*1.0 {
            signal.TP2 = round2(ext.Level1618)
        }
    }
    return signal
}
```

**Step 2** — Modify `Analyze()` to call `applyFibExtensionTP` for each signal:
```go
// After all strategies, before H4 filter application:
for i := range signals {
    signals[i] = *e.applyFibExtensionTP(&signals[i], h4, h1, price, atr)
}
```

**Step 3** — Write tests:
- `TestApplyFibExtensionTP_Disabled`: Enabled=false → Signal unchanged
- `TestApplyFibExtensionTP_BUY_UPTrend`: BUY + UP → TP1=127.2, TP2=161.8
- `TestApplyFibExtensionTP_SELL_DOWNtrend`: SELL + DOWN → TP below entry
- `TestApplyFibExtensionTP_LowADX`: ADX < threshold → Signal unchanged
- `TestApplyFibExtensionTP_TooClose`: Extension too near → Signal unchanged

---

## Task 1.5: API Payload 扩展

**Files:** `internal/domain/strategy.go`, related API handlers  
**Requirements:** FIB-EXT-11 ~ FIB-EXT-12

**Step 1** — Add `FibExtension` field to `IndicatorPack`:
```go
type IndicatorPack struct {
    // ... existing fields
    Fib1272 float64 `json:"fib_1272,omitempty"`
    Fib1618 float64 `json:"fib_1618,omitempty"`
    Fib2618 float64 `json:"fib_2618,omitempty"`
}
```

**Step 2** — Compute and populate in `EnrichBars()`:
```go
// After Fibonacci retracement (existing code)
ext := CalculateFibExtension(swingHigh, swingLow, trend)
out[i].Fib1272 = ext.Level1272
out[i].Fib1618 = ext.Level1618
out[i].Fib2618 = ext.Level2618
```

---

## Task 1.6: 集成验证

**Step 1** — Run full test suite:
```bash
go test ./internal/strategy/... -v -count=1
```

**Step 2** — Build and verify:
```bash
go build ./...
```

**Step 3** — Edge case checks:
- Enable FibExtensionTP on config → verify periodic logs show "[FIB] 🎯 应用扩展目标..."
- Disable → verify no behaviour change in existing signals
- Zero ATR / extreme prices → verify no crash

---

## Verification Checklist

- [ ] `go test ./internal/strategy/indicator/... -v` all pass
- [ ] `go test ./internal/strategy/engine/... -v` all pass
- [ ] `go build ./...` passes
- [ ] `Enabled=false` → existing strategy output unchanged
- [ ] `Enabled=true` + ADX >= threshold → TP values reflect Fib extension
- [ ] `Enabled=true` + ADX < threshold → TP values use strategy defaults
- [ ] XAUUSD vs GBPJPY use independent Fib ADX thresholds
- [ ] API payload includes `fib_1272`/`fib_1618`/`fib_2618` fields
- [ ] All edge cases handled (zero diff, extreme prices, insufficient bars)

---
*Created: 2026-06-13*
