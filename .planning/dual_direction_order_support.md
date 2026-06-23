# Dual-Direction Order Support (双向下单方案)

## 状态: GSD — 需求分析 & 方案设计

## 1. 背景与痛点

### 1.1 PENDING 订单未正常创建 — 根因分析

经过代码审查和日志分析，发现 gold-analysis-agent 最近 48 小时**从未发送过 `mode=approve` 的信号**。日志中所有信号均为：

| 品种 | bias | action | mode 实际值 | 原因 |
|------|------|--------|------------|------|
| XAUUSD | bearish | modify | modify | LLM 判断为 modify 而非 open |
| XAGUSD | bearish | modify | modify | LLM 判断为 modify 而非 open |
| GBPJPY | neutral | hold | observe | LLM 判断为 hold |

**根本原因链路：**

```
gold-analysis-agent (Node.js)
  ├── comprehensiveAnalyst.run()  ──→ LLM 返回 arbitration.action
  │                                    (system prompt 中定义 action ∈ {open, close, modify, hold})
  │
  └── compose.ts::modeFromState()
       ├── action === 'open'   → mode = 'approve'
       ├── action === 'hold'   → mode = 'observe'
       └── action === 'modify' → mode = 'modify'

gold-bot (Go)
  └── handlers_ai.go::shouldQueueAIPending()
       ├── plan.Mode != "approve" → return false  ← 拦截点
       └── (其余条件未执行)
```

**为什么 LLM 不返回 `action=open`？**

LLM 的 system prompt 中定义了 `arbitration.action` 的取值：`open`, `close`, `modify`, `hold`。其中 `open` 的语义是"开新仓"，但 LLM 在以下场景会选择 `modify` 或 `hold`：

1. **已有持仓时**：LLM 看到 account positions 数据，倾向于给出 `modify`（调整止盈止损）而非 `open`（开新仓）
2. **趋势不明确时**：多时间框架信号矛盾，LLM 给出 `hold`
3. **震荡市场**：LLM 认为风险过高，给出 `hold`

### 1.2 现有技术架构的单向性

**gold-analysis-agent (AI 层):**
- `arbitration.action` ∈ {`open`, `close`, `modify`, `hold`} — 单选
- `arbitration.final_direction` ∈ {`buy`, `sell`, `hold`, `close`} — 单选
- 一个 signal 只能有一个 side (buy/sell/none)

**gold-bot (执行层):**
- `TradePlan.Side` ∈ {`buy`, `sell`, `none`} — 单选
- `TradePlan.Mode` ∈ {`approve`, `observe`, `veto`, `modify`, `reduce`, `close`} — 单选
- `shouldQueueAIPending()` 检查单一 side 和 mode
- `hasOpenPositionOnSide()` 检查单一 side
- `FindPendingAI()` 按 side 查找唯一 pending order

**问题：现有架构无法同时持有 BUY 和 SELL 两个方向的 PENDING 订单。**

## 2. 双向下单需求

### 2.1 定义

**双向下单**：在同一时间、同一品种上，同时持有/挂出 BUY 和 SELL 两个方向的订单。

**典型场景：**
- **突破策略**：在关键价位上下方同时挂单，等待突破方向确认
- **对冲保护**：已有 BUY 持仓时，在更高/更低价位挂 SELL 止损单
- **震荡区间**：在支撑/阻力边界同时挂双向突破单
- **新闻事件**：重大数据发布前同时挂 BUY STOP / SELL STOP

### 2.2 与现有系统的兼容性

| 组件 | 当前行为 | 修改需求 |
|------|---------|---------|
| gold-analysis-agent | 单 signal，单 side | 支持 dual signal 输出 |
| compose.ts::modeFromState | action → mode 单选 | 支持 dual mode |
| compose.ts::buildTradePlan | 单 TradePlan | 支持 dual TradePlan |
| gold-bot::handlers_ai.go | 单 side check | 支持 dual side |
| gold-bot::shouldQueueAIPending | side 互斥 | side 共存 |
| gold-bot::hasOpenPositionOnSide | 同向拦截 | 支持反向共存 |
| gold-bot::FindPendingAI | 按 side 查唯一 | 按 side 查各自 |
| EA (MT4) | 单 signal | 支持 dual pending |

## 3. 技术分析：现有信号生成与仲裁逻辑

### 3.1 gold-analysis-agent 信号生成流程

```
fetchData() ──→ dispatchAnalysis() ──→ comprehensiveAnalysis()
     │
     ├── technicalAnalysis ──→ {bias, confidence, support_levels, resistance_levels, recommendation}
     ├── waveAnalysis ───────→ {wave_confirmation, target_levels}
     ├── chanlunAnalysis ────→ {trend, latest_signal, hub_state}
     ├── riskAssessment ──────→ {riskLevel, suggestedSL, suggestedTP, maxPositionSize}
     └── arbitration ────────→ {final_direction,/CC action, confidence, reasoning}

composeFinalSignal() ──→ modeFromState() ──→ buildTradePlan()
```

### 3.2 arbitration 节点详解

**arbitration 的职责：** 综合 technical/wave/chanlun/risk 的结果，给出最终交易方向。

**当前 arbitration 输出结构：**
- `final_direction`: "buy" | "sell" | "hold" | "close"
- `action`: "open" | "close" | "modify" | "hold"
- `confidence`: 0-100
- `reasoning`: 文本解释

**当前仲裁逻辑（LLM system prompt 中定义的决策规则）：**
- 当 technical.bias == wave.wave_confirmation 且 confidence > 70 → open
- 当 risk.riskLevel == "high" → hold
- 当已有持仓 → modify（调整止盈止损）

### 3.3 为何 LLM 不给出 `action=open`

查看 system prompt 中的 `arbitration` 定义：

```typescript
"arbitration": {
  "final_direction": "buy" | "sell" | "hold" | "close",
  "action": "open" | "close" | "modify" | "hold",
  // ...
  "trade_recommendation": {
    "direction": "buy" | "sell" | "hold",
    // ...
  }
}
```

LLM 在以下情况会选择 `action=modify`：
1. **检测到已有持仓**: system prompt 中提供了 `payload.positions` 数据
2. **检测到 pending signal**: `pendingSignal` 参数提示已有挂单
3. **风险评级高**: `risk.riskLevel = "high"` 或 `"extreme"`
4. **多时间框架矛盾**: technical, wave, chanlun 的 bias 不一致

### 3.4 现有订单管理逻辑

**gold-bot 的 AI approve 处理流程：**

```go
// handlers_ai.go
func shouldQueueAIPending(plan *TradePlan, gate riskgate.Result) bool {
    // 1. 必须是 approve086 approve 模式
    if plan.Mode != "approve" { return false }
    
    // 2. 必须是有效方向
    if plan.Side != "buy" && plan.Side != "sell" { return false }
    
    // 3. 风控通过
    if gate.Status == riskgate.StatusRejected { return false }
    if gate.AuditOnly { return false }
    
    // 4. 置信度阈值
    if plan.Confidence < 60 { return false }
    
    // 5. 同向持仓检查
    //    (如果有同向持仓，需要 LLM 明确推荐加仓)
    if hasOpenPositionOnSide(state.Positions, symbol, tradePlan.Side, "ai_signal") {
        if !tradePlan.AddOn { return false }
        // ... 加仓距离检查
    }
    
    // 6. 重复挂单检查
    if hasExistingPendingOrder(...) { return false }
    
    // 7. 冷却期检查
    if approveCooldown.active(symbol, now, 30*time.Minute) { return false }
    
    // 8. 价格偏离检查
    if dist > atr*3.0 { return false }
    
    return true
}
```

### 3.5 现有持仓检查逻辑

```go
// handlers_ai.go (line 687+)
func hasOpenPositionOnSide(positions []Position, symbol, side, skipStrategy string) bool {
    // 遍历 positions，检查是否存在 symbol 匹配且 side 匹配（忽略 skipStrategy）
    // BUY 持仓会拦截 BUY 方向的信号
    // SELL 持仓不会拦截 BUY 方向的信号
}
```

**当前行为：** BUY 和 SELL 是独立的，互不影响。

## 4. 双向下单方案设计

### 4.1 核心思路

**不修改现有单 signal 架构，而是在 gold-analysis-agent 中支持同时生成两个方向的 signal，gold-bot 独立处理每个方向的 signal。**

```
gold-analysis-agent
  └── comprehensiveAnalyst.run() 
       └── 对每个方向独立运行分析：
            ├── analyzeDirection(symbol, "buy")
            │    └── 返回 {signal: buySignal, tradePlan: buyPlan}
            └── analyzeDirection(symbol, "sell")
                 └── 返回 {signal: sellSignal, tradePlan: sellPlan}

  └── compose.ts
       └── 如果两个方向都有有效 signal，生成 dual-direction payload：
            finalSignals = {buy: buySignal, sell: sellSignal}

gold-bot
  └── handlers_ai.go::HandleAIResult()
       └── 遍历 finalSignals 中的每个方向：
            for side, signal := range finalSignals {
                if shouldQueueAIPending(signal.TradePlan, riskGate) {
                    createPendingOrder(signal)
                }
            }
```

### 4.2 方案 A：Minimal Change (推荐)

**修改范围：gold-analysis-agent** — 调整 LLM prompt，使其可以在 `action=open` 时同时输出两个方向的 trade_plan。

**具体改动：**

#### 4.2.1 gold-analysis-agent: compose.ts

```typescript
// 新增：DualDirectionTradePlan
interface DualDirectionTradePlan {
  buy?: TradePlan;
  sell?: TradePlan;
  // 如果两个方向都有，说明是双向下单
  isDualDirection: boolean;
}

// 修改 buildTradePlan，支持同时构建两个方向的 plan
function buildDualTradePlan(state: AnalysisGraphStateType, confidence: number): DualDirectionTradePlan {
  // 当 arbitration.action === 'open' 时
  // 检查是否两个方向都有有效的技术分析结果
  const buySignal = checkDirectionValidity(state, 'buy');
  const sellSignal = checkDirectionValidity(state, 'sell');
  
  // 只有当两个方向的 confidence 都超过阈值，且 market condition 允许时，
  // 才生成 dual-direction plan
  if (buySignal.isValid && sellSignal.isValid && state.arbitration.action === 'open') {
    return {
      buy: buildTradePlanForDirection(state, 'buy', buySignal.confidence),
      sell: buildTradePlanForDirection(state, 'sell', sellSignal.confidence),
      isDualDirection: true,
    };
  }
  
  // 否则返回单一方向的 plan
  return {
    [state.arbitration.final_direction]: buildSingleTradePlan(state, confidence),
    isDualDirection: false,
  };
}
```

#### 4.2.2 gold-analysis-agent: system prompt 调整

在 system prompt 中增加 dual-direction 说明：

```
## DUAL-DIRECTION TRADING (双向下单)

当市场处于震荡区间或重大事件前，允许同时推荐 BUY 和 SELL 两个方向的挂单。

条件：
1. technical.phase === "ranging" 或 "consolidation"
2. wave.wave_confirmation === "rejected"（波浪结构不清晰）
3. chanlun.hub_state === "forming"（中枢未成型）
4. 两个方向的 confidence 都 ≥ 60

此时 arbitration.action = "open" 且同时包含两个方向的 trade_recommendation。

输出格式：
{
  "arbitration": {
    "action": "open",
    "final_direction": "dual",  // 新增值
    "dual_recommendations": {
      "buy": { "entry_price": ..., "stop_loss": ..., "take_profit_1": ..., "confidence": ... },
      "sell": { "entry_price": ..., "stop_loss": ..., "take_profit_1": ..., "confidence": ... }
    }
  }
}
```

#### 4.2.3 gold-bot: handlers_ai.go

```go
// 修改 HandleAIResult，支持接收 dual-direction payload
func (h *aiHandler) HandleAIResult(w http.ResponseWriter, r *http.Request) {
    // ... existing code ...
    
    // 检查是否为 dual-direction signal
    if tradePlan.IsDualDirection {
        // 分别处理 BUY 和 SELL
        for _, sidePlan := range tradePlan.DualPlans {
            if shouldQueueAIPending(sidePlan, riskGateResult) {
                createPendingOrder(sidePlan)
            }
        }
    } else {
        // 单一方向，保持原有逻辑
        if shouldQueueAIPending(tradePlan, riskGateResult) {
            createPendingOrder(tradePlan)
        }
    }
}
```

### 4.3 方案 B：Architecture Refactor (更通用)

**修改范围：两个项目** — 在 domain model 层面支持多 signal。

#### 4.3.1 domain model 变更

```go
// internal/domain/trade_plan.go

// TradePlan 保持不变，但增加关联

type SignalGroup struct {
    DecisionID    string       // 共享的决策 ID
    Symbol        string
    AccountID     string
    Signals       []TradePlan  // 同一个决策下的多个方向
    IsDualDirection bool
    CreatedAt     time.Time
}

// SignalGroup 包含 1-2 个 TradePlan
// 如果是 dual direction，则包含两个方向的 plan
```

#### 4.3.2 gold-analysis-agent: 支持 multi-signal output

```typescript
// types/agent.ts
interface AISignalResult {
    // ... existing fields ...
    signalGroup?: SignalGroup;  // 替代单一的 trade_plan
}

interface SignalGroup {
    decision_id: string;
    symbol: string;
    account_id: string;
    signals: TradePlan[];  // 1-2 个 plan
    is_dual_direction: boolean;
}
```

### 4.4 方案对比

| 维度 | 方案 A (Minimal) | 方案 B (Refactor) |
|------|-----------------|-------------------|
| 修改范围 | gold-analysis-agent 为主 | gold-analysis-agent + gold-bot |
| 代码量 | ~200 行 | ~500+ 行 |
| 风险 | 低 | 中 |
| 测试复杂度 | 低 | 中 |
| 可扩展性 | 低 | 高 |
| 向后兼容 | 完全兼容 | 需要 API 版本控制 |
| 推荐度 | **首选** | 长期考虑 |

## 5. 风控考虑

### 5.1 dual-direction 的固有风险

1. **双边亏损**: 如果市场突破一个方向后迅速反转，可能两边都亏损
2. **保证金占用**: 双向持仓占用双倍保证金
3. **滑点风险**: 快速市场中，两个方向的 entry 都可能被触发

### 5.2 缓解措施

**在 gold-bot 侧增加 dual-direction 风控：**

```go
// 新增：dual-direction 风控检查
func validateDualDirection(buyPlan, sellPlan *TradePlan, state AccountState) error {
    // 1. 检查两个 plan 的 entry zone 是否有重叠
    if rangesOverlap(buyPlan.EntryZone, sellPlan.EntryZone) {
        return errors.New("dual-direction entry zones overlap")
    }
    
    // 2. 检查两个方向的止损是否设置合理（不互相突破）
    if buyPlan.StopLoss >= sellPlan.StopLoss {
        return errors.New("dual-direction SL configuration invalid")
    }
    
    // 3. 检查总仓位是否超过账户限制
    totalLots := buyPlan.MaxLots + sellPlan.MaxLots
    if totalLots > state.MaxLots {
        return fmt.Errorf("dual-direction total lots %.2f exceeds limit %.2f", totalLots, state.MaxLots)
    }
    
    // 4. 检查是否为高波动事件期间
    if state.IsHighVolatilityEvent {
        return errors.New("dual-direction not allowed during high volatility events")
    }
    
    return nil
}
```

## 6. 实施计划

### Phase 1: gold-analysis-agent 调整 LLM prompt (1-2 天)

1. **修改 `comprehensive-analyst.ts`**:
   - 在 system prompt 中增加 dual-direction 逻辑说明
   - 调整 `arbitration.action` 的决策规则

2. **修改 `compose.ts`**:
   - 调整 `modeFromState` 支持 `final_direction = "dual"`
   - 调整 `buildTradePlan` 返回 `DualDirectionTradePlan`

3. **测试**:
   - 验证 LLM 在震荡市场会输出 dual-direction
   - 验证单项信号不受影响

### Phase 2: gold-bot 接收 dual-direction payload (1-2 天)

1. **修改 `handlers_ai.go`**:
   - 解析 `TradePlan.IsDualDirection`
   - 遍历 dual plans 分别处理
   - 增加 dual-direction 风控检查

2. **修改 `domain/trade_plan.go`**:
   - 增加 `DualDirectionTradePlan` struct
   - 增加 `SignalGroup` 概念

3. **测试**:
   - 单元测试：dual-direction 解析
   - 集成测试：端到端下单流程

### Phase 3: EA 端支持 (1 天)

1. **修改 MQL4 EA**:
   - 支持同时挂 BUY/SELL pending order
   - 当一个方向成交后，自动取消另一个方向的挂单

2. **测试**:
   - 模拟 dual-direction 挂单
   - 验证成交后自动取消

### Phase 4: 监控与复盘 (持续)

1. **监控指标**:
   - dual-direction 信号占比
   - 双向挂单的成功率
   - 平均持仓时间
   - 风险收益比

2. **定期复盘**:
   - 每周 review dual-direction 的交易效果
   - 根据数据调整 LLM prompt 中的 dual-direction 触发条件

## 7. 立即行动项

### 7.1 修复 PENDING 订单不创建 (短期)

在 dual-direction 实现前，先修复单向下单的问题：

**选项 1：降低 LLM `action=open` 的触发门槛**
- 在 system prompt 中明确：当 confidence > 60 且没有 critical blocking 时，优先 `action=open` 而不是 `modify`

**选项 2：修改 gold-bot 的 `shouldQueueAIPending`，使其也接受 `mode=modify`**
- 当 `mode=modify` 且包含有效 entry/SL/TP 时，也创建 PENDING 订单
- 修改 `calcAILots` 的 bug（总是返回 0.01）

**选项 3：在 gold-analysis-agent 中增加 `force_open` 模式**
- 当检测到已连续 N 次未给出 `open` 信号时，强制触发一次 `open`
- 添加 `last_approve_time` 追踪

### 7.2 修复 `calcAILots` Bug

```go
// 当前代码 (buggy)
func calcAILots(maxLots float64) float64 {
    if maxLots <= 0 { return 0 }
    half := maxLots * 0.5
    lots := math.Ceil(half/0.01) * 0.01
    if lots < 0.01 { return 0 }
    if lots > 0.01 { return 0.01 }  // ← BUG: 硬编码返回 0.01
    return lots
}

// 修复后
func calcAILots(maxLots float64) float64 {
    if maxLots <= 0 { return 0 }
    half := maxLots * 0.5
    lots := math.Ceil(half/0.01) * 0.01
    if lots < 0.01 { return 0 }
    if lots > 0.05 { lots = 0.05 }  // 上限为 0.05，但不超过输入的 half
    return lots
}
```

## 8. 附录

### 8.1 关键文件

| 文件 | 作用 |
|------|------|
| `gold-analysis-agent/src/agents/comprehensive-analyst.ts` | LLM 调用，system prompt 定义 |
| `gold-analysis-agent/src/graph/compose.ts` | mode/side 转换，TradePlan 构建 |
| `gold-analysis-agent/src/graph/workflow-nodes.service.ts` | 工作流节点编排 |
| `gold-bot/internal/api/handlers_ai.go` | AI signal 接收与处理 |
| `gold-bot/internal/domain/trade_plan.go` | TradePlan domain model |
| `gold-bot/internal/strategy/riskgate/gate.go` | 风控 gate 逻辑 |

### 8.2 决策矩阵

| 条件 | 单向 BUY | 单向 SELL | 双向 |
|------|---------|----------|------|
| technical.bias | bullish | bearish | neutral/ranging |
| arbitration.action | open | open | open |
| wave.wave_confirmation | confirmed | confirmed | rejected |
| chanlun.latest_signal | buy | sell | hold |
| risk.riskLevel | low/medium | low/medium | low/medium |
| 已有持仓 | 无/不同向 | 无/不同向 | 无/任何 |

---

**文档版本**: v1.0  
**创建日期**: 2026-06-23  
**作者**: 太傅 (AI Assistant)  
**状态**: GSD 完成，等待老板确认后进入实施阶段
