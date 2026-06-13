# Phase 2: Fibonacci Retracement Pullback Enhancement

## Implementation Decisions

### 1. 改造方式：增强模式 vs 独立策略

**Decision:** 增强模式（非独立策略）  
**Rationale:** 四模型中 Kimi/GLM/Qwen 一致反对将 Fib 回撤作为独立策略，认为与 pullback 信号冗余。增强模式不新增策略，只在 pullback 的核心条件链中增加一层 Fib 回撤区确认。  
**Outcome:** ✓ Good (Phase 1 的扩展位函数也为本阶段 TP 提供支持)

### 2. Fib 过滤器的位置

**Decision:** 在 `checkPullback()` 函数的早期阶段增加过滤  
**Rationale:** 现有 pullback 流程：
1. ADX >= 25？
2. EMA20 回调/突破？
3. RSI 非超买超卖？
4. 价格距 EMA20 在一定范围内？

在步骤 2 之后增加：价格是否在 Fib 38.2%-61.8% 回撤区内？**不在则跳过**（仅当 Fib 增强启用时）。

### 3. TP 联动

**Decision:** 当 Fib 增强模式启用时，自动使用 Phase 1 的 `applyFibExtensionTP()` 设置 TP  
**Rationale:** Fib 入场 + Fib TP = 完整 Fibonacci 交易闭环。入口和出口都用同一个 Swing 的 Fib 比例，逻辑一致。

### 4. 止损位置

**Decision:** 当 Fib 增强模式启用时，止损移至 78.6% 外侧 + 0.5×ATR 缓冲  
**Rationale:** 超过 78.6% 回撤意味着原有趋势结构被破坏。这与「结构位失效即离场」的风控原则一致。

### 5. 限价挂单

**Decision:** 当入场价距市价 > 0.3×ATR 时，在 50% 或 61.8% 回撤位发限价挂单  
**Rationale:** 等价格到位再入场而非追价，提高执行质量。复用现有 PENDING 命令机制。  
**Caveat:** 需要确保限价单不会因价格未到而错过行情（与现有挂单逻辑一致）。

### 6. M15 RSI 确认

**Decision:** 可选开启，默认关闭  
**Rationale:** 增加一层确认会减少信号频率，但提升胜率。由用户通过配置决定。  
**RSI 确认逻辑：** BUY 方向：M15 RSI < 40（超卖区附近），且最近 3 根 RSI 向上；SELL 方向：M15 RSI > 60。

### 7. 日志标签

**Decision:** 新增 `[STRATEGY] 🌀 pullback+FIB` 日志标签，与纯 pullback 区分  
**Rationale:** 便于监控和调试，区分增强模式 vs 标准模式的触发情况。

## Key Interfaces (增量)

```go
// engine/config.go - Pullback Fib 配置
type PullbackFibConfig struct {
    RetracementEnabled       bool    // 启用 Fib 回撤过滤器
    RetracementZoneLow       float64 // 回撤区下限 (0.382)
    RetracementZoneHigh      float64 // 回撤区上限 (0.618)
    GoldenPocketBufferATR    float64 // 回撤区 ATR 缓冲倍数 (0.5)
    RequireRSIConfirm        bool    // 是否需要 M15 RSI 确认
    RSIConfirmBullThreshold  float64 // BUY RSI 阈值 (<40)
    RSIConfirmBearThreshold  float64 // SELL RSI 阈值 (>60)
    StopLossOuterATR         float64 // 止损 ATR 缓冲 (在78.6%外)
    UsePendingOrder          bool    // 使用限价挂单
    PendingOrderLevel        string  // "50" or "618" (回撤位)
}
```

```go
// engine/engine.go - checkPullback 增强
func (e Engine) checkPullback(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
    // ... 原有 pullback 逻辑 ...
    
    // Fib 增强过滤器（配置开启时生效）
    if e.Config.PullbackFib.RetracementEnabled {
        last := h1[len(h1)-1]
        zone := e.Config.PullbackFib
        
        // 获取 Swing 对应的 Fib 回撤位
        _, swingLow, trend := detectLastSwing(h1, e.Config.FibExtension.SwingWindow)
        
        // 计算该 Swing 的完整回撤位
        swingHigh := last.Fib236 / (1 - 0.236) // 反向回推
        // 实际使用 Bar 中已有的 Fib 字段
        
        // 检查价格是否在回撤区
        inZone := indicator.IsPriceInFibZone(price, last.Fib382, last.Fib618, atr * zone.GoldenPocketBufferATR, trend)
        if !inZone {
            return nil, domain.AnalysisLog{
                Level: "info", Strategy: "pullback",
                Message: "🌀 pullback+FIB: 价格不在 38.2%-61.8% 回撤区 ⏭",
            }
        }
        
        // 可选：M15 RSI 确认
        if zone.RequireRSIConfirm {
            // ... RSI 确认逻辑 ...
        }
        
        // 增强模式触发 → 日志区分
        log.Printf("[STRATEGY] 🌀 pullback+FIB: 回撤区确认 ✅ 评分=%d", score)
    }
    
    // ... 后续逻辑 ...
}
```

## File Change Summary

| File | Change |
|------|--------|
| `internal/strategy/indicator/fibonacci.go` | +20 lines: `IsPriceInFibZone()`（若 Phase 1 未完成则加） |
| `internal/strategy/engine/config.go` | +20 lines: `PullbackFibConfig` struct + 默认值 |
| `internal/strategy/engine/engine.go` | +50 lines: `checkPullback()` Fib 过滤逻辑 |
| `internal/strategy/engine/engine_test.go` | +250 lines: 增强模式测试用例 |

**Total:** ~340 lines of Go code (增量)

---
*Last updated: 2026-06-13*
