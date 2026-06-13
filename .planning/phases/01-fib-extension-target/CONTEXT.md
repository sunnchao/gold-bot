# Phase 1: Fibonacci Extension Target Management

## Implementation Decisions

### 1. 扩展位计算位置

**Decision:** `indicator/fibonacci.go` 新增 `CalculateFibExtension()` 函数  
**Rationale:** 与现有 `Fibonacci()` 回撤位函数放在同一文件，职责内聚、复用方便。  
**Outcome:** ✓ Good

### 2. 扩展位方向判定

**Decision:** 函数接收 `trend string` 参数（"UP"/"DOWN"），决定扩展位在 swing 的哪一侧  
**Rationale:** 扩展位是趋势延续目标，必须知道趋势方向。  
**Implementation:**
```go
func CalculateFibExtension(swingHigh, swingLow float64, trend string) FibExtension
// UP trend: extension above swingHigh
// DOWN trend: extension below swingLow
```

### 3. Swing High/Low 识别

**Decision:** 复用现有 50-bar 滚动窗口，在 `EnrichBars()` 中同步计算  
**Rationale:** 与现有 Fibonacci 回撤计算逻辑一致，window 大小可配置。  
**Pitfall:** Swing 必须能反映最近的有效波段。极端单边行情中，50-bar 可能跨越多波段。解决方案：允许 per-symbol 配置窗口大小。

### 4. 引擎 TP 层: 侵入式 vs 非侵入式

**Decision:** 非侵入式建议层  
**Rationale:** 
- 不修改现有策略的 TP 计算逻辑
- 在每个策略生成 Signal 后，`Analyze()` 函数的后处理阶段检查 Signal
- 若满足 Fib TP 条件（ADX 阈值、趋势方向匹配），覆盖 Signal 的 TP1/TP2
- `Enabled=false` 时跳过全部处理

**Architecture:**
```go
// After all strategies run in Analyze():
if cfg.FibExtensionTP.Enabled {
    applyFibExtensionTP(signal, h4, h1, &cfg.FibExtensionTP)
}
```

### 5. H4 vs H1 扩展位优先级

**Decision:** H4 扩展位 > H1 扩展位  
**Rationale:** H4 级别 Swing 更可靠，H1 扩展位误报率更高。H4 有有效扩展位时用 H4，否则回退 H1。

### 6. 扩展位作为 TP 的选择规则

**Decision:** 
- ADX >= 25（H4 或 H1）：启用 Fib 扩展位
- 127.2% 作为保守 TP1（若合理距离 dist > 0.5×ATR）
- 161.8% 作为激进 TP2（若合理距离 dist > 1.0×ATR）
- 两者距离不足（行情已走完）→ 使用策略默认 TP，不强制使用扩展位

### 7. API Payload 格式

**Decision:** 扩展位以 flat key 形式存在，与回撤位一致  
**Format:**
```json
{
  "indicators": {
    "H4": {
      "fib_236": 4520.00,
      "fib_382": 4510.00,
      ...
      "fib_1272": 4650.00,
      "fib_1618": 4700.00,
      "fib_2618": 4850.00
    }
  }
}
```

### 8. Per-Symbol 参数

**XAUUSD:** Fib ADX 阈值=25, Swing 窗口=50, 扩展位启用=true
**GBPJPY:** Fib ADX 阈值=28, Swing 窗口=60, 扩展位启用=true

## Key Interfaces

```go
// indicator/fibonacci.go

// FibExtension 扩展位
type FibExtension struct {
    Level1272 float64 `json:"fib_1272,omitempty"`
    Level1618 float64 `json:"fib_1618,omitempty"`
    Level2618 float64 `json:"fib_2618,omitempty"`
}

// CalculateFibExtension 基于波段计算 Fibonacci 扩展目标
// swingHigh/swingLow: 最近波段的最高最低价
// trend: 趋势方向 "UP" / "DOWN"
func CalculateFibExtension(swingHigh, swingLow float64, trend string) FibExtension

// IsPriceInFibZone 判断价格是否在回撤入场区（38.2%-61.8%）
// 用于 Phase 2，但定义在 indicator 层便于复用
func IsPriceInFibZone(price, fib382, fib618, atr float64, trend string) bool
```

```go
// engine/config.go - FibExtensionTP 配置块
type FibExtensionTPConfig struct {
    Enabled           bool      // 全局开关
    MinADX            float64   // 启用 Fib TP 的最小 ADX
    SwingWindow       int       // Swing 高/低识别窗口
    UseH4Preference   bool      // H4 扩展位优先
    ExtensionLevels   []float64 // 扩展级别 [1.272, 1.618, 2.618]
}
```

```go
// engine/engine.go - 新增函数
func (e Engine) applyFibExtensionTP(
    signal *domain.Signal,
    h4 []domain.Bar,
    h1 []domain.Bar,
    price float64,
) *domain.Signal
```

## File Change Summary

| File | Change | 
|------|--------|
| `internal/strategy/indicator/fibonacci.go` | +80 lines: `FibExtension` struct, `CalculateFibExtension()`, `IsPriceInFibZone()` |
| `internal/strategy/engine/config.go` | +15 lines: `FibExtensionTPConfig` struct, `ApplyFibExtensionTPConfig()` |
| `internal/strategy/engine/engine.go` | +60 lines: `applyFibExtensionTP()`, `detectLastSwing()`, Analyze() post-processing call |
| `internal/domain/strategy.go` | +6 lines: `FibExtension` fields in `Bar` and `IndicatorPack` |
| `internal/strategy/engine/config.go` | +10 lines: per-symbol Fib 参数 |
| `internal/strategy/engine/engine_test.go` | +200 lines: 扩展位测试 |
| `internal/indicator/fibonacci.go` | +30 lines: `CalculateFibExtension()` 计算逻辑 |

**Total:** ~400 lines of Go code

---
*Last updated: 2026-06-13*
