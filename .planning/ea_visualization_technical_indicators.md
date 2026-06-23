# EA 可视化 + Go 深度计算 — 技术方案设计

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MT4/MT5 客户端                              │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐   │
│  │  原始K线数据  │───▶│  EA 可视化层    │◄───│  Go服务端推送数据 │   │
│  │  (OHLCV)     │    │  箭头/文字/颜色  │    │  (divergence等)  │   │
│  └──────────────┘    └─────────────────┘    └──────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│                         ┌─────────────┐                            │
│                         │ MT4图表显示  │                            │
│                         │ 箭头+文字标签│                            │
│                         └─────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         gold-bot (Go服务端)                          │
│  ┌────────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │  /bars 端点         │───▶│  指标计算引擎   │───▶│  Redis缓存   │ │
│  │  接收OHLCV         │    │  (MACD/RSI背离) │    │              │ │
│  └────────────────────┘    └─────────────────┘    └──────┬───────┘ │
│                                                           │        │
│  ┌────────────────────┐    ┌─────────────────┐           │        │
│  │  /analysis 端点     │◄───│  信号评估引擎   │◄─────────┘        │
│  │  返回完整分析报告   │    │  (含新指标权重) │                    │
│  └────────────────────┘    └─────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      gold-analysis-agent                              │
│                    (LLM 分析增强)                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## 数据流

### 1. 上行: EA → Go 服务端
```
原始OHLCV + 账户信息 → /bars 端点
```

### 2. 下行: Go 服务端 → treasures → EA
```
POST /indicator_alert  → EA 收到后在图表上绘制
```

### 3. 触发条件
- Go 端检测到背离/谐波形态后，主动推送到 EA
- EA 用 HTTP POST 轮询或 WebSocket 接收（当前 EA 已经是轮询 /poll）

## 数据协议设计

### Go → EA: 指标预警数据格式

```json
{
  "type": "indicator_alert",
  "symbol": "XAUUSD",
  "timeframe": "H1",
  "alerts": [
    {
      "indicator": "macd_divergence",
      "direction": "bullish",
      "strength": "strong",       // strong | moderate | weak
      "confidence": 0.85,         // 0.0 ~ 1.0
      "time": "2024-06-23T15:00:00Z",
      "price": 2320.50,
      "description": "价格在2030-2028形成更低低点，MACD柱状图未能同步走低，形成 bullish 背离",
      "suggested_action": "consider_buy",
      "entry_zone": {"min": 2028.0, "max": 2032.0},
      "stop_loss": 2025.0,
      "take_profits": [2040.0, 2045.0, 2050.0]
    },
    {
      "indicator": "harmonic_pattern",
      "pattern": "butterfly_bull",
      "point_d": 2028.50,
      "completion": 0.95,         // 形态完成度
      "time": "2024-06-23T15:00:00Z",
      "description": "XABCD 蝴蝶形态，D点在1.618XA附近，Bullish",
      "fib_ratios": {
        "ab_xa": 0.786,
        "bc_ab": 0.886,
        "cd_bc": 2.618,
        "xa_ratio": 1.618
      }
    }
  ]
}
```

## EA 可视化层设计

### 1. 对象类型映射

| 指标类型 | 对象类型 | 颜色 | 图形 |
|---------|---------|------|------|
| MACD Bullish背离 | OBJ_ARROW_UP | Lime | 绿色上箭头 |
| MACD Bearish背离 | OBJ_ARROW_DOWN | Red | 红色下箭头 |
| RSI 背离 | OBJ_ARROW | Orange | 橙色箭头(小) |
| 蝴蝶形态完成 | OBJ_TRIANGLE | Cyan | 青色三角形 |
| 加特利形态 | OBJ_RECTANGLE | Blue | 蓝色方框 |
| 谐波PRZ(潜在反转区) | OBJ_RECTANGLE | Yellow | 黄色区域 |

### 2. 需要在 EA 中新增的函数

```mql4
// 绘制背离箭头
void DrawDivergenceArrow(string name, datetime time, double price, string direction, string indicator);

// 绘制谐波形态
void DrawHarmonicPattern(string pattern, XABCDPoints points);

// 绘制PRZ区域
void DrawPRZone(double top, double bottom, datetime start, datetime end);

// 清除过期对象（防止图表 clutter）
void CleanExpiredObjects();

// 在图表角落显示文字摘要
void UpdateChartComment(string summary);
```

### 3. 触发频率控制
- 同一指标在 4H 内不重复报警
- 新信号覆盖旧信号（更新而非叠加）
- 最多保留最近 20 个可视化对象

## Go 端指标计算引擎设计

### 新增文件

```
gold-bot/
├── internal/
│   ├── strategy/
│   │   ├── indicator/
│   │   │   ├── divergence.go      # MACD/RSI 背离检测
│   │   │   ├── harmonic.go       # 谐波形态检测
│   │   │   └── alert.go          # 预警结构体与上报逻辑
│   │   └── engine/
│   │       └── visual_engine.go  # 可视化信号引擎 (可选)
```

### 1. divergence.go — 背离检测

```go
package indicator

// DivergenceType 定义背离类型
type DivergenceType string

const (
    DivBullishMACD  DivergenceType = "bullish_macd"
    DivBearishMACD  DivergenceType = "bearish_macd"
    DivBullishRSI   DivergenceType = "bullish_rsi"
    DivBearishRSI   DivergenceType = "bearish_rsi"
    DivBullishOBV   DivergenceType = "bullish_obv"   // 扩展
    DivBearishOBV   DivergenceType = "bearish_obv"   // 扩展
)

// DivergenceSignal 背离信号
type DivergenceSignal struct {
    Type       DivergenceType
    Symbol     string
    Timeframe  string
    Time       time.Time
    PriceLow   float64  // 价格低点 (bullish)
    PriceHigh  float64  // 价格高点 (bearish)
    IndicatorValue float64  // 指标值
    Strength   string   // "strong" | "moderate" | "weak"
    Confidence float64  // 0.0 ~ 1.0
    BarsSince  int      // 信号发生的K线数
}

// DetectMACDDivergence 检测 MACD 背离
// 算法：比较最近N个极值点，价格创新低/高但MACD未同步
func DetectMACDDivergence(bars []Bar, lookback int) []DivergenceSignal

// DetectRSIDivergence 检测 RSI 背离 (类似)
```

### 2. harmonic.go — 谐波形态

```go
package indicator

// HarmonicPattern  Setter
type HarmonicPattern string

const (
    ButterflyBull  HarmonicPattern = "butterfly_bull"
    ButterflyBear  HarmonicPattern = "butterfly_bear"
    GartleyBull    HarmonicPattern = "gartley_bull"
    GartleyBear    HarmonicPattern = "gartley_bear"
    CrabBull       HarmonicPattern = "crab_bull"
    CrabBear       HarmonicPattern = "crab_bear"
    BatBull        HarmonicPattern = "bat_bull"
    BatBear        HarmonicPattern = "bat_bear"
)

// XABCDPoints 谐波形态的5个关键点
type XABCDPoints struct {
    X, A, B, C, D Bar // 5个关键K线
}

// HarmonicSignal 谐波信号
type HarmonicSignal struct {
    Pattern     HarmonicPattern
    Symbol      string
    Timeframe   string
    Points      XABCDPoints
    Completion  float64          // 形态完成度 0.0~1.0
    PRZTop      float64          // 潜在反转区上沿
    PRZBottom   float64          // 潜在反转区下沿
    FibRatios   map[string]float64
    Confidence  float64
    Time        time.Time
}

// DetectHarmonicPatterns 检测所有谐波形态
// 算法：滑动窗口找 X-A-B-C-D 5点结构，验证斐波那契比例
func DetectHarmonicPatterns(bars []Bar) []HarmonicSignal

// validateButterfly 验证蝴蝶形态比例
// CD ≈ 1.272~1.618 * XA, B ≈ 0.78XA retracement
func validateButterfly(points XABCDPoints) (bool, float64) // (匹配, 完成度)

// validateGartley 验证加特利形态
// AB ≈ 0.618 * XA, CD ≈ 0.786 * XA
func validateGartley(points XABCDPoints) (bool, float64)

// validateCrab 验证螃蟹形态（更多扩展)
// CD ≈ 1.618~3.618 * XA
func validateCrab(points XABCDPoints) (bool, float64)
```

### 3. alert.go — 预警上报与缓存

```go
package indicator

import "time"

// IndicatorAlert 统一预警结构
type IndicatorAlert struct {
    ID          string                 `json:"id"`
    Type        string                 `json:"type"`       // "divergence" | "harmonic"
    Indicator   string                 `json:"indicator"`  // "macd" | "rsi" | "butterfly"...
    Direction   string                 `json:"direction,omitempty"`  // "bullish" | "bearish"
    Symbol      string                 `json:"symbol"`
    Timeframe   string                 `json:"timeframe"`
    Time        time.Time              `json:"time"`
    Price       float64                `json:"price"`
    Strength    string                 `json:"strength"`   // "strong" | "moderate" | "weak"
    Confidence  float64                `json:"confidence"`
    Description string               `json:"description"`
    Metadata    map[string]interface{} `json:"metadata,omitempty"` // 扩展字段
}

// AlertCache 预警缓存（防止重复报警）
type AlertCache struct {
    alerts map[string]*AlertEntry // key: symbol+indicator+direction
    mu     sync.RWMutex
}

type AlertEntry struct {
    Alert      IndicatorAlert
    CreatedAt  time.Time
    LastSentAt time.Time
    Count      int
}

// Add 添加/更新预警（同类型4小时内不重复）
func (c *AlertCache) Add(alert IndicatorAlert) bool

// ShouldAlert 判断是否需要重新发送
func (c *AlertCache) ShouldAlert(key string) bool

// AlertPublisher 预警发布接口
type AlertPublisher interface {
    Publish(alerts []IndicatorAlert) error
}

// HTTPPublisher 通过 HTTP 推送到 EA
type HTTPPublisher struct {
    EAURL string
    Client *http.Client
}

func (p *HTTPPublisher) Publish(alerts []IndicatorAlert) error {
    // POST /indicator_alert
}
```

## 组装完整链路

### 1. gold-bot 内部处理流程

```
/bars 端点接收 OHLCV
    ↓
异步计算（goroutine）：
  - DetectMACDDivergence()
  - DetectRSIDivergence()
  - DetectHarmonicPatterns()
    ↓
结果存入 AlertCache (去重)
    ↓
新预警 → HTTPPublisher.Publish() → EA /indicator_alert 端点
    ↓
同时存入 bar_cache（带指标的信令Bar，供 analysis 端点查询）
```

### 2. EA 端接收处理

```mql4
// 在 PollAndExecute() 中新增轮询端点
void PollIndicatorAlerts()
{
    string json = StringFormat("{\"account_id\":\"%s\"}", AccountID);
    string response = HttpPost("/indicator_alert/poll", json);
    
    if (StringLen(response) == 0) return;
    
    // 解析 alerts 数组
    // 对每个 alert 调用 Draw 函数
    for (int i = 0; i < alertCount; i++) {
        if (alert.type == "divergence") {
            DrawDivergenceArrow(...);
        } else if (alert.type == "harmonic") {
            DrawHarmonicPattern(...);
        }
    }
    
    // 更新图表角落文字
    UpdateChartComment(summary);
}
```

### 3. 图表显示效果示例

```
价格图表:
                                        /\\
                                       /  \\  [Bullish Butterfly 95%]
                                      /    \\     ← 青色三角形
          [Bearish MACD Div]         /      \\____
                ↓                     /       ^    \\
               ↓↓                   /        |     \\
              ↓↓↓                  /    PRZ区 |      \\
                                /     [===] |       \\
                               /             \\______
                              /                    \\
                               
红色下箭头: Bearish MACD Divergence (Strong)
绿色上箭头: Bullish RSI Divergence (Moderate)  
青色三角形: Butterfly Bull 95% completion
黄色方框: PRZ (Potential Reversal Zone)

图表左下角文字:
──────────────────────────
GoldBolt Technical View
MACD: Bearish Div @2035.20 [Strong]
RSI:  Bullish Div @2028.50 [Moderate]
Harm: Butterfly Bull 95% [2028.50-2032.00]
──────────────────────────
```

## 新增端点

### POST /indicator_alert/poll EA 轮询
**Request:**
```json
{"account_id": "account_A"}
```

**Response:**
```json
{
  "count": 2,
  "alerts": [
    {
      "type": "divergence",
      "indicator": "macd",
      "direction": "bearish",
      "symbol": "XAUUSD",
      "timeframe": "H1",
      "time": "2024-06-23T15:00:00Z",
      "price": 2350.20,
      "strength": "strong",
      "confidence": 0.88,
      "description": "...",
      "metadata": {"bars_since": 3}
    }
  ]
}
```

## 实施优先级

### Phase 1: 基础框架 (最快)
- [ ] 新增 `indicator/divergence.go` — MACD 背离检测
- [ ] 新增 `indicator/alert.go` — 预警缓存与上报
- [ ] 新增 `/indicator_alert/poll` 端点
- [ ] EA 端新增 `DrawDivergenceArrow()` + 轮询逻辑

### Phase 2: 谐波形态
- [ ] 新增 `indicator/harmonic.go`
- [ ] EA 端新增 `DrawHarmonicPattern()`

### Phase 3: 完善与扩展
- [ ] RSI 背离
- [ ] OBV 背离
- [ ] 图表摘要面板
- [ ] 可配置报警阈值

## 技术要点

### EA 限制考虑
1. **Object 名称冲突**: 用 `symbol_time_indicator_timestamp` 格式命名
2. **Object 数量上限**: 超过 20 个自动清理最旧的
3. **重绘效率**: 只在收到新 alert 时重绘，避免每 tick 刷新
4. **颜色区分**: Bullish=绿色/青色系, Bearish=红色/橙色系

### Go 端性能
1. **异步计算**: bars 端点返回后启动 goroutine 计算指标
2. **缓存机制**: AlertCache 防止重复计算和重复上报
3. **容错**: 指标计算失败不影响主流程

## 数据示例

### MACD 背离检测场景

```
Bars (Recent 20):
Idx   Time     High    Low     Close   MACD_Hist
───────────────────────────────────────────────
20    T-20     ...     ...     ...     -0.50
19    T-19     ...     ...     ...     -0.30
18    T-18     ...     ...     ...     -0.10
17    T-17     ...     ...     ...      0.20  ← Peak 3
16    T-16     ...     ...     ...      0.10
15    T-15     ...     ...     ...     -0.05
14    T-14     ...     ...     ...      0.15
13    T-13     ...     ...     ...      0.35  ← Peak 2
12    T-12     ...     ...     ...      0.25
11    T-11     ...     ...     ...      0.10
10    T-10     ...     ...     ...      0.40  ← Peak 1 (Highest Price)
...

分析:
- T-10: 价格新高, MACD Peak1 (正常)
- T-13: 价格较高, MACD Peak2 > Peak1 (正常)
- T-17: 价格更高, MACD Peak3 < Peak2 (背离!)

结论: Bearish MACD Divergence (价格新高但MACD未同步)
```

### 蝴蝶形态示例

```
X  ──▶  A  ──▶  B  ──▶  C  ──▶  D
       │       │       │
       │       │       AB × 0.786 或 0.886
       │       │
       │       XA × 0.618 (Gartley)
       │       XA × 0.786 (Butterfly)
       │
    趋势起始点

斐波那契比例验证 (Butterfly):
- AB/XA ≈ 0.78 或 0.886
- BC/AB ≈ 0.382
- CD/BC ≈ 1.618 ~ 2.618
- AD/XA ≈ 1.272 ~ 1.618 (Butterfly completion)

EA 可视化显示:
- 在 D 点画青色箭头
- 标出 PRZ (Potential Reversal Zone) 区域
- 显示各段斐波那契比例
```

## 最终确认

这个方案的核心是：
1. **Go 端做计算**: 复杂的背离/谐波算法在 Go 中实现，可测试、可维护
2. **EA 端做展示**: 纯可视化，用 MT4 的 Object 系统在图表上绘制
3. **HTTP 通信**: 新增 `/indicator_alert/poll` 端点，EA 轮询获取
4. **去重机制**: AlertCache 保证 4 小时内不重复报警

老板确认后我可以提供具体代码实现。