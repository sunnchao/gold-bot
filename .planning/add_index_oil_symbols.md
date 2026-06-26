# GSD: 适配指数与原油交易品种

**File:** `.planning/add_index_oil_symbols.md`
**Type:** GSD (Goal-Scenario-Design)
**Model:** DeepSeek V4 Flash

---

## 1. Goal（目标）

在 gold-bot（Go 服务端 + MQL4 EA）和 gold-analysis-agent（Node.js）中，**去芜存菁**：

1. **删除** MQL4 EA 中的原油对冲套利模块（Brent-WTI spread trading），该模块与新的单一品种交易逻辑冲突
2. **新增**三个品种的全链路支持：**US100Cash**（纳斯达克指数CFD）、**USOilCash**（WTI原油）、**UkOilCash**（布伦特原油）
3. **暂时搁置** BTCUSD（比特币）

### 核心价值

- 将 EA 端原本用于价差交易的品种（USOilCash/UkOilCash）升级为**独立可交易品种**
- 指数品种（US100Cash）开启股票指数 CFD 交易能力
- 清理死代码，降低维护负担

### 非目标

- ❌ 不修改策略引擎的核心算法逻辑（Pullback/Breakout/Divergence 等策略逻辑保持不变）
- ❌ 不改变数据库表结构（现有 `(account_id, symbol)` 复合主键已支持）
- ❌ 不涉及 MT5 EA 端的修改

---

## 2. Scenario（场景分析）

### 2.1 现有原油对冲模块诊断

EA 端 `GoldBolt_Client.mq4` 中存在一个**完整的 Brent-WTI 价差套利模块**：

| 组件 | 位置 | 说明 |
|------|------|------|
| EnableSpread (extern) | L75 | 是否启用原油对冲 |
| SpreadSymbol1/2 | L77-78 | 默认为 UKOilCash / USOilCash |
| AutoSpreadTrade() | L1997-2133 | 核心价差交易逻辑 |
| CloseAllSpreadPositions() | L2138-2163 | 平仓所有价差持仓 |
| CalculateVolWeightedLots() | L1964-1992 | 波动率加权手数计算 |
| spreadSymbolsReady | L101 | 全局标记 |

**问题：** 这些品种（USOilCash/UkOilCash）被 EA 内部使用，但 Go 服务端对它们几乎没有处理。如果要让原油成为独立交易品种，价差模块必须拆除，否则 EA 会同时运行两套互相干扰的逻辑。

### 2.2 新品种特性分析

| 特性 | US100Cash (纳斯达克) | USOilCash (WTI原油) | UkOilCash (布伦特) |
|---|---|---|---|
| **品类** | 指数 CFD | 商品 CFD | 商品 CFD |
| **市场时间** | 夏令 06:00~05:00 次日(GMT) | 周一~周五，~23:00-22:00 GMT | 同 WTI |
| **典型价格** | ~19000-22000 | ~70-85 | ~75-90 |
| **M15 ATR** | ~50-200 | ~0.3-1.5 | ~0.3-1.5 |
| **点值** | 1.0 (CFD) | 0.01 | 0.01 |
| **合约规格** | 1 (CFD) | 100 (标准合约) | 100 (标准合约) |
| **小数位** | 2 | 2 | 2 |
| **波动率** | 高 | 中高 | 中高 |
| **趋势性** | 强（美股趋势延续性好） | 强但假突破多 | 同 WTI |
| **成交量** | 可靠 | 可靠 | 可靠 |
| **交易时段限制** | 美股休市（周六/周日） | 商品闭市时段 | 商品闭市时段 |
| **周五收盘** | Normal Friday | 商品提前收盘 | 商品提前收盘 |

### 2.3 各品种的关键差异点

**US100Cash（指数）：**
- 价格高（~20000），ATR 绝对值大（M15 ~50-200，H1 ~200-800）
- **必须修改市场过滤的时间窗口**：纳斯达克交易时段与外汇/商品不同
- 趋势性强，适合较宽松的入场条件
- 不需要 FridayClose 窗口过滤（CFD 指数交易至周五收盘）

**USOilCash / UkOilCash（原油）：**
- 价格中低（~70-90），ATR 绝对值小（M15 ~0.3-1.5）
- 策略参数中 ATR 倍数必须**放大**（因为 ATR 绝对值小，1倍 ATR 只有 0.3-1.5 点）
- 假突破多，SL 需要更宽
- 趋势性强，ADX 阈值可以设低
- 两种原油共享同一套策略参数基类

---

## 3. Design（设计方案）

### 3.1 删除原油对冲模块（EA 端，第 1 步）

从 `GoldBolt_Client.mq4` 删除以下内容：

**A) 外部参数（extern），约 L71-L84：**
```cpp
// 整个原油对冲套利配置组
input group "===== 原油对冲套利 ====="
extern bool     EnableSpread        = false;
extern int      SpreadMagicNumber   = 20250224;
extern string   SpreadSymbol1       = "UKOilCash";
extern string   SpreadSymbol2       = "USOilCash";
extern double   SpreadLots          = 0.05;
extern bool     EnableAutoSpreadTrade = true;
extern int      SpreadEntryPts       = 150;
extern int      SpreadExitPts        = 50;
extern int      SpreadTradeInterval  = 60;
```

**B) 全局变量 L101：**
```cpp
bool     spreadSymbolsReady = false;  // 原油品种是否可用
```

**C) 初始化代码 L366-L390：**
```cpp
// 原油对冲套利配置
if(EnableSpread) { ... }
```

**D) 持仓扫描中的 spreadCount（L395-L418）：**
```cpp
int spreadCount = 0;  // 删除
...
else if(magic == SpreadMagicNumber){ spreadCount++; Print("   🛢️ 原油对冲: ", info); }  // 删除
```

**E) 函数体：**
- `bool IsSpreadSymbol(string sym)` — L210
- `void AutoSpreadTrade()` — L1997-L2133
- `void CloseAllSpreadPositions()` — L2138-L2163
- `void CalculateVolWeightedLots()` — L1964-L1992

**F) IsAllowedSymbol() 中的 `IsSpreadSymbol` 调用（L221）：**
```cpp
// 原来: return (IsPrimarySymbol(sym) || IsSpreadSymbol(sym));
// 改为: return IsPrimarySymbol(sym);
```

**G) OnTick 中 AutoSpreadTrade 的调用点**

**H) 注释中的 USOIL 引用（L92 注释）**

### 3.2 Go 服务端 — 删除遗留代码

**A) `internal/strategy/engine/engine.go` — `roundingPrecision()`**
```go
// 原来: case "XAUUSD", "XAGUSD", "GOLD", "UKOILCASH", "USOILCASH":
// 改为: case "XAUUSD", "XAGUSD", "GOLD", "US100CASH", "USOILCASH", "UKOILCASH":
// 精度都为2，保留即可
```

**B) `config.py` — 删除 reversal 策略（已 disabled）**
```python
"reversal": { ... }  # 整个删除
```

### 3.3 Go 服务端 — 新增 3 个品种的完整支持

#### 3.3.1 BaseSymbol() 映射

文件：`internal/domain/strategy.go`

```go
func BaseSymbol(raw string) string {
    s := strings.ToUpper(strings.TrimSpace(raw))
    s = strings.TrimSuffix(s, "M#")
    s = strings.TrimSuffix(s, "#")
    switch s {
    case "GOLD", "XAUUSD":
        return "XAUUSD"
    case "XAGUSD", "SILVER":
        return "XAGUSD"
    case "US100CASH", "US100", "NAS100":
        return "US100CASH"
    case "USOILCASH", "USOIL", "WTI":
        return "USOILCASH"
    case "UKOILCASH", "UKOIL", "BRENT":
        return "UKOILCASH"
    // ... 保留所有现有映射
    }
    return s
}
```

#### 3.3.2 策略配置（config.go）

**US100CashStrategyConfig:** 指数品种，高价格、大幅波动、趋势延续性好

```go
func US100CashStrategyConfig() StrategyConfig {
    cfg := DefaultStrategyConfig()
    // H4趋势 — 指数趋势性强，略降低ADX门槛
    cfg.H4ADXThreshold = 22.0
    cfg.H4RequireConsecutive = 2
    // Pullback — 指数回调幅度大
    cfg.PullbackMinADX = 22.0
    cfg.PullbackDistATR = 0.6
    cfg.PullbackSLATR = 1.0
    cfg.PullbackTP1ATR = 1.5
    cfg.PullbackTP2ATR = 3.0
    // BreakoutRetest
    cfg.BreakoutRetestSLATR = 1.2
    cfg.BreakoutRetestTP1ATR = 2.0
    cfg.BreakoutRetestTP2ATR = 4.0
    // Divergence
    cfg.DivergenceSLATR = 0.8
    cfg.DivergenceTP1ATR = 1.5
    cfg.DivergenceTP2ATR = 3.0
    // BreakoutPyramid
    cfg.BreakoutPyramidMinADX = 25.0
    cfg.BreakoutPyramidSLATR = 1.2
    // MomentumScalp
    cfg.MomentumScalpMinADX = 16.0
    cfg.MomentumScalpSLATR = 0.3
    cfg.MomentumScalpTP1ATR = 0.5
    cfg.MomentumScalpTP2ATR = 0.8
    cfg.MomentumScalpMaxHoldingMin = 30  // 日内交易，收盘前出清
    cfg.MomentumScalpMinScore = 6
    // 多周期趋势权重 — 指数H4趋势更可靠
    cfg.Trend.H4Weight = 0.30
    cfg.Trend.H1Weight = 0.35
    cfg.Trend.M30Weight = 0.30
    cfg.Trend.D1Weight = 0.05
    cfg.MinScore = 5
    cfg.FibExtension.MinADX = 25.0
    return cfg
}
```

**OilStrategyConfig:** 原油品种基类。USOilCash/UkOilCash 共享

```go
func OilStrategyConfig() StrategyConfig {
    cfg := DefaultStrategyConfig()
    // 原油趋势性强但假突破多 — 需要更宽SL
    cfg.H4ADXThreshold = 22.0
    cfg.H4RequireConsecutive = 2
    // Pullback — 原油ATR绝对值小，ATR倍数放大
    cfg.PullbackMinADX = 20.0
    cfg.PullbackDistATR = 0.8  // 回调距离更大
    cfg.PullbackSLATR = 2.0    // SL放大到2倍ATR（ATR本身只有~0.5-1.0）
    cfg.PullbackTP1ATR = 2.5
    cfg.PullbackTP2ATR = 4.0
    // BreakoutRetest — 假突破多，SL宽
    cfg.BreakoutRetestLookback = 45
    cfg.BreakoutRetestDistATR = 0.7
    cfg.BreakoutRetestSLATR = 2.0
    cfg.BreakoutRetestTP1ATR = 2.5
    cfg.BreakoutRetestTP2ATR = 4.5
    // Divergence
    cfg.DivergenceSLATR = 1.5
    cfg.DivergenceTP1ATR = 2.5
    cfg.DivergenceTP2ATR = 4.5
    // BreakoutPyramid — 需要更高的ADX确认
    cfg.BreakoutPyramidMinADX = 28.0
    cfg.BreakoutPyramidSLATR = 2.0
    cfg.BreakoutPyramidMinSpacingATR = 2.5
    // ScaleIn
    cfg.ScaleInMinADX = 22.0
    cfg.ScaleInSLATR = 1.8
    cfg.ScaleInTP1ATR = 2.0
    cfg.ScaleInTP2ATR = 3.5
    // MomentumScalp — 原油M1/M5波动小，放宽参数
    cfg.MomentumScalpMinADX = 15.0
    cfg.MomentumScalpSLATR = 0.6
    cfg.MomentumScalpTP1ATR = 0.8
    cfg.MomentumScalpTP2ATR = 1.2
    cfg.MomentumScalpMinScore = 7
    cfg.MomentumScalpMaxHoldingMin = 45
    cfg.M15ConfirmRSIThreshold = 42.0
    cfg.MinScore = 5
    cfg.FibExtension.MinADX = 28.0
    cfg.PullbackFib.RetracementEnabled = true
    cfg.PullbackFib.GoldenPocketBufferATR = 0.4
    return cfg
}
```

`GetStrategyConfigBySymbol()` 增加：
```go
case "US100CASH":
    return US100CashStrategyConfig()
case "USOILCASH", "UKOILCASH":
    return OilStrategyConfig()
```

#### 3.3.3 风控元数据（riskgate/gate.go）

`metadataFor()` 增加：

```go
case "US100CASH":
    return symbolMeta{
        Symbol:        "US100CASH",
        ContractSize:  1,        // CFD，每点1美元
        MinLot:        0.01,
        MaxLot:        20,
        LotStep:       0.01,
        MaxSpread:     80.0,
        MinSLDistance: 1.0,     // 指数最少止损1点
        MaxSLDistance: 500.0,   // 最大止损500点
    }
case "USOILCASH":
    return symbolMeta{
        Symbol:        "USOILCASH",
        ContractSize:  100,     // 标准原油合约
        MinLot:        0.01,
        MaxLot:        30,
        LotStep:       0.01,
        MaxSpread:     80.0,
        MinSLDistance: 0.05,    // 原油最小止损5分
        MaxSLDistance: 10.0,    // 最大止损10美元
    }
case "UKOILCASH":
    return symbolMeta{
        Symbol:        "UKOILCASH",
        ContractSize:  100,     // 标准布伦特合约
        MinLot:        0.01,
        MaxLot:        30,
        LotStep:       0.01,
        MaxSpread:     80.0,
        MinSLDistance: 0.05,    // 布伦特最小止损5分
        MaxSLDistance: 10.0,    // 最大止损10美元
    }
```

#### 3.3.4 市场过滤（marketfilter/filter.go）

**核心架构改动：** 交易时段过滤需要做 symbol 感知。

```go
func Evaluate(input Input) Result {
    // ... 现有逻辑 ...
    
    // 原来的硬编码时间窗口改为 symbol 感知
    if isSymbolSpecificCloseWindow(now, input.Symbol) {
        add("session.close_window", SeverityBlocking)
    }
    if isSymbolSpecificRolloverWindow(now, input.Symbol) {
        add("session.rollover_window", SeverityWarning)
    }
    if isSymbolSpecificLowLiquiditySession(now, input.Symbol) {
        add("session.low_liquidity", SeverityWarning)
    }
    // ...
}
```

新增函数：

```go
// Trading session time windows (UTC)
type sessionWindow struct {
    openHour   int  // UTC open hour
    openMin    int
    closeHour  int  // UTC close hour
    closeMin   int
    closeDay   time.Weekday // day of week when market closes for weekend
    reopenHour int // UTC hour when market reopens after weekend
}

func symbolSession(symbol string) sessionWindow {
    base := domain.BaseSymbol(symbol)
    switch base {
    case "US100CASH":
        // NASDAQ CFD: Mon-Fri, 09:30-16:00 ET = 13:30-20:00 UTC (summer)
        // Simplified: ~14:00-21:00 UTC (all year rough)
        return sessionWindow{
            openHour: 14, openMin: 0,
            closeHour: 21, closeMin: 0,
            closeDay: time.Friday,
            reopenHour: 14, // Monday 14:00 UTC
        }
    case "USOILCASH", "UKOILCASH":
        // Commodity: Mon-Fri, ~23:00-22:00 UTC
        // Rollover at 22:00 UTC
        return sessionWindow{
            openHour: 23, openMin: 0,
            closeHour: 22, closeMin: 0,
            closeDay: time.Friday,
            reopenHour: 23, // Sunday 23:00 UTC (prepare for Monday)
        }
    default:
        // Forex: 24x5, Sun 22:00 - Fri 22:00 GMT
        return sessionWindow{
            openHour: 22, openMin: 0,
            closeHour: 22, closeMin: 0,
            closeDay: time.Friday,
            reopenHour: 22, // Sunday
        }
    }
}

func isSymbolSpecificCloseWindow(now time.Time, symbol string) bool {
    base := domain.BaseSymbol(symbol)
    switch base {
    case "US100CASH":
        // NASDAQ: only check weekend close
        if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
            return true
        }
        // Friday early close (simplified: last hour of session)
        if now.Weekday() == time.Friday {
            session := symbolSession(symbol)
            minuteOfDay := now.Hour()*60 + now.Minute()
            closeMinute := session.closeHour*60 + session.closeMin
            // Block last 30 minutes for safe exit
            if minuteOfDay >= closeMinute-30 && minuteOfDay <= closeMinute {
                return true
            }
        }
        return false
    default:
        // Forex/Oil: keep existing Friday close window
        return now.Weekday() == time.Friday && now.Hour() >= 20
    }
}
```

**注意：** 代码复杂度控制 — 为 3 个新品种分支增加过重。这里优先选择**适度改动**：
- US100Cash 需要特殊的 session 检查（美股时段）
- USOil/UKOil 与外汇共享大部分行为，仅 FridayClose 时间不同
- 避免过度设计，能用默认行为就用默认

### 3.4 roundingPrecision() 更新

```go
case "XAUUSD", "XAGUSD", "GOLD", "US100CASH", "USOILCASH", "UKOILCASH":
    return 2
```

### 3.5 engine_test.go 更新 `TestRoundToPrecisionAndRoundingPrecision`

```go
{symbol: "USOilCash", value: 72.345, wantPrec: 2, wantRound: 72.35},
// 新增:
{symbol: "UKOilCash", value: 75.123, wantPrec: 2, wantRound: 75.12},
{symbol: "US100Cash", value: 19876.54, wantPrec: 2, wantRound: 19876.54},
```

### 3.6 Gold Analysis Agent 修改

#### 3.6.1 ALLOWED_SYMBOLS 白名单

文件：`src/trigger/trigger.controller.ts`

```typescript
const ALLOWED_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'GOLD', 'GBPJPY', 'EURJPY', 'USDJPY',
  'GBPUSD', 'USDCAD', 'EURUSD', 'AUDUSD', 'NZDUSD', 'USDCNH',
  'US100CASH', 'USOILCASH', 'UKOILCASH',
]);
```

#### 3.6.2 SymbolProfile 配置

文件：`src/config/symbol-profile.ts`

新增 3 个 profile：

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
  slAtrMultiplier: 1.0,
  tpAtrMultiplier: 2.0,
  volatilityLevel: 'high',
  priceRangeHint: 'typically 15000–25000 USD',
  assetClass: 'index',
  volumeReliable: true,
},
USOILCASH: {
  symbol: 'USOILCASH',
  name: 'WTI原油 (US Oil Cash CFD)',
  pricePrecision: 2,
  pipValue: 0.01,
  typicalAtrRange: {
    M15: { min: 0.2, max: 1.5 },
    M30: { min: 0.3, max: 2.5 },
    H1: { min: 0.5, max: 4.0 },
    H4: { min: 1.0, max: 8.0 },
  },
  slAtrMultiplier: 2.0,
  tpAtrMultiplier: 3.5,
  volatilityLevel: 'medium',
  priceRangeHint: 'typically 60–100 USD/barrel',
  assetClass: 'commodity',
  volumeReliable: true,
},
UKOILCASH: {
  symbol: 'UKOILCASH',
  name: '布伦特原油 (UK Oil Cash CFD)',
  pricePrecision: 2,
  pipValue: 0.01,
  typicalAtrRange: {
    M15: { min: 0.2, max: 1.5 },
    M30: { min: 0.3, max: 2.5 },
    H1: { min: 0.6, max: 4.5 },
    H4: { min: 1.2, max: 9.0 },
  },
  slAtrMultiplier: 2.0,
  tpAtrMultiplier: 3.5,
  volatilityLevel: 'medium',
  priceRangeHint: 'typically 65–105 USD/barrel',
  assetClass: 'commodity',
  volumeReliable: true,
},
```

---

## 4. Implementation Steps

### Step 1: 删除 EA 原油对冲模块
文件：`mt4_ea/GoldBolt_Client.mq4`
- 删除 extern 参数（L71-L84）
- 删除 spreadSymbolsReady 全局变量（L101）
- 删除 `IsSpreadSymbol()` 函数（L210）
- 修改 `IsAllowedSymbol()`（L221）
- 删除初始化代码（L366-L390）
- 删除持仓扫描中的 spreadCount 相关代码（L394-L417）
- 删除 `AutoSpreadTrade()`, `CloseAllSpreadPositions()`, `CalculateVolWeightedLots()`
- 删除 OnTick 中对 AutoSpreadTrade 的调用
- 清理 L92 注释中的 USOIL 引用

### Step 2: 删除 Go 服务端遗留代码
文件：`config.py`
- 删除 reversal 策略块

### Step 3: BaseSymbol() 映射
文件：`internal/domain/strategy.go`
- 新增 US100CASH, USOILCASH, UKOILCASH 映射

### Step 4: 策略配置
文件：`internal/strategy/engine/config.go`
- 新增 `US100CashStrategyConfig()`
- 新增 `OilStrategyConfig()`
- 在 `GetStrategyConfigBySymbol()` 注册三个品种

### Step 5: 风控元数据
文件：`internal/strategy/riskgate/gate.go`
- 在 `metadataFor()` 中新增 US100CASH/USOILCASH/UKOILCASH 分支

### Step 6: 市场过滤 session 感知
文件：`internal/strategy/marketfilter/filter.go`
- 新增 session 感知函数
- 修改 Evaluate() 调用

### Step 7: roundingPrecision 更新
文件：`internal/strategy/engine/engine.go`
- 在 roundingPrecision switch 中加入新品种

### Step 8: 测试更新
文件：`internal/strategy/engine/engine_test.go`
- 追加新品种的 rounding precision 测试用例

### Step 9: Gold Analysis Agent 白名单
文件：`src/trigger/trigger.controller.ts`
- 添加 US100CASH, USOILCASH, UKOILCASH 到 ALLOWED_SYMBOLS

### Step 10: Gold Analysis Agent SymbolProfile
文件：`src/config/symbol-profile.ts`
- 追加 3 个 profile

### Step 11: 构建验证
```bash
cd /root/gold-bot && go build ./... && go test ./... -count=1
cd /root/gold-analysis-agent && npm run build  # 或 tsc --noEmit
```

---

## 5. DANGER ZONES（踩坑预警）

1. **EA 端删代码后必须验证编译** — 确保不遗漏 `spreadSymbolsReady` / `IsSpreadSymbol` / `SpreadMagicNumber` 的引用。删除前 grep 全部引用点。
2. **`config.py` 虽然已不是主力配置**，但可能被某些自动化脚本引用。删除 reversal 前检查是否有脚本读取该 key。
3. **US100Cash 的交易时段** — CFD 经纪商的指数交易时间各异。当前使用简化模型（14:00-21:00 UTC），上线后需根据实际经纪商调整。
4. **原油品种的合约规格** — `ContractSize` 和 `pipValue` 是经纪商特定的。`symbolMeta` 中的数值需与 EA 端实际合约匹配。
5. **MQL4 的 extern 变量删除** — 如果 EA 已有外部配置（.set 文件或终端参数面板），删除 extern 会导致加载配置时报警。需同步更新实盘使用的 .set 文件。
6. **测试覆盖** — `config_test.go` 中可能有硬编码的期望值。新增配置后检查测试是否需要更新。
7. **Gold Analysis Agent** — `symbol-profile.ts` 的 `assetClass` 新增 `'index'` 和 `'commodity'` 后，需确认下游消费代码（LLM 提示词构造）能正确处理新的类型。

---

## 6. Success Criteria（验收标准）

1. ✅ EA 编译通过，不再引用任何 spread 相关变量/函数
2. ✅ `go build ./...` 通过
3. ✅ `go test ./internal/... -count=1` 通过
4. ✅ US100Cash、USOilCash、UKOilCash 的 `BaseSymbol()` 返回标准化值
5. ✅ US100Cash/USOilCash/UKOilCash 的 `GetStrategyConfigBySymbol()` 返回各自的配置
6. ✅ gold-analysis-agent 的 `trigger_analysis` 端点接受新品种
7. ✅ 三个新品种的 price precision 测试通过
8. ✅ 删除的代码不再出现在 git diff 中
