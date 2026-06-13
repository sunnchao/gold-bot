# TASKS: Phase 2 — Fibonacci Retracement Pullback Enhancement

**Status:** Pending  
**Dependencies:** Phase 1 (requires `CalculateFibExtension()` and `IsPriceInFibZone()` from indicator layer)  
**Branch naming convention:** `fib/pullback-enhancement`

---

## Task 2.1: 配置参数

**File:** `internal/strategy/engine/config.go`  
**Requirements:** FIB-RET-04

**Step 1** — Add `PullbackFibConfig` struct:
```go
type PullbackFibConfig struct {
    RetracementEnabled       bool
    RetracementZoneLow       float64
    RetracementZoneHigh      float64
    GoldenPocketBufferATR    float64
    RequireRSIConfirm        bool
    RSIConfirmBullThreshold  float64
    RSIConfirmBearThreshold  float64
    StopLossOuterATR         float64
    UsePendingOrder          bool
    PendingOrderLevel        string
}
```

**Step 2** — Default values:
```go
PullbackFib: PullbackFibConfig{
    RetracementEnabled:       false,   // 默认关闭，向后兼容
    RetracementZoneLow:       0.382,
    RetracementZoneHigh:      0.618,
    GoldenPocketBufferATR:    0.5,
    RequireRSIConfirm:        false,
    RSIConfirmBullThreshold:  40,
    RSIConfirmBearThreshold:  60,
    StopLossOuterATR:         0.5,     // 78.6%外+0.5ATR
    UsePendingOrder:          false,
    PendingOrderLevel:        "618",   // 优先设置在61.8%
},
```

**Step 3** — Per-symbol config in `GetStrategyConfigBySymbol()`:
```go
case "XAUUSD":
    cfg.PullbackFib.RetracementEnabled = true
    cfg.PullbackFib.GoldenPocketBufferATR = 0.5
case "GBPJPY":
    cfg.PullbackFib.RetracementEnabled = true
    cfg.PullbackFib.GoldenPocketBufferATR = 0.3  // 更窄
```

---

## Task 2.2: Pullback 增强逻辑

**File:** `internal/strategy/engine/engine.go`  
**Requirements:** FIB-RET-01 ~ FIB-RET-09

**Step 1** — Modify `checkPullback()`:

Current flow (simplified):
```
checkPullback:
  1. ADX >= 25?
  2. EMA20 趋势回调 (价格距 EMA20 在 ATR 范围内)?
  3. RSI 非超买超卖?
  4. 方向判定 (BUY/SELL)
  5. 评分计算
  6. 返回 Signal
```

New flow:
```
checkPullback:
  1. ADX >= 25?
  2. EMA20 趋势回调?
  3. RSI 非超买超卖?
  4. [NEW] Fib 增强过滤器 (if enabled):
     a. 价格在 38.2%-61.8% 回撤区?
        - Yes: 继续
        - No: return nil (跳过信号)
     b. [可选] M15 RSI 确认?
        - Yes: 继续
        - No: return nil
  5. 方向判定
  6. 评分计算 (Fib 在区内 +1 分)
  7. [NEW] 止损: 78.6% + ATR 缓冲 (覆盖默认)
  8. [NEW] TP: 调用 applyFibExtensionTP() (覆盖默认)
  9. 返回 Signal (带 "pullback_fib" 标签)
```

**Pseudo-code for the filter:**
```go
// Inside checkPullback(), after direction determination
if e.Config.PullbackFib.RetracementEnabled {
    last := h1[len(h1)-1]
    cfg := e.Config.PullbackFib
    
    // H4 趋势方向必须与信号方向一致
    h4Last := h4[len(h4)-1]
    fibTrend := "UP"
    if h4Last.EMA20 < h4Last.EMA50 { fibTrend = "DOWN" }
    
    // 价格在 38.2%-61.8% 回撤区？
    inZone := indicator.IsPriceInFibZone(price, last.Fib382, last.Fib618,
        atr*cfg.GoldenPocketBufferATR, fibTrend)
    if !inZone {
        return nil, domain.AnalysisLog{
            Level: "info", Strategy: "pullback",
            Message: fmt.Sprintf("🌀 pullback+FIB: 价格 %.2f 不在回撤区 [%.2f-%.2f] (%s) ⏭",
                price, last.Fib382, last.Fib618, fibTrend),
        }
    }
    
    // 评分加分
    score++
    
    // 止损移至 78.6% 外侧
    if side == "BUY" {
        signal.StopLoss = round2(last.Fib786 - atr*cfg.StopLossOuterATR)
    } else {
        signal.StopLoss = round2(last.Fib786 + atr*cfg.StopLossOuterATR)
    }
    
    // 使用 Phase 1 的 TP 增强
    signal = e.applyFibExtensionTP(signal, h4, h1, price, atr)
    
    // 限价挂单（可选）
    if cfg.UsePendingOrder {
        targetEntry := last.Fib618
        if cfg.PendingOrderLevel == "50" {
            targetEntry = last.Fib500
        }
        signal.OrderType = "LIMIT"
        signal.Entry = round2(targetEntry)
    }
    
    signal.Strategy = "pullback_fib"  // 区分标签
    
    log.Printf("[STRATEGY] 🌀 pullback+FIB: ✅ 回撤区确认 | 价格=%.2f Fib区=[%.2f-%.2f] 止损=%.2f 评分=%d",
        price, last.Fib382, last.Fib618, signal.StopLoss, signal.Score)
}
```

**Step 2** — Log tag:
- 纯 pullback: `[STRATEGY] 🟢 pullback BUY`
- pullback+FIB: `[STRATEGY] 🌀 pullback+FIB BUY`

---

## Task 2.3: 单元测试

**File:** `internal/strategy/engine/engine_test.go`  
**Requirements:** FIB-TEST-05 ~ FIB-TEST-08

**Test cases to add:**

1. **`TestPullbackFibFilter_Enabled_PriceInZone`:**
   - Setup: pullback condition met + Fib filter enabled + price in 38.2-61.8% zone
   - Expect: Signal returned with Strategy="pullback_fib", TP from Fib extension

2. **`TestPullbackFibFilter_Enabled_PriceOutOfZone`:**
   - Setup: pullback condition met + Fib filter enabled + price outside zone
   - Expect: nil signal, info log

3. **`TestPullbackFibFilter_Disabled`:**
   - Setup: Fib filter disabled
   - Expect: Standard pullback behaviour unchanged

4. **`TestPullbackFibFilter_ADXTooLow`:**
   - Setup: Fib filter enabled but ADX < 25
   - Expect: Standard pullback behaviour unchanged (Fib filter is additive)

5. **`TestPullbackFibFilter_StopLossAt786`:**
   - Verify SL is at FIB786 + ATR buffer, not the standard ATR-based SL

6. **`TestPullbackFibFilter_UsePendingOrder`:**
   - Verify signal.OrderType = "LIMIT" and Entry is at Fib50 or Fib618

---

## Task 2.4: 集成验证

**Step 1** — Run full test suite:
```bash
go test ./internal/strategy/... -v -count=1
```

**Step 2** — Build:
```bash
go build ./...
```

**Step 3** — Verify backward compatibility:
- Disable Fib extension → `checkPullback()` unchanged
- Enable but remove price from zone → pullback skipped (no false positives)
- Run with existing test fixtures → all pass

---

## Verification Checklist

- [ ] `go test ./internal/strategy/indicator/...` all pass
- [ ] `go test ./internal/strategy/engine/...` all pass
- [ ] `go build ./...` passes
- [ ] `PullbackFib.RetracementEnabled=false` → pullback unchanged
- [ ] `RetracementEnabled=true` + price in zone → pullback_fib signal with Fib TP
- [ ] `RetracementEnabled=true` + price out of zone → pullback skipped
- [ ] Stop loss at FIB786 + ATR buffer (not standard ATR*1.5)
- [ ] Strategy label is "pullback_fib" (distinguishable from standard "pullback")
- [ ] XAUUSD and GBPJPY use independent Fib ADX/buffer thresholds

---
*Created: 2026-06-13*
