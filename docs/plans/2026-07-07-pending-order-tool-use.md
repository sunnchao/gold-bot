# Pending Order (挂单) 链路修复 — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Each task is TDD-shaped: failing test → minimal implementation → commit.

**Goal:** 让老板 "等待回调至 4145 入场" 类型的 LLM 建议，能自动产生 EA 端可识别的 `BUY_LIMIT` / `SELL_LIMIT` 挂单命令，而不是被忽略成 `mode: observe`。

**Architecture:** 在 `comprehensive-analyst.run()` 末尾增加**第二阶段 tool_use 调用**（Anthropic Messages API 原生 tool_use 协议），让 LLM 拿到完整分析结果后，从三组预定义工具 (`place_pending_order` / `place_market_order` / `do_nothing`) 中**强制选一个**调用。`TradeAction` 通过 tool_use input 直接解析，下游 `compose.ts` 已有完整支持链路。

**Tech Stack:** TypeScript · Anthropic Messages API (tool_use) · Vitest · NestJS

---

## 根因 (Phase 1-3 调查结论)

```
[mao-arbitrator LLM] ──markdown──> [comprehensive-analyst 解析 markdown]
                                            ↓
                                    result.arbitration.trade_recommendation
                                            ↓
                            [ComprehensiveAnalysisResult.tradeAction]
                                            ↑ ← 永远是 undefined
                                            │
                              整个 run() 从未生成 tradeAction
```

**架构层**：
- `types/trade-action.ts` ✓ 完整定义 `PendingOrderAction / MarketOrderAction / DoNothingAction`
- `compose.ts:136-182` ✓ `buildTradePlanFromTradeAction()` 已实现 `BUY_LIMIT`/`SELL_LIMIT` 构建
- `apps/app-server/src/services/ai-approve/gate.ts` ✓ `evaluateAIApprovePendingGate` 测过 limit 路径
- `apps/app-server/src/services/ai-approve/command.ts:38` ✓ 非 market 单自动加 4h expiration
- `apps/app-agent/src/graph/compose.ts:436` ✓ 优先用 `buildTradePlanFromTradeAction` 路径

**唯一缺口**：`comprehensive-analyst.run()` 没接 Anthropic `tool_use` 协议 → `result.tradeAction` 永远是 `undefined` → 走 `buildTradePlan()` 老路径（用市价 bid/ask）→ 即使 LLM 写 "等待回调 4145" 也只会被丢弃。

**测试已存在**（说明此路径早已设计好，只差生产端连接）：
- `apps/app-agent/src/graph/compose.spec.ts:29-69` — 测试 `place_pending_order` tradeAction → 期望 trade_plan 含 `order.BUY_LIMIT` / `order.SELL_LIMIT`

---

## Constraints & Style

- **DRY**: tool schema 在一处定义 (`apps/app-agent/src/types/trade-action.ts`)，所有调用点引用同一份。
- **YAGNI**: 不实现多轮对话（tool_use 调用是一次性的，LLM 出 markdown + 一次 tool call）。
- **TDD**: 每个子任务先写失败测试，再写实现。
- **Frequent commits**: 每个 Task 1 commit。
- **不破坏现有 markdown 路径**: 如果 tool_use 调用失败（网络/解析），回退到原 markdown `trade_recommendation` 路径。
- **AGENTS.md 约束**: Hermes 不能直接改 .ts，必须通过 Codex CLI 执行。

---

## Task 1: 在 `trade-action.ts` 暴露 Anthropic tool schema 常量

**Objective:** 让 LLM 知道有哪些工具可用，schema 与 TypeScript 类型保持单一来源。

**Files:**
- Modify: `apps/app-agent/src/types/trade-action.ts` (add `TRADE_ACTION_TOOL_SCHEMAS` export)

**Step 1: Add tool schema export**

```typescript
// append to apps/app-agent/src/types/trade-action.ts

/**
 * Anthropic Messages API tool schema for the second-phase tool_use call.
 * Three tools: place_pending_order / place_market_order / do_nothing.
 * LLM is FORCED to call exactly one (tool_choice: any).
 */
export const TRADE_ACTION_TOOLS = [
  {
    name: 'place_pending_order',
    description:
      'Place a pending order (BUY_LIMIT or SELL_LIMIT) that triggers when price reaches a target level. ' +
      'Use this when the LLM suggests a precise entry price DIFFERENT from the current market price ' +
      '(e.g., "等待回调至 4145 入场" — wait for pullback to 4145). ' +
      'Required when entry_price != current market price. ' +
      'The order auto-expires in 4 hours if not triggered.',
    input_schema: {
      type: 'object',
      required: ['side', 'entry_price', 'stop_loss', 'take_profit_1', 'lots', 'order_type', 'reason'],
      properties: {
        side: { type: 'string', enum: ['buy', 'sell'] },
        entry_price: { type: 'number', description: 'Pending order trigger price (must differ from current price)' },
        stop_loss: { type: 'number' },
        take_profit_1: { type: 'number' },
        take_profit_2: { type: 'number' },
        lots: { type: 'number', minimum: 0.01, maximum: 0.5 },
        order_type: { type: 'string', enum: ['limit', 'stop'], description: 'limit=回调入场, stop=突破入场' },
        expiry_hours: { type: 'number', default: 4 },
        reason: { type: 'string', description: 'Bilingual explanation (Chinese first, English in parens)' },
      },
    },
  },
  {
    name: 'place_market_order',
    description:
      'Place a market order at the current bid/ask. Use only when the LLM wants to open IMMEDIATELY ' +
      'at the current price (no entry target).',
    input_schema: {
      type: 'object',
      required: ['side', 'stop_loss', 'take_profit_1', 'lots', 'reason'],
      properties: {
        side: { type: 'string', enum: ['buy', 'sell'] },
        stop_loss: { type: 'number' },
        take_profit_1: { type: 'number' },
        take_profit_2: { type: 'number' },
        lots: { type: 'number', minimum: 0.01, maximum: 0.5 },
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'do_nothing',
    description:
      'No trade action. Use when the LLM recommends hold / wait for confirmation / no edge. ' +
      'MUST provide a `reasoning` string.',
    input_schema: {
      type: 'object',
      required: ['reasoning'],
      properties: { reasoning: { type: 'string' } },
    },
  },
] as const;
```

**Step 2: Verify build**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent typecheck
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add apps/app-agent/src/types/trade-action.ts
git commit -m "feat(agent): expose Anthropic tool schema for TradeAction"
```

---

## Task 2: 扩展 `LlmClientService` 支持 tool_use 协议

**Objective:** `streamLayered()` / `invokeLayered()` 接受可选 `tools` 参数；`AnthropicStreamResult` 增加 `toolUse` 字段；SSE 解析器识别 `content_block_start` (tool_use) 和 `content_block_delta` (input_json_delta)。

**Files:**
- Modify: `apps/app-agent/src/tools/llm-client.ts`
  - Extend `SystemBlock` / `UserLayer` interface (no — tools are separate, accept as new param)
  - Extend `AnthropicStreamResult` with `toolUse?: { id: string; name: string; input: Record<string, unknown> }`
  - Extend `streamLayered()` signature: `streamLayered(systemBlocks, userLayers, opts?: { tools?, toolChoice? })`
  - Extend `invokeLayered()` similarly
  - Patch `buildLayeredRequestBody()` to include `tools` and `tool_choice`
  - Patch `processAnthropicSseEvent()` to capture `content_block_start` (tool_use) and `input_json_delta`
  - Patch `readAnthropicStream()` to return `toolUse` field

**Step 1: Write failing test** — `apps/app-agent/src/tools/llm-client.test.ts`

```typescript
it('parses tool_use from Anthropic stream', async () => {
  // Mock fetch to return SSE with content_block_start type=tool_use + input_json_delta
  mockFetchSse([
    'event: message_start\ndata: {"message":{"usage":{"input_tokens":100,"cache_read_input_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"place_pending_order"}}\n\n',
    'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"side\\":\\"buy\\",\\"entry_price\\":4145"}}\n\n',
    'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":",\\"stop_loss\\":4125}"}}\n\n',
    'event: content_block_stop\ndata: {"index":0}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]);

  const client = new LLMClient({ ...defaultConfig });
  const result = await client.streamLayered(
    [{ text: 'sys', cacheable: true }],
    [{ text: 'user', cacheable: true }],
    { tools: [/* tool schema */], toolChoice: { type: 'any' } }
  );

  expect(result.toolUse).toEqual({
    id: 'toolu_01',
    name: 'place_pending_order',
    input: { side: 'buy', entry_price: 4145, stop_loss: 4125 },
  });
});
```

**Step 2: Run test, verify FAIL**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test -- llm-client.test.ts -t "parses tool_use"
```
Expected: FAIL — `result.toolUse` is undefined.

**Step 3: Implement** — patch `llm-client.ts`

```typescript
// Add to AnthropicStreamResult (line 101):
interface AnthropicStreamResult {
  content: string;
  chunks: number;
  cacheStats: CacheStats;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
}

// New opts interface:
export interface InvokeOpts {
  tools?: ReadonlyArray<{ name: string; description: string; input_schema: unknown }>;
  toolChoice?: { type: 'auto' | 'any' | 'tool'; name?: string } | undefined;
}

// Update buildLayeredRequestBody signature:
private buildLayeredRequestBody(
  systemBlocks: SystemBlock[],
  userLayers: UserLayer[],
  stream: boolean,
  opts?: InvokeOpts,
): Record<string, unknown> {
  // ...existing code...
  if (opts?.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? { type: 'auto' };
  }
  return body;
}

// Update streamLayered / invokeLayered to accept opts and forward.
// Update readAnthropicStream to accumulate tool_use content blocks:
//   on content_block_start with type=tool_use → push pending block
//   on input_json_delta → append partial JSON
//   on content_block_stop with pending block → finalize into result.toolUse

// In processAnthropicSseEvent, add:
if (eventName === 'content_block_start') {
  const block = data.content_block as Record<string, unknown> | undefined;
  if (block?.type === 'tool_use') {
    pendingToolUse = { id: String(block.id), name: String(block.name), inputJson: '' };
  }
}
if (eventName === 'content_block_delta' && pendingToolUse) {
  const delta = data.delta as Record<string, unknown> | undefined;
  if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
    pendingToolUse.inputJson += delta.partial_json;
  }
}
if (eventName === 'content_block_stop' && pendingToolUse) {
  try {
    result.toolUse = { id: pendingToolUse.id, name: pendingToolUse.name, input: JSON.parse(pendingToolUse.inputJson) };
  } catch (err) {
    logger.warn({ err, rawJson: pendingToolUse.inputJson }, 'tool_use input parse failed');
  }
  pendingToolUse = null;
}
```

**Step 4: Run test, verify PASS**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test -- llm-client.test.ts
```
Expected: PASS — all tool_use tests green, no regressions.

**Step 5: Commit**

```bash
git add apps/app-agent/src/tools/llm-client.ts apps/app-agent/src/tools/llm-client.test.ts
git commit -m "feat(llm-client): support Anthropic tool_use streaming + non-streaming"
```

---

## Task 3: 在 `comprehensive-analyst.run()` 末尾增加 tool_use 二次调用

**Objective:** 第一阶段 markdown 解析完成后，再调用一次 LLM（带 `TRADE_ACTION_TOOLS` 强制 tool_choice），从响应解析 `toolUse`，转换成 `TradeAction`，挂到 `result.tradeAction`。

**Files:**
- Modify: `apps/app-agent/src/agents/comprehensive-analyst.ts`
  - Add `decideTradeAction(arbitration, payload, profile)` private method
  - Call it before `return result;` (line 1192)
  - Map tool name → `TradeAction`

**Step 1: Write failing test** — `apps/app-agent/src/agents/comprehensive-analyst.test.ts`

```typescript
it('populates tradeAction from tool_use second-phase call', async () => {
  // Mock LLM client first call returns markdown, second call returns tool_use
  const mockClient = createMockLlmClient({
    firstInvoke: '<markdown>## TRADE RECOMMENDATION ... ## ARBITRATION ...</markdown>',
    secondInvoke: { content: '', toolUse: { name: 'place_pending_order', id: 't1', input: {
      side: 'buy', entry_price: 4145, stop_loss: 4125,
      take_profit_1: 4188, take_profit_2: 4205, lots: 0.05,
      order_type: 'limit', reason: '等待回调至 4145 入场'
    }}}
  });
  const analyst = new ComprehensiveAnalystService(mockClient);
  const result = await analyst.run(testPayload, 'XAUUSD');

  expect(result.tradeAction).toEqual({
    type: 'place_pending_order',
    side: 'buy',
    entry_price: 4145,
    stop_loss: 4125,
    take_profit_1: 4188,
    take_profit_2: 4205,
    lots: 0.05,
    order_type: 'limit',
    expiry_hours: 4,
    reason: '等待回调至 4145 入场',
  });
});

it('falls back to do_nothing when tool_use call fails', async () => {
  // Mock first call succeeds, second call throws
  const mockClient = createMockLlmClient({
    firstInvoke: '<markdown>...</markdown>',
    secondInvokeError: new Error('timeout'),
  });
  const analyst = new ComprehensiveAnalystService(mockClient);
  const result = await analyst.run(testPayload, 'XAUUSD');

  // No crash; tradeAction may be undefined (compose falls back to buildTradePlan)
  expect(result.tradeAction).toBeUndefined();
});
```

**Step 2: Run tests, verify FAIL**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test -- comprehensive-analyst.test.ts
```
Expected: FAIL — `result.tradeAction` is undefined.

**Step 3: Implement** — patch `comprehensive-analyst.ts` around line 1190

```typescript
// Add inside ComprehensiveAnalystService class, before run()'s return:

private async decideTradeAction(
  arbitration: ArbitrationResult,
  payload: GoldbotPayload,
  profile: SymbolProfile,
): Promise<TradeAction | undefined> {
  const logger = getLogger();
  const currentPrice = payload.market.bid || payload.market.ask || 0;
  const trade = arbitration.trade_recommendation;
  if (!trade) return undefined;

  // Skip tool call for pure holds (no actionable recommendation)
  if (trade.direction === 'hold' && arbitration.action === 'hold') {
    return { type: 'do_nothing', reasoning: 'arbitration: hold' };
  }

  // Build a compact summary of the analysis for the LLM to act on
  const summary = [
    `## ARBITRATION DECISION (from first phase)`,
    `- Final Direction: ${arbitration.final_direction}`,
    `- Action: ${arbitration.action}`,
    `- Confidence: ${arbitration.confidence}`,
    `- Current Price: ${currentPrice.toFixed(profile.pricePrecision)}`,
    ``,
    `## TRADE RECOMMENDATION (from first phase markdown)`,
    `- Direction: ${trade.direction}`,
    `- Entry Price: ${trade.entry_price}`,
    `- Stop Loss: ${trade.stop_loss}`,
    `- Take Profit 1: ${trade.take_profit_1}`,
    `- Take Profit 2: ${trade.take_profit_2 ?? 'N/A'}`,
    `- Risk/Reward: ${trade.risk_reward_ratio}`,
    `- Position Size: ${trade.position_size_lots}`,
    `- Rationale: ${trade.rationale}`,
  ].join('\n');

  try {
    const result = await this.client.streamLayered(
      [
        { text: TRADE_ACTION_DECISION_PROMPT, cacheable: true },
        { text: `Instrument: ${profile.name} (${profile.symbol})\nCurrent price: ${currentPrice.toFixed(profile.pricePrecision)}`, cacheable: true },
      ],
      [{ text: summary, cacheable: false }],
      {
        tools: TRADE_ACTION_TOOLS as any,
        toolChoice: { type: 'any' }, // FORCE the LLM to call exactly one tool
      },
    );

    if (!result.toolUse) {
      logger.warn({ symbol: profile.symbol }, 'trade_action_decision: no tool_use returned');
      return undefined;
    }

    return toolUseToTradeAction(result.toolUse, currentPrice, profile);
  } catch (err) {
    logger.warn(
      { symbol: profile.symbol, err: err instanceof Error ? err.message : String(err) },
      'trade_action_decision: tool_use call failed, falling back to markdown path',
    );
    return undefined;
  }
}

const TRADE_ACTION_DECISION_PROMPT = `You are the final trade execution decision agent.

Given the arbitration decision and trade recommendation from the first phase, you MUST call exactly ONE tool:

1. place_pending_order — when the recommended entry_price DIFFERS from the current market price
   (e.g., recommendation says "wait for pullback to 4145" and current price is 4174).
   The pending order will trigger when price reaches 4145.

2. place_market_order — when the recommendation says to open IMMEDIATELY at the current price
   (e.g., "买入现价" / "market buy now").

3. do_nothing — when confidence is too low (<50), direction is hold, or no clear edge.

CRITICAL RULES:
- If entry_price in the recommendation differs from current price by > 0.5%, USE place_pending_order
- Lots must be between 0.01 and 0.5 (typically 0.03-0.10 for XAUUSD intraday)
- expiry_hours defaults to 4 (intraday), set higher only if explicitly warranted
- reason MUST be bilingual (Chinese first, English in parentheses)
- For pending orders, verify entry_price is on the correct side of current:
  * buy limit: entry < current (waiting for dip)
  * sell limit: entry > current (waiting for rally)
  If wrong, call do_nothing instead.`;
```

And the converter:

```typescript
// New file: apps/app-agent/src/agents/trade-action-converter.ts
import type { TradeAction, PendingOrderAction, MarketOrderAction } from '../types/trade-action.js';
import type { SymbolProfile } from '../config/symbol-profile.js';

export function toolUseToTradeAction(
  toolUse: { name: string; input: Record<string, unknown> },
  currentPrice: number,
  profile: SymbolProfile,
): TradeAction | undefined {
  if (toolUse.name === 'do_nothing') {
    return {
      type: 'do_nothing',
      reasoning: String(toolUse.input.reasoning ?? ''),
    };
  }

  if (toolUse.name === 'place_market_order') {
    const side = String(toolUse.input.side);
    if (side !== 'buy' && side !== 'sell') return undefined;
    return {
      type: 'place_market_order',
      side,
      stop_loss: Number(toolUse.input.stop_loss),
      take_profit_1: Number(toolUse.input.take_profit_1),
      take_profit_2: toolUse.input.take_profit_2 != null ? Number(toolUse.input.take_profit_2) : undefined,
      lots: Number(toolUse.input.lots),
      reason: String(toolUse.input.reason ?? ''),
    } satisfies MarketOrderAction;
  }

  if (toolUse.name === 'place_pending_order') {
    const side = String(toolUse.input.side);
    if (side !== 'buy' && side !== 'sell') return undefined;
    const orderType = String(toolUse.input.order_type) === 'stop' ? 'stop' : 'limit';
    const entryPrice = Number(toolUse.input.entry_price);

    // Defensive check: limit on wrong side of current price → reject
    if (orderType === 'limit' && currentPrice > 0) {
      if (side === 'buy' && entryPrice >= currentPrice) {
        return { type: 'do_nothing', reasoning: `BUY_LIMIT entry ${entryPrice} >= current ${currentPrice}, should be market` };
      }
      if (side === 'sell' && entryPrice <= currentPrice) {
        return { type: 'do_nothing', reasoning: `SELL_LIMIT entry ${entryPrice} <= current ${currentPrice}, should be market` };
      }
    }

    return {
      type: 'place_pending_order',
      side,
      entry_price: entryPrice,
      stop_loss: Number(toolUse.input.stop_loss),
      take_profit_1: Number(toolUse.input.take_profit_1),
      take_profit_2: toolUse.input.take_profit_2 != null ? Number(toolUse.input.take_profit_2) : undefined,
      lots: Number(toolUse.input.lots),
      order_type: orderType,
      expiry_hours: toolUse.input.expiry_hours != null ? Number(toolUse.input.expiry_hours) : 4,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies PendingOrderAction;
  }

  return undefined;
}
```

**Step 4: Wire into run()** — modify line 1192 in `comprehensive-analyst.ts`:

```typescript
// Add right before `return result;` (around line 1192)
if (result.arbitration) {
  const tradeAction = await this.decideTradeAction(result.arbitration, payload, profile);
  if (tradeAction) {
    result.tradeAction = tradeAction;
    logger.info(
      { symbol, type: tradeAction.type, side: 'side' in tradeAction ? tradeAction.side : undefined },
      'tradeAction decided',
    );
  }
}
return result;
```

**Step 5: Run tests, verify PASS**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test -- comprehensive-analyst.test.ts
```
Expected: PASS.

**Step 6: Run full agent test suite to confirm no regressions**

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test
```
Expected: all green, 0 regressions.

**Step 7: Commit**

```bash
git add apps/app-agent/src/agents/comprehensive-analyst.ts \
        apps/app-agent/src/agents/comprehensive-analyst.test.ts \
        apps/app-agent/src/agents/trade-action-converter.ts
git commit -m "feat(agent): second-phase tool_use call decides TradeAction (pending/market/nothing)"
```

---

## Task 4: 端到端集成测试（TradeAction → TradePlan → EA 命令）

**Objective:** 验证老板 "等待回调至 4145" 场景能端到端产生 `BUY_LIMIT` 命令。

**Files:**
- Modify: `apps/app-agent/src/graph/compose.spec.ts` (add new test, NOT touching existing ones)

**Step 1: Write test**

```typescript
it('end-to-end: buy limit at 4145 produces BUY_LIMIT trade plan with entry zone = 4145', () => {
  const state = stateWithTradeAction({
    type: 'place_pending_order',
    side: 'buy',
    entry_price: 4145,
    stop_loss: 4125,
    take_profit_1: 4188,
    take_profit_2: 4205,
    lots: 0.05,
    order_type: 'limit',
    expiry_hours: 4,
    reason: '等待回调至 4145 (Fib 0.382) 入场',
  });
  state.arbitration = { ...state.arbitration!, final_direction: 'buy', action: 'open', confidence: 75 };
  // bid = 4174 (current price above entry)
  state.payload = { market: { bid: 4174, ask: 4174.5, symbol: 'XAUUSD' }, /* ... */ };

  const plan = buildTradePlanFromTradeAction(state, state.tradeAction!);

  expect(plan).toMatchObject({
    mode: 'approve',
    side: 'buy',
    execution_type: 'limit',
    requested_order_type: 'BUY_LIMIT',
    entry_zone: { min: 4145, max: 4145 },
    stop_loss: 4125,
    take_profit: [4188, 4205],
    max_lots: 0.05,
  });
  expect(new Date(plan!.expires_at).getTime() - Date.now()).toBeGreaterThan(4 * 3600 * 1000 - 1000);
});
```

**Step 2: Run, verify PASS** (this path already works per existing `compose.spec.ts` tests; this is regression insurance)

```bash
cd /root/gold-bot && pnpm --filter @gold-bot/app-agent test -- compose.spec.ts
```
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/app-agent/src/graph/compose.spec.ts
git commit -m "test(agent): end-to-end test for BUY_LIMIT trade plan generation"
```

---

## Task 5: 添加 Prometheus 指标 + 日志追踪

**Objective:** 监控 tool_use 调用成功率 / fall-through 率。

**Files:**
- Modify: `apps/app-agent/src/agents/comprehensive-analyst.ts` (wrap tool_use call in try/catch with metrics)
- Modify: `apps/app-server/src/services/ai-approve/gate.ts` (add metric for BUY_LIMIT/SELL_LIMIT accept rate)

**Step 1: Add counter metric**

In `comprehensive-analyst.ts` decideTradeAction:

```typescript
// after successful tool_use parse:
metrics.increment('agent.trade_action.decided', { type: tradeAction.type, side: side ?? 'n/a' });
// on fallback (tool call failed):
metrics.increment('agent.trade_action.fallback', { reason: err.message });
```

**Step 2: Commit**

```bash
git add apps/app-agent/src/agents/comprehensive-analyst.ts apps/app-server/src/services/ai-approve/gate.ts
git commit -m "feat(observability): metrics for TradeAction decision and pending gate accept rate"
```

---

## Task 6: 构建 + Docker 部署 + 真机验证

**Objective:** 部署到生产 gold-bot 容器并验证老板的 4145 挂单场景端到端工作。

**Files:** (no source changes)

**Step 1: Type check + lint**

```bash
cd /root/gold-bot && pnpm typecheck && pnpm lint
```
Expected: 0 errors.

**Step 2: Build all packages**

```bash
cd /root/gold-bot && pnpm build
```
Expected: all green.

**Step 3: Run all tests**

```bash
cd /root/gold-bot && pnpm test
```
Expected: all green.

**Step 4: Rebuild agent Docker image**

```bash
cd /root/gold-bot && docker compose build app-agent
```

**Step 5: Force-recreate agent container (CRITICAL — restart alone does NOT pick up new image)**

```bash
cd /root/gold-bot && docker compose up -d --force-recreate app-agent
```

**Step 6: Health check**

```bash
sleep 10 && docker logs gold-bot-agent --tail 50 | grep -E "tradeAction decided|tool_use"
```
Expected: see "tradeAction decided" log lines.

**Step 7: Trigger manual analysis run** (or wait for next cron tick)

```bash
curl -X POST http://localhost:3100/agents/run-now
```

**Step 8: Verify in DB**

```bash
psql $GB_EA_STORE_POSTGRES_DSN -c "SELECT decision_id, mode, requested_order_type, entry_zone, stop_loss FROM trade_plans ORDER BY created_at DESC LIMIT 5;"
```
Expected: latest row has `requested_order_type = 'BUY_LIMIT'`, `entry_zone = {"min":4145,"max":4145}`.

**Step 9: Commit (no source changes, just version bump if needed)**

```bash
# If version bumped:
git add version.json
git commit -m "chore: bump version to v2.10.0 (pending order tool_use support)"
```

---

## DANGER ZONES (Pitfalls)

1. **DO NOT modify `compose.ts:436` precedence** — the order `tradeAction path → buildTradePlan path` is correct. If you swap, will break existing market-order flow.

2. **DO NOT remove `buildTradePlan()`** — it's the fallback for when tool_use fails. Keep it as graceful degradation.

3. **DO NOT set `tool_choice: 'any'` for unrelated calls** — this change is scoped to the second-phase `decideTradeAction`. Don't pollute other LLM calls with tool_choice.

4. **Tool input validation** — `toolUseToTradeAction` must defensively check `Number.isFinite()` on every numeric field. LLM may return `null` or `NaN`. Bad numbers → return `do_nothing` with reason.

5. **Lot size cap** — schema has `max: 0.5` but AI may try 1.0. Server-side `ai-approve/rules.ts:calcAIApproveLots` should clamp; double-check no regression.

6. **Cross-instrument price check** — if LLM hallucinates entry=4145 for XAGUSD (currently $36), the dynamic price check in `run()` (lines 1103-1165) will reject. Good. Make sure decideTradeAction runs AFTER that validation, not before.

7. **Docker force-recreate** — `docker compose restart` does NOT pick up new image. ALWAYS use `up -d --force-recreate` after build.

8. **AGENTS.md constraint** — `apps/app-agent/src/agents/*.ts` is TS, not Go. AGENTS.md "AI cannot modify Go" rule is outdated; the TS code IS what we modify here. But the recommendation to "use Codex CLI" is still good — write a CODEX_TASK.md and dispatch.

9. **TradeAction schema_version** — current `TradePlan.schema_version = 'trade_plan.v1'`. If the schema ever needs to change, bump and add migration. Don't add new fields without version bump.

10. **`buildTradePlanFromTradeAction` returns undefined if `action.order_type === 'stop'`** (compose.ts:142-144). This intentionally disables BUY_STOP / SELL_STOP. Don't add stop support without user approval.

---

## Success Criteria

- [ ] Type check passes: `pnpm typecheck` → 0 errors
- [ ] All tests pass: `pnpm test` → all green
- [ ] End-to-end test in compose.spec.ts passes for "BUY_LIMIT at 4145"
- [ ] Docker image rebuilt and force-recreated
- [ ] Health check shows `tradeAction decided` log lines
- [ ] DB shows new row with `requested_order_type = 'BUY_LIMIT'`, `entry_zone = {"min":4145,"max":4145}`
- [ ] EA receives the BUY_LIMIT command and places the pending order at 4145
- [ ] Manual verification: when current price drops to 4145, the pending order auto-triggers

---

## Rollback Plan

If anything goes wrong post-deploy:

```bash
# Roll back to last green commit
cd /root/gold-bot && git log --oneline -5
git revert HEAD~3..HEAD  # revert the 3 new commits
docker compose build app-agent && docker compose up -d --force-recreate app-agent
```

The `buildTradePlan()` fallback path is the original behavior — the system degrades to "no tradeAction" mode if tool_use fails. So worst case: system behaves exactly like before (老板的建议被忽略，但不崩溃)。

---

## Estimated Implementation Effort

- Tasks 1-3: 4-6 hours (核心改动)
- Tasks 4-5: 1-2 hours (测试 + 可观测)
- Task 6: 1 hour (部署 + 验证)
- Total: **1 working day** for experienced TS developer

After implementation, dispatch to Codex CLI via:

```bash
cat /root/gold-bot/docs/plans/2026-07-07-pending-order-fix.md
# Read the CODEX_TASK.md that wraps this
cat /root/gold-bot/CODEX_TASK_PENDING.md | codex exec --yolo
```
