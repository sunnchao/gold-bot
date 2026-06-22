# GSD: 多周期趋势聚合器

**File:** `.planning/multi_timeframe_trend_aggregator.md`
**Type:** GSD (Goal-Scenario-Design)
**Model:** DeepSeek V4 Pro (wochirou 网关)
**Reviewed:** 2026-06-22

---

## 1. Goal（目标）

在 gold-bot 策略引擎中引入显式的**多周期趋势聚合层**，为所有策略提供统一的趋势上下文（trend context），替代当前的碎片化硬过滤。

### 核心价值

- **从二值硬过滤（通过/不通过）→ 连续权重调节**，减少过过滤/欠过滤
- **让趋势信息对所有策略可见**，不只在 pullback+FIB 中有效
- **响应之前的讨论**：道氏主要趋势对日内交易置信度应降低，但不应忽略

### 非目标

- ❌ 不改变 EA 端逻辑
- ❌ 不取消现有的 H4 BLOCK 机制（保留作为极端行情安全网）
- ❌ 不引入新数据源（只用现有的 Bars + 已计算的指标）

---

## 2. Scenario（场景分析）

### 2.1 现有趋势判断现状

| 位置 | 周期 | 逻辑 | 输出 | 问题 |
|------|------|------|------|------|
| `Analyze()` L447-449 | H1 | EMA20 > EMA50 | 仅日志 | 只用来看，不参与决策 |
| `Analyze()` L394-445 | H4 | ADX + 连续EMA确认 | BUY/SELL/BLOCK(硬过滤) | 二值决策，震荡时一刀切 |
| `checkPullback()` L810-821 | H4 | EMA20 > EMA50 | 硬通过/硬跳过 | 单 bar 判断，不稳定 |
| `detectLastSwing()` | 依窗口 | 极值高/低 | UP/DOWN | 仅用于 Fib 扩展位 |

### 2.2 核心矛盾

**道氏问题具体化：**

系统目前同时使用两层趋势过滤：
1. **H4 BLOCK** — 震荡市直接屏蔽大部分策略
2. **H4 方向过滤** — 只允许同向信号

这两层都用了**道氏主要趋势（H4 ≈ 6小时~数天）**的等价物来做日内决策。但 gold-bot 的持仓周期是分钟到小时，主要趋势的权重过高了。

**真实场景举例：**

```
黄金 1H 图：EMA20>EMA50（多头），M15 出 pullback 做多信号
但 H4：EMA20≈EMA50（震荡），ADX=22 < 25
→ 当前行为：H4 BLOCK，所有策略被过滤，仅保留 momentum_scalp
→ 可能错失：一个高胜率的 M15 回调做多机会
```

**另一个方向也有问题：**

```
H4 强多头，但价格刚刚在 M15 上破位
pullback 做多信号仍然通过
→ 可能被套在 H4 趋势尾声的加速段
```

### 2.3 置信度衰减规律

根据道氏理论的实践经验和黄金的特性：

| 周期 | 对日内信号的预测力 | 衰减因子 | 使用方式 |
|------|------------------|---------|---------|
|| D1 (1天) | 极弱 | 0.02~0.05 | 压舱背景，几乎不参与决策 |
| H4 (4小时) | 中等 | 0.20~0.30 | 辅助参考，不作为主决策依据 |
| H1 (1小时) | 较强 | 0.30~0.40 | 中周期趋势上下文 |
| M30 (30分钟) | 较强 | 0.35~0.45 | 中短周期确认，连接 H1 与 M15 |
| M15 (15分钟) | 强 | 0.50~0.60 | 即时确认 |
| M5/M1 | 噪音 | — | 仅用于动量剥头皮 |

关键发现：**H1 对日内信号的预测力强于 H4**，但现有系统只用 H4 做趋势过滤，H1 趋势只看不参与决策。

---

## 3. Design（设计方案）

### 3.1 TrendContext 结构体

```go
// TrendContext holds multi-timeframe trend information
// Weighted confidence from 0.0 (no signal) to 1.0 (strong trend)
type TrendContext struct {
    // Per-timeframe directions
    D1Direction string  // "BULL"/"BEAR"/"NEUTRAL"
    H4Direction string
    H1Direction string
    M30Direction string
    M15Direction string

    // Confidence weights (how much to trust each timeframe)
    D1Weight    float64  // 0.05
    H4Weight    float64  // 0.25
    H1Weight    float64  // 0.35
    M30Weight   float64  // 0.35

    // Aggregated consensus
    ConsensusDirection string  // "BULL"/"BEAR"/"NEUTRAL"
    ConsensusStrength  float64 // 0.0~1.0, combined confidence

    // Per-trend strength
    H4ADX      float64
    H1ADX      float64
}
```

### 3.2 方向判定规则（复现）

| 条件 | D1/H4/H1/M30 Direction |
|------|-------------------|
| EMA20 > EMA50 + Close > EMA20 | "BULL" |
| EMA20 < EMA50 + Close < EMA20 | "BEAR" |
| 其他 | "NEUTRAL" |

M15：只用 RSI 边界判断（RSI > 55 → BULL, RSI < 45 → BEAR）
M30：与 H1 同规则（EMA+Close 判断），作为连接 H1 宏观与 M15 微观的桥梁

### 3.3 聚合算法

```
consensusStrength = 
    D1Weight * confidence(D1Direction, D1ADX) +
    H4Weight * confidence(H4Direction, H4ADX) +
    H1Weight * confidence(H1Direction, H1ADX) +
    M30Weight * confidence(M30Direction, M30ADX)
```

其中 `confidence(dir, adx)`：
- dir == NEUTRAL → 0
- dir != NEUTRAL && adx < 20 → 0.3 (弱趋势)
- dir != NEUTRAL && adx 20~30 → 0.6 (中等)
- dir != NEUTRAL && adx > 30 → 0.9 (强趋势)

**最终方向** = 各周期方向按 weight 加权投票，得票最多的方向胜出。

### 3.4 TrendGate 规则（替代部分 H4 BLOCK）

引入 **三层柔性门控**，替代当前的二值 H4 BLOCK：

| 层级 | 触发条件 | 效果 |
|------|---------|------|
| **Soft** | ConsensusStrength < 0.3 | 信号评分降 1 分（不是屏蔽） |
| **Medium** | ConsensusStrength < 0.3 + H4Direction == 信号反方向 | 评分降 2 分，仓位偏好降低 30% |
| **Hard** | 保留现有 H4 BLOCK 逻辑（ADX < threshold + 无方向） | 仅在极端震荡时触发，保留 momentum_scalp |

与现有 H4 BLOCK 的关系：
- **Hard 层 = 现有 BLOCK 逻辑**，保持不变
- Soft/Medium 是**新增**的柔性调节层，在 BLOCK **未触发**时生效

### 3.5 接口签名

```go
// BuildTrendContext builds a multi-timeframe trend consensus
func BuildTrendContext(d1, h4, h1, m30, m15 []domain.Bar) TrendContext

// ApplyTrendRating adjusts signal score and logs based on trend context
func ApplyTrendRating(signal *domain.Signal, tc TrendContext) TrendRating
```

### 3.6 Analyze() 集成点

在 `Analyze()` 中，H4 BLOCK 之前插入趋势聚合：

```go
// Step 1: Build trend context (after H4 ADX check, before BLOCK)
tc := BuildTrendContext(d1, h4, h1, m30, m15)

// Step 2: Log trend context
log.Printf("[STRATEGY] 📊 趋势聚合 | D1=%s H4=%s(ADX=%.1f) H1=%s(ADX=%.1f) M30=%s(ADX=%.1f) 共识=%s(强度=%.2f)",
    tc.D1Direction, tc.H4Direction, tc.H4ADX, tc.H1Direction, tc.H1ADX, tc.M30Direction, tc.M30ADX,
    tc.ConsensusDirection, tc.ConsensusStrength)

// Step 3: Apply trend rating to each signal (after existing H4 BLOCK)
for i := range signals {
    _, rating = ApplyTrendRating(&signals[i], tc)
    signals[i].Score -= rating.Penalty  // reduce score
    if rating.LotMultiplier < 1.0 {
        signals[i].LotMultiplier = rating.LotMultiplier  // reduce lot size
    }
}
```

### 3.7 日志输出增强

每个信号增加：
```
[STRATEGY] 🌀 pullback | 评分=7 趋势降级=-1 → 6 | Lot乘数=0.7
```

### 3.8 配置参数（新增到 StrategyConfig）

```go
type TrendConfig struct {
    // Direction threshold weights
    D1Weight    float64 `json:"d1_weight" yaml:"d1_weight"`       // default 0.05
    H4Weight    float64 `json:"h4_weight" yaml:"h4_weight"`       // default 0.30
    H1Weight    float64 `json:"h1_weight" yaml:"h1_weight"`       // default 0.65
    
    // Confidence thresholds
    SoftThreshold   float64 `json:"soft_threshold" yaml:"soft_threshold"`     // 0.30
    MediumThreshold float64 `json:"medium_threshold" yaml:"medium_threshold"` // 0.15
    
    // ADX thresholds for confidence
    WeakADXThreshold   float64 `json:"weak_adx_threshold" yaml:"weak_adx_threshold"`     // 20
    StrongADXThreshold float64 `json:"strong_adx_threshold" yaml:"strong_adx_threshold"` // 30
    
    // Per-symbol overrides
    Enabled bool `json:"enabled" yaml:"enabled"` // default true
}
```

---

## 4. 与道氏理论的对照

| 道氏概念 | GSD 映射 | 实现方式 |
|---------|---------|---------|
| 主要趋势 (1年+) | D1 direction (weight 5%) | 极低频、极低权，仅供日志参考 |
| 次级趋势 (3周~数月) | H4 direction (weight 30%) | 辅助参考，不作为主决策依据 |
| 小趋势 (数天~3周) | H1 direction (weight 65%) | 日内决策主参考，核心周期 |
| 三大假设① (市场包容一切) | 只用价格/指标，不引入外部数据 | ✅ |
| 三大假设② (趋势惯性) | ADX 加权，趋势越强置信度越高 | ✅ |
| 三大假设③ (历史重演) | 策略本身依赖形态统计有效性 | ✅ |

---

## 5. 实现计划

### Phase 4A: TrendContext 聚合层 (核心)

| Task | 文件 | 估算 |
|------|------|------|
| `TrendConfig` 结构体 + M30Weight | `config.go` | +20行 |
| `DefaultTrendConfig()` | `config.go` | +10行 |
| `TrendContext` 结构体 (含 M30) | 新 `trend_context.go` | +45行 |
| `BuildTrendContext()` (含 M30) | 新 `trend_context.go` | +75行 |
| `ApplyTrendRating()` | 新 `trend_context.go` | +50行 |
| `Analyze()` 集成 (含 D1/M30 参数) | `engine.go` | +25行 |
| `AnalysisPayload` 注入 TrendContext 字段 | `compat.go` | +15行 |
| `MarketFilter` ATRE 改用 M30 | `filter.go` | +5行 |
| 单元测试 | `trend_context_test.go` | +120行 |
| **合计** | | **~365行** |

### Phase 4B: AI 链路集成

| Task | 文件 | 估算 |
|------|------|------|
| `compat.go`: AnalysisPayload 新增 `trend_context` 字段 | `compat.go` | +10行 |
| `handlers_ai.go`: AI approve 前读取 TrendContext 做柔性调节 | `handlers_ai.go` | +30行 |
| `handlers_ai_test.go`: 趋势反向下单验证 | `handlers_ai_test.go` | +30行 |
| **AI 链路合计** | | **~70行** |

### Phase 4C: 集成调试

| Task | 说明 |
|------|------|
| 验证 H4 BLOCK 行为不变 | BLOCK 触发时 TrendContext 不额外干预 |
| 验证信号评分降级正确 | Soft/Medium 降评分但不完全阻拦 |
| 验证 AI approve 趋势调节 | 逆势提高置信度阈值 / 震荡手数减半 |
| 验证 LLM payload 包含 trend_context | BuildAnalysisPayload 输出新字段 |
| `go test ./internal/... -count=1` | 全部通过 |

---

## 6. 风险与注意事项

| 风险 | 缓解 |
|------|------|
| Weight 参数欠优化导致过过滤 | 默认取保守值 (H4=0.4, H1=0.5)，可配置 |
| LotMultiplier 传播链路未验证 | 先只降 Score，LotMultiplier 留 Phase 4B |
| H4 BLOCK + TrendContext 双重过滤 | TrendContext 只在 BLOCK 未触发时生效，不叠加 |
| 1000 bar 数据下性能 | 纯数学运算，无 IO，无问题 |

---

## 7. AI 链路变更设计

### 7.1 AnalysisPayload 新增字段

```go
type AnalysisPayload struct {
    // ... existing fields ...
    TrendContext *TrendContextPayload `json:"trend_context,omitempty"`
}

type TrendContextPayload struct {
    D1Direction       string  `json:"d1_direction"`        // "BULL"/"BEAR"/"NEUTRAL"
    H4Direction       string  `json:"h4_direction"`
    H1Direction       string  `json:"h1_direction"`
    M30Direction      string  `json:"m30_direction"`
    ConsensusDirection string  `json:"consensus_direction"`
    ConsensusStrength  float64 `json:"consensus_strength"`  // 0.0~1.0
}
```

### 7.2 AI Approve 趋势调节规则

在 `handleAIResult()` 中 AI approve 挂单前，基于 TrendContext 做三级调节：

| 趋势条件 | 调节动作 |
|---------|---------|
| ConsensusDirection == signal 方向 | 无操作（最优情况，正常执行） |
| ConsensusDirection != signal 方向 | 置信度阈值从 60% 提高到 75% |
| ConsensusStrength < 0.3（震荡） | 手数再减半（lots = lots/2） |
| D1/H4 逆信号 + H1/M30 同信号 | 正常执行（中短周期主导） |
| D1/H4/H1/M30 全逆信号 | 拒绝挂单（极少触发，硬保护） |

### 7.3 AI Approve 代码骨架

```go
// In handleAIResult(), before AI pending order generation:

tc := BuildTrendContext(state.Bars["D1"], state.Bars["H4"], state.Bars["H1"], state.Bars["M30"], state.Bars["M15"])

if tradePlan.Side == "BUY" && tc.ConsensusDirection == "BEAR" {
    if tradePlan.Confidence < 75 {
        log.Printf("[AI] ⏭️ AI approve 跳过: 共识为空头但信号为买入 confidence=%d < 75", tradePlan.Confidence)
        goto afterAIPending
    }
    log.Printf("[AI] ⚠️ AI approve 逆势: 共识=%s 信号=%s confidence=%d 通过提高阈值", 
        tc.ConsensusDirection, tradePlan.Side, tradePlan.Confidence)
}

if tc.ConsensusStrength < 0.3 {
    lots = lots / 2
    log.Printf("[AI] 📉 AI approve 震荡减半: 共识强度=%.2f 手数=%.2f", tc.ConsensusStrength, lots)
}
```

---

*GSD written: 2026-06-22 | Model: DeepSeek V4 Pro | Review status: Pending*