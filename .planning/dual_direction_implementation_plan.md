# Dual-Direction Order Support — Implementation Plan

## 目标
让 gold-analysis-agent 能够输出双向下单信号（同时持有 BUY 和 SELL），gold-bot 能够接收并执行。

## 范围
1. **gold-analysis-agent** (Node.js/TypeScript) — 修改 system prompt 和 compose 逻辑
2. **gold-bot** (Go) — 修改 domain model 和 handlers

## Phase 1: gold-analysis-agent

### 1.1 types/agent.ts — 扩展类型定义

```typescript
// 新增: 双向下单支持
export interface DualTradePlan {
  buy?: TradePlan;
  sell?: TradePlan;
  is_dual_direction: boolean;
}

// 修改 AISignalResult，支持 dual trade_plan
export interface AISignalResult {
  // ... existing fields ...
  trade_plan?: TradePlan;
  dual_trade_plan?: DualTradePlan;  // 新增
}
```

### 1.2 agents/comprehensive-analyst.ts — 修改 system prompt

在 system prompt 中增加 dual-direction 触发条件：
- 当 `technical.phase == "ranging"` 或 `"consolidation"`
- 当 `arbitration.action == "open"`
- 当两个方向的 confidence 都 ≥ 60
- 无 critical blocking

### 1.3 graph/compose.ts — 修改 compose 逻辑

```typescript
// 修改 buildTradePlan 函数，支持 dual direction
function buildDualTradePlan(state, confidence): DualTradePlan {
  // 1. 判断是否应该生成 dual direction
  if (shouldGenerateDualDirection(state)) {
    return {
      is_dual_direction: true,
      buy: buildSingleTradePlan(state, 'buy', confidence),
      sell: buildSingleTradePlan(state, 'sell', confidence),
    };
  }
  
  // 2. 单一方向
  const plan = buildTradePlan(state, confidence);
  return {
    is_dual_direction: false,
    [plan.side]: plan,
  };
}
```

### 1.4 graph/compose.ts — 修改 modeFromState

当处于 dual direction 时，`mode = 'approve'`，`side = 'both'`（或扩展 side 类型）。

## Phase 2: gold-bot

### 2.1 internal/domain/trade_plan.go

新增 `DualTradePlan` 结构体。

### 2.2 internal/api/handlers_ai.go

修改 `HandleAIResult`：
1. 解析 `dual_trade_plan` 字段
2. 遍历 BUY 和 SELL plan
3. 对每个 plan 调用 `shouldQueueAIPending`
4. 分别创建 pending order

### 2.3 风控调整

- `hasOpenPositionOnSide`：BUY 持仓不影响 SELL 方向的信号
- `FindPendingAI`：按 side 查找独立 pending order
- 新增 `validateDualDirection` 检查

## Phase 3: gold-bot 使用 Codex 执行

根据 AGENTS.md，gold-bot 的 Go 源码修改必须通过 Codex CLI 执行。

## 实施顺序

由于改动较大，分以下步骤：
1. 先修改 gold-analysis-agent（非 Go 代码，可直接修改）
2. 再修改 gold-bot（需要 Codex CLI）
3. 构建部署
