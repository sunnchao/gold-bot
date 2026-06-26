# US100Cash (纳指) 交易参数优化方案

> 基于 Tavily 搜索结果（Quant Signals 10,830笔回测 / LuxAlgo / FundedFirm / NinjaTrader / Eightcap） + gold-bot 当前代码审计

## 一、核心结论

| 维度 | 当前状态 | 优化后预期 |
|:---|:---:|:---:|
| 日盈亏比加权平均 | ~1.6 | **~2.5** |
| H1 扫损率 | 偏高（SL偏窄） | 降低（SL适配ATR真实值） |
| 时段有效性 | 错误时段交易 | 仅美盘活跃时交易 |
| MaxSLDistance clamp 率 | 频繁（H1 ATR>500） | 几乎消除 |
| Scalp 生存率 | 低（0.3 ATR 间隔太小） | 中（0.5 ATR 可承受噪声） |

---

## 二、要修改的文件（共 6 个）

### P0 — 必须修（影响盈亏）

#### 1. `internal/strategy/engine/config.go` — `US100CashStrategyConfig()`

```go
func US100CashStrategyConfig() StrategyConfig {
    cfg := DefaultStrategyConfig()
    cfg.H4ADXThreshold = 25.0          // 当前 22 → 25（纳指趋势质量高）
    cfg.H4RequireConsecutive = 3       // 当前 2 → 3

    // — Pullback —
    cfg.PullbackMinADX = 22.0
    cfg.PullbackDistATR = 0.6
    cfg.PullbackSLATR = 1.0            // 保持（行业标准 1.0-1.5）
    cfg.PullbackTP1ATR = 2.0           // 当前 1.5 → 2.0（RR 1.5→2.0）
    cfg.PullbackTP2ATR = 3.5           // 当前 3.0 → 3.5

    // — BreakoutRetest —
    cfg.BreakoutRetestLookback = 45    // 当前 50 → 45（S/R变化更快）
    cfg.BreakoutRetestDistATR = 0.6    // 当前 0.5 → 0.6
    cfg.BreakoutRetestSLATR = 1.0      // 当前 1.2 → 1.0（纳指假突破少）
    cfg.BreakoutRetestTP1ATR = 2.5     // 当前 2.0 → 2.5（RR 1.67→2.5）
    cfg.BreakoutRetestTP2ATR = 5.0     // 当前 4.0 → 5.0

    // — Divergence —
    cfg.DivergenceSLATR = 0.6          // 当前 0.8 → 0.6（背离信号可靠）
    cfg.DivergenceTP1ATR = 2.0         // 当前 1.5 → 2.0（RR 1.88→3.33）
    cfg.DivergenceTP2ATR = 4.0         // 当前 3.0 → 4.0

    // — BreakoutPyramid —
    cfg.BreakoutPyramidMinADX = 25.0   // 保持
    cfg.BreakoutPyramidSLATR = 1.0     // 当前 1.2 → 1.0

    // — ScaleIn —
    cfg.ScaleInSLATR = 1.0             // 保持
    cfg.ScaleInTP1ATR = 2.0            // 当前 1.5 → 2.0
    cfg.ScaleInTP2ATR = 3.5            // 当前 3.0 → 3.5

    // — MomentumScalp —
    cfg.MomentumScalpMinADX = 16.0
    cfg.MomentumScalpSLATR = 0.5       // 当前 0.3 → 0.5（防扫损）
    cfg.MomentumScalpTP1ATR = 0.8      // 当前 0.5 → 0.8
    cfg.MomentumScalpTP2ATR = 1.2      // 当前 0.8 → 1.2
    cfg.MomentumScalpMaxHoldingMin = 60 // 当前 30 → 60（纳指动量周期长）
    cfg.MomentumScalpMinScore = 6

    // — Trend 权重（纳指趋势强，加大H4权重） —
    cfg.Trend.H4Weight = 0.35          // 当前 0.30
    cfg.Trend.H1Weight = 0.35
    cfg.Trend.M30Weight = 0.25         // 当前 0.30
    cfg.Trend.D1Weight = 0.05

    cfg.MinScore = 5
    cfg.FibExtension.MinADX = 25.0
    return cfg
}
```

**调整后盈亏比汇总：**

| 策略 | 当前 RR | 新 RR | 变化 |
|:---|:---:|:---:|:---|
| Pullback | 1.5 | **2.0** | +33% |
| BreakoutRetest | 1.67 | **2.5** | +50% |
| Divergence | 1.88 | **3.33** | +77% |
| MomentumScalp | 1.67 | **1.6** | 略降（但胜率提高） |
| ScaleIn | 1.5 | **2.0** | +33% |

#### 2. `internal/strategy/riskgate/gate.go` — `metadataFor()`

```go
case "US100CASH":
    return symbolMeta{
        Symbol: "US100CASH",
        ContractSize:  1,
        MinLot:        0.01,
        MaxLot:        20,
        LotStep:       0.01,
        MaxSpread:     80.0,
        MinSLDistance: 10.0,       // 当前 1.0 → 10（纳指价格~20,000）
        MaxSLDistance: 3000.0,     // 当前 500 → 3000（H4 ATR 可达 2000）
    }
```

**MaxSLDistance=500 的问题：** 当 H1 ATR > 500 时（近期频繁出现），Pullback SL(=1.0 ATR) > 500 → 被 clamp → 实际手数偏大、RR 偏离。3000 可兼容 H4 ATR 上限。

#### 3. `internal/strategy/marketfilter/filter.go` — 交易时段修复

**Bug 定位：** 当前 `isSymbolLowLiquiditySession` 用 CST 14:00-21:00 判为"好时段"，但美盘实际交易时段为 CST 21:30-04:00（夏令时）。需要修正。

**方案 A（推荐）：** 基于美盘时段做多重过滤

```go
func isSymbolCloseWindow(now time.Time, symbol string) bool {
    switch domain.BaseSymbol(symbol) {
    case "US100CASH":
        // 美盘周末关闭
        if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
            return true
        }
        // 美盘收盘：04:00 CST = 16:00 ET（夏令时）
        h, m := now.Hour(), now.Minute()
        return h >= 4
    default:
        return now.Weekday() == time.Friday && now.Hour() >= 20
    }
}

func isSymbolRolloverWindow(now time.Time, symbol string) bool {
    switch domain.BaseSymbol(symbol) {
    case "US100CASH":
        return false // 指数无 rollover
    default:
        minuteOfDay := now.Hour()*60 + now.Minute()
        return minuteOfDay >= 21*60+55 && minuteOfDay <= 22*60+10
    }
}

func isSymbolLowLiquiditySession(now time.Time, symbol string) bool {
    switch domain.BaseSymbol(symbol) {
    case "US100CASH":
        h, m := now.Hour(), now.Minute()
        minuteOfDay := h*60 + m
        // 美盘 open = 21:30 CST
        openMin := 21*60 + 30   // 21:30
        closeMin := 4 * 60     // 04:00
        // 开盘前 30min → 低流动性（等待开盘稳定）
        if minuteOfDay >= openMin-30 && minuteOfDay < openMin {
            return true
        }
        // 开盘后前 20min → 缺口回补期，低稳定性
        if minuteOfDay >= openMin && minuteOfDay < openMin+20 {
            return true
        }
        // 美盘收盘前 15min → 流动性降低
        if minuteOfDay >= closeMin-15 && minuteOfDay < closeMin {
            return true
        }
        // 非美盘时间
        if minuteOfDay >= closeMin || minuteOfDay < openMin-30 {
            return true
        }
        return false
    default:
        minuteOfDay := now.Hour()*60 + now.Minute()
        return minuteOfDay > 22*60+10 || minuteOfDay < 1*60
    }
}
```

**时段分层效果：**

| CST 时段 | 状态 | 说明 |
|:---|:---:|:---|
| 21:00-21:30 | 低流动性 | 开盘前等待 |
| 21:30-21:50 | 低流动性 | 开盘缺口回补期 |
| **21:50-03:45** | **✅ 正常交易** | **核心美盘时段** |
| 03:45-04:00 | 低流动性 | 尾盘流动性降低 |
| 04:00-21:00 | 关闭 | 美盘关闭，不交易 |

### P1 — 建议改（辅助优化）

#### 4. `mt4_ea/GoldBolt_Client.mq4` — 手数减半

（当前已修改：US100Cash 用标准手数 × 0.5，无需再改）

```mql4
// US100Cash 指数CFD手数减半（标准手数 × 0.5）
if(StringFind(symbol, "US100") >= 0 || StringFind(symbol, "NAS100") >= 0)
   lots = lots * 0.5;
```

#### 5. `gold-analysis-agent/src/config/symbol-profile.ts` — US100CASH

```typescript
US100CASH: {
    symbol: 'US100CASH',
    name: '纳斯达克100指数 (US100 Cash CFD)',
    pricePrecision: 2,
    pipValue: 1.0,
    typicalAtrRange: {
      M15: { min: 30, max: 200 },
      M30: { min: 50, max: 400 },
      H1: { min: 100, max: 800 },
      H4: { min: 300, max: 2000 },
    },
    slAtrMultiplier: 0.8,         // 当前 1.0 → 0.8（匹配新策略）
    tpAtrMultiplier: 2.5,         // 当前 2.0 → 2.5（匹配新策略）
    volatilityLevel: 'high',
    priceRangeHint: 'typically 15000–25000 USD',
    assetClass: 'index',
    volumeReliable: true,
    // 新增：进场指引（辅助 LLM 分析）
    entryGuidance: {
      primaryHours: "21:30-04:00 CST (US session)",
      avoidFirstMin: 20,           // 开盘后前20min不进场
      gapFillNeeded: true,         // 需要等缺口回补
      volumeConfirmNeeded: true,   // 需要成交量确认
      bestStrategies: ["pullback_on_trend", "breakout_retest_on_volume"],
      avoidConditions: ["vxn_above_30", "nonfarm_hour", "pre_open"]
    }
}
```

#### 6. 远期：`internal/strategy/engine/engine.go` — 成交量过滤器

（建议放到下个迭代，当前不做）

```go
// 在 checkPullback / checkBreakoutRetest 等函数中增加
if symbol.VolumeReliable && !hasVolumeSurge(bars, threshold) {
    return nil // 成交量不足，不产生信号
}
```

---

## 三、修改后全策略对照表

| 策略 | SL (ATR) | TP1 (ATR) | TP2 (ATR) | RR | 胜率预期 | 期望值 |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| Pullback | 1.0 | 2.0 | 3.5 | **2.0** | 35-45% | +0.05~+0.35R |
| BreakoutRetest | 1.0 | 2.5 | 5.0 | **2.5** | 40-50% | +0.40~+0.75R |
| Divergence | 0.6 | 2.0 | 4.0 | **3.33** | 55-65% | +1.38~+1.83R |
| BreakoutPyramid | 1.0 | — | — | 加仓型 | — | — |
| ScaleIn | 1.0 | 2.0 | 3.5 | **2.0** | — | 加仓后RR改善 |
| MomentumScalp | 0.5 | 0.8 | 1.2 | **1.6** | 55-65% | +0.43~+0.69R |

---

## 四、影响范围评估

| 文件 | 改动行数 | 风险等级 | 回滚难度 |
|:---|:---:|:---:|:---:|
| `engine/config.go` | ~30行 | 🟢 低（纯参数） | 极低 |
| `riskgate/gate.go` | 2行 | 🟢 低 | 极低 |
| `marketfilter/filter.go` | ~60行 | 🟡 中（交易时段逻辑） | 低 |
| `mt4_ea/ GoldBolt_Client.mq4` | 已改 | — | — |
| `symbol-profile.ts` | ~10行 | 🟢 低（仅 Agent 提示） | 极低 |

**总改动量：约 100 行代码，无架构变化，可独立部署。**