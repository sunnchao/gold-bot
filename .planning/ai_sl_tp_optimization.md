# GSD: AI 止盈止损优化方案

**File:** `.planning/ai_sl_tp_optimization.md`
**Type:** GSD (Goal-Scenario-Design)
**Author:** 太傅
**Date:** 2026-06-22
**Status:** Draft

---

## 1. Goal（目标）

在 gold-bot 策略引擎中引入**AI 建议止盈止损**的完整覆盖机制，解决当前仅覆盖 SL、完全不覆盖 TP 的问题，并为 XAGUSD 等品种提供独立参数化配置。

### 核心价值

- **让 LLM 同时参与 SL 和 TP 决策**，而非仅覆盖止损
- **为 XAGUSD 提供独立策略配置**，避免共用 XAUUSD 默认参数导致止盈止损不合理
- **保持向后兼容**：AI 建议缺失时自动回退到 ATR 计算

### 非目标

- ❌ 不修改 EA 端逻辑（EA 只接收 SL/TP 数值）
- ❌ 不修改 AI Agent 输出格式（复用现有 `suggested_sl` / `suggested_tp` JSON 字段）
- ❌ 不引入新的 LLM 调用（复用已有的 AI 分析结果）

---

## 2. Scenario（场景分析）

### 2.1 当前问题

| 问题 | 证据 | 影响 |
|------|------|------|
| LLM 只覆盖 SL，不覆盖 TP | `internal/strategy/engine/engine.go:683` 只有 `SuggestedSL` 处理 | 止盈完全由固定 ATR 倍数决定，对白银等品种极度不合理 |
| `SuggestedTP` 字段定义但从未使用 | `internal/domain/strategy.go:189` 定义，`grep -rn` 无引用 | 即使 AI Agent 输出 `suggested_tp`，服务端也忽略 |
| XAGUSD 共用 XAUUSD 默认配置 | `GetStrategyConfigBySymbol` 对非黄金品种返回 `DefaultStrategyConfig()` | 白银 ATR 绝对值小，固定倍数导致 TP 过近 |

### 2.2 具体案例：XAGUSD 止盈不合理

```
XAUUSD @ 2300: ATR≈15, TP1 = 2300 + 15*1.5 = 2322.5  (目标 0.98%)
XAGUSD @ 66:   ATR≈0.73, TP1 = 66 + 0.73*1.5 = 67.09   (目标 1.65%)
```

白银日内波动 2-3%，1.5倍 ATR 的止盈在趋势行情中极易被触发，盈亏比失衡。

### 2.3 AI Agent 现状

gold-analysis-agent 的 `ai_result` 输出已包含：
- `suggested_sl`: 基于支撑/阻力位的止损建议
- `suggested_tp`: 基于目标位的止盈建议（**服务端未读取**）

---

## 3. Design（设计方案）

### 3.1 架构变更

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  AI Analysis    │────▶│  gold-bot API    │────▶│  Strategy Engine│
│  (suggested_sl │     │  (SaveAIResult)  │     │  (Analyze)      │
│   suggested_tp) │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                              ┌─────────────────┐
                                              │  calculateSL()  │
                                              │  calculateTP()  │◄── NEW
                                              │  (AI override)  │
                                              └─────────────────┘
```

### 3.2 修改清单

#### 修改 1：增加 `calculateTP` 函数

**文件：** `internal/strategy/engine/engine.go`

仿照现有的 `calculateSL`，增加 `calculateTP`：

```go
// calculateTP calculates take-profit prices, preferring AI suggestion over ATR-based calculation.
func calculateTP(aiResult *domain.AIResult, side string, price, atr, tp1Mult, tp2Mult float64, precision int) (tp1, tp2 float64, usedAI bool) {
    // Guard: ATR must be valid
    if atr <= 0 || math.IsNaN(atr) || math.IsInf(atr, 0) {
        defaultDist := price * 0.004 // 0.4% fallback
        if defaultDist <= 0 {
            defaultDist = 2.0
        }
        if side == "BUY" {
            return roundToPrecision(price+defaultDist, precision),
                   roundToPrecision(price+defaultDist*2, precision), false
        }
        return roundToPrecision(price-defaultDist, precision),
               roundToPrecision(price-defaultDist*2, precision), false
    }

    // Try AI suggested TP first
    if aiResult != nil && aiResult.SuggestedTP > 0 {
        dist := math.Abs(price - aiResult.SuggestedTP)
        // Validate direction: BUY TP must be above entry, SELL TP must be below entry
        sideValid := (side == "BUY" && aiResult.SuggestedTP > price) ||
                     (side == "SELL" && aiResult.SuggestedTP < price)
        if dist >= atr*0.5 && dist <= atr*5.0 && sideValid {
            log.Printf("[STRATEGY] 🤖 使用 AI 止盈: %s (距离=%s, ATR=%s)", ...)
            return aiResult.SuggestedTP, aiResult.SuggestedTP, true // TP1=TP2=AI suggestion
        }
        log.Printf("[STRATEGY] ⚠️ AI 止盈 %s 不合理, 使用 ATR 计算", ...)
    }

    // Fallback: ATR-based
    if side == "BUY" {
        return roundToPrecision(price+atr*tp1Mult, precision),
               roundToPrecision(price+atr*tp2Mult, precision), false
    }
    return roundToPrecision(price-atr*tp1Mult, precision),
           roundToPrecision(price-atr*tp2Mult, precision), false
}
```

#### 修改 2：在 `Analyze()` 中增加 TP 覆盖

**文件：** `internal/strategy/engine/engine.go:682-707`

在现有的 AI SL 覆盖逻辑之后，增加 AI TP 覆盖：

```go
// Apply AI stop-loss override if available (existing)
if snapshot.AIResult != nil && snapshot.AIResult.SuggestedSL > 0 {
    // ... existing code ...
}

// NEW: Apply AI take-profit override if available
if snapshot.AIResult != nil && snapshot.AIResult.SuggestedTP > 0 {
    aiTP := snapshot.AIResult.SuggestedTP
    dist := math.Abs(best.Entry - aiTP)
    sideValid := (best.Side == "BUY" && aiTP > best.Entry) ||
                 (best.Side == "SELL" && aiTP < best.Entry)
    if dist >= atr*0.5 && dist <= atr*5.0 && sideValid {
        originalTP1, originalTP2 := best.TP1, best.TP2
        best.TP1 = aiTP
        best.TP2 = aiTP // 或者保持 TP2 = TP1 * 1.5 的扩展
        log.Printf("[STRATEGY] 🤖 AI 止盈覆盖: TP1=%s→%s, TP2=%s→%s",
            formatFloat(originalTP1, precision), formatFloat(aiTP, precision),
            formatFloat(originalTP2, precision), formatFloat(best.TP2, precision))
    }
}
```

#### 修改 3：为 XAGUSD 增加独立策略配置

**文件：** `internal/strategy/engine/config.go`

```go
func GetStrategyConfigBySymbol(symbol string) StrategyConfig {
    switch strings.ToUpper(symbol) {
    case "XAUUSD", "GOLD":
        return DefaultStrategyConfig()
    case "XAGUSD", "SILVER":
        return SilverStrategyConfig()
    case "UKOILCASH", "USOILCASH", "OIL", "WTI", "BRENT":
        return OilStrategyConfig()
    default:
        return DefaultStrategyConfig()
    }
}

func SilverStrategyConfig() StrategyConfig {
    cfg := DefaultStrategyConfig()
    // 白银 ATR 绝对值小，需要更大的倍数才能达到合理盈亏比
    cfg.PullbackSLATR = 2.0   // 默认 1.5 → 2.0 (更宽的止损)
    cfg.PullbackTP1ATR = 3.0  // 默认 1.5 → 3.0 (更远的第一目标)
    cfg.PullbackTP2ATR = 5.0  // 默认 3.0 → 5.0 (更远的第二目标)
    cfg.MinScore = 6          // 提高门槛，减少噪音
    cfg.H4ADXThreshold = 22  // 白银趋势更弱，降低 ADX 阈值
    return cfg
}
```

#### 修改 4：在 `pickSLTP` 中集成 AI 建议

**文件：** `internal/strategy/engine/engine.go:198`

```go
func pickSLTP(side string, price float64, last domain.Bar, atr float64, precision int, cfg StrategyConfig, aiResult *domain.AIResult) (sl, tp1, tp2 float64, usedSR bool) {
    // ... existing support/resistance logic ...
    
    // NEW: Override with AI suggestions if available
    if aiResult != nil {
        sl, usedSL := calculateSL(aiResult, side, price, atr, cfg.PullbackSLATR, precision)
        tp1, tp2, usedTP := calculateTP(aiResult, side, price, atr, cfg.PullbackTP1ATR, cfg.PullbackTP2ATR, precision)
        if usedSL || usedTP {
            return sl, tp1, tp2, true
        }
    }
    
    // Fallback to existing logic
    // ...
}
```

### 3.3 验证点

1. **日志验证**：搜索 `"AI 止盈覆盖"` 和 `"AI 止损覆盖"` 日志同时出现
2. **XAGUSD 独立配置**：`grep "SilverStrategyConfig"` 确认被调用
3. **向后兼容**：AI 结果缺失时，ATR 计算正常回退

---

## 4. Risk（风险与缓解）

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AI TP 建议方向错误 | 止盈设在亏损方向 | `sideValid` 方向校验 + `dist` 范围校验 |
| AI TP 距离过远 | 永远无法触发止盈 | 上限 `atr*5.0` 约束 |
| XAGUSD 参数过激进 | 频繁止损 | 从保守值开始，根据回测调整 |
| 向后兼容破坏 | 无 AI 结果时行为异常 | 所有 AI 覆盖都有 nil/零值检查 |

---

## 5. Implementation Plan

1. **Phase 1**: 增加 `calculateTP` 函数 + `Analyze()` 中 TP 覆盖
2. **Phase 2**: 增加 `SilverStrategyConfig()` 和 `GetStrategyConfigBySymbol` 扩展
3. **Phase 3**: Codex 实现 + 本地测试
4. **Phase 4**: 提交 → 部署 → 日志验证

---

## 6. 道氏理论关联

道氏理论三大趋势可用于**增强 AI 建议的可信度**：

- **主要趋势**：如果 AI 建议的 SL/TP 与 H4/D1 主要趋势方向一致，提高置信度
- **次级趋势**：如果 AI 建议处于次级回调中，降低 TP 预期
- **小趋势**：日内信号（M15/M5）只影响 entry timing，不影响 SL/TP 结构

可在 `calculateSL` / `calculateTP` 中加入趋势一致性评分，作为是否采纳 AI 建议的额外过滤条件。
