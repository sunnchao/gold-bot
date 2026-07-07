# AI Order Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI approve orders use explicit market or limit intent, and prevent AI approve from ever emitting `BUY_STOP` or `SELL_STOP` commands.

**Architecture:** `apps/app-agent` adds explicit order intent fields to generated `trade_plan` records. `apps/app-server` validates that intent in the AI approve gate and passes the accepted order type into the command builder. The existing EA-compatible `SIGNAL` command path remains unchanged, with `strategy` fixed as `ai_signal`.

**Tech Stack:** TypeScript, Vitest, NestJS app-agent code, Node app-server services, `@gold-bot/persistence` command candidates.

---

## Scope Check

This plan spans two tightly coupled Node subsystems:

- `apps/app-agent`: expresses order intent.
- `apps/app-server`: validates and converts order intent.

They are kept in one plan because neither subsystem delivers the requirement alone. Each task still has its own tests and commit boundary.

Do not edit Go source files or MQL4 EA files. Existing dirty CI and Docker files are unrelated and must remain untouched.

## File Structure

- Modify: `apps/app-agent/src/types/agent.ts`
  - Adds optional `execution_type` and `requested_order_type` fields to `TradePlan`.
- Modify: `apps/app-agent/src/types/schemas.ts`
  - Lets app-agent schema validation accept the same optional fields.
- Modify: `apps/app-agent/src/graph/compose.ts`
  - Maps `TradeAction` into explicit order intent and suppresses pending stop actions.
- Create: `apps/app-agent/src/graph/compose.spec.ts`
  - Tests agent-side trade plan intent generation through `composeFinalSignal()`.
- Modify: `apps/app-server/src/services/ai-approve/rules.ts`
  - Adds reusable order-intent and SL/TP direction validation helpers.
- Create: `apps/app-server/src/services/ai-approve/rules.spec.ts`
  - Tests market, buy limit, sell limit, stop rejection, mismatched limit direction, and protection direction.
- Modify: `apps/app-server/src/services/ai-approve/gate.ts`
  - Calls the new rules and returns accepted `orderType`.
- Modify: `apps/app-server/src/services/ai-approve/gate.spec.ts`
  - Verifies gate-level rejection reasons and accepted order type.
- Modify: `apps/app-server/src/services/ai-approve/command.ts`
  - Stops deriving order type from price distance and emits only the order type accepted by the gate.
- Modify: `apps/app-server/src/services/ai-approve/command.spec.ts`
  - Updates command-builder expectations for market, `BUY_LIMIT`, and `SELL_LIMIT`.
- Modify: `apps/app-server/src/app.ts`
  - Passes `pendingGate.orderType` into the command builder.
- Modify: `apps/app-server/src/app.spec.ts`
  - Adds route coverage proving disabled stop intent does not queue a command in cutover mode.

---

### Task 1: Express Order Intent In app-agent Trade Plans

**Files:**
- Modify: `apps/app-agent/src/types/agent.ts`
- Modify: `apps/app-agent/src/types/schemas.ts`
- Modify: `apps/app-agent/src/graph/compose.ts`
- Create: `apps/app-agent/src/graph/compose.spec.ts`

- [ ] **Step 1: Write the failing compose tests**

Create `apps/app-agent/src/graph/compose.spec.ts` with this full content:

```ts
import { describe, expect, it } from 'vitest';
import { composeFinalSignal } from './compose.js';
import type { AnalysisGraphStateType } from './state.js';
import type { TradeAction } from '../types/trade-action.js';

describe('composeFinalSignal AI order intent', () => {
  it('adds explicit market intent for current-price trade actions', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_market_order',
      side: 'buy',
      stop_loss: 3330,
      take_profit_1: 3345,
      lots: 0.01,
      reason: '可以当前价入场 (enter at current price)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      entry_zone: { min: 3335.5, max: 3335.7 },
      execution_type: 'market',
      requested_order_type: 'market',
      reason_codes: expect.arrayContaining(['fc.place_market_order', 'order.market'])
    });
  });

  it('maps buy limit trade actions to BUY_LIMIT intent', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      side: 'buy',
      entry_price: 3332.5,
      stop_loss: 3328,
      take_profit_1: 3344,
      lots: 0.01,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '回调到价格做多 (buy the pullback)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      entry_zone: { min: 3332.5, max: 3332.5 },
      execution_type: 'limit',
      requested_order_type: 'BUY_LIMIT',
      reason_codes: expect.arrayContaining(['fc.place_pending_order', 'order.BUY_LIMIT'])
    });
  });

  it('maps sell limit trade actions to SELL_LIMIT intent', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      side: 'sell',
      entry_price: 3338.5,
      stop_loss: 3344,
      take_profit_1: 3322,
      lots: 0.01,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '反弹到价格做空 (sell the rebound)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'sell',
      entry_zone: { min: 3338.5, max: 3338.5 },
      execution_type: 'limit',
      requested_order_type: 'SELL_LIMIT',
      reason_codes: expect.arrayContaining(['fc.place_pending_order', 'order.SELL_LIMIT'])
    });
  });

  it('does not publish executable approve plans for pending stop trade actions', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      side: 'buy',
      entry_price: 3342,
      stop_loss: 3335,
      take_profit_1: 3358,
      lots: 0.01,
      order_type: 'stop',
      expiry_hours: 4,
      reason: '突破追多 disabled by design'
    }));

    expect(signal?.trade_plan).toBeUndefined();
  });
});

function stateWithTradeAction(tradeAction: TradeAction): AnalysisGraphStateType {
  const side = tradeAction.type === 'do_nothing' ? 'hold' : tradeAction.side;
  return {
    accountId: '90011087',
    symbol: 'XAUUSD',
    timestamp: '2026-04-13T08:00:00.000Z',
    payload: {
      account: {
        account_id: '90011087',
        equity: 10000,
        balance: 10000,
        margin: 100,
        free_margin: 9900,
        currency: 'USD',
        leverage: 500
      },
      market: {
        symbol: 'XAUUSD',
        bid: 3335.5,
        ask: 3335.7,
        spread: 0.2
      },
      indicators: {},
      positions: [],
      market_status: {
        market_open: true,
        is_trade_allowed: true,
        tradeable: true
      },
      strategy_mapping: {}
    },
    arbitration: {
      final_direction: side === 'buy' ? 'buy' : side === 'sell' ? 'sell' : 'hold',
      confidence: 80,
      primary_contradiction: 'none',
      phase: 'markup',
      action: side === 'buy' || side === 'sell' ? 'open' : 'hold',
      reasoning: 'AI generated structured order intent',
      united_front_analysis: 'aligned',
      dow_theory: {
        primary_trend: side === 'sell' ? 'bearish' : 'bullish',
        primary_phase: side === 'sell' ? 'distribution' : 'markup',
        secondary_trend: side === 'sell' ? 'bearish' : 'bullish',
        short_term_trend: side === 'sell' ? 'bearish' : 'bullish',
        multi_tf_confirm: true,
        rationale: 'trend aligned'
      },
      wave_theory: {
        current_wave: '3',
        wave_direction: side === 'sell' ? 'impulse_down' : 'impulse_up',
        wave_count: 'impulse',
        next_target: 'target',
        confidence: 80,
        rationale: 'wave aligned'
      },
      chanlun_theory: {
        trend: side === 'sell' ? 'down' : 'up',
        bi_direction: side === 'sell' ? 'down' : 'up',
        duan_direction: side === 'sell' ? 'down' : 'up',
        zhongshu_state: 'none',
        buy_sell_point: side === 'sell' ? 'sell_2' : 'buy_2',
        confidence: 80,
        rationale: 'chanlun aligned'
      },
      harmonic_theory: {
        pattern: 'none',
        direction: side === 'sell' ? 'bearish' : 'bullish',
        confidence: 0,
        rationale: 'no harmonic conflict'
      }
    },
    riskAssessment: {
      riskLevel: 'medium',
      maxPositionSize: 0.01,
      suggestedSL: 3330,
      suggestedTP: 3345,
      warnings: [],
      addOn: false
    },
    tradeAction,
    logs: [],
    errors: []
  } as unknown as AnalysisGraphStateType;
}
```

- [ ] **Step 2: Run the compose test to verify it fails**

Run:

```bash
pnpm --filter app-agent test -- src/graph/compose.spec.ts
```

Expected: FAIL because `execution_type` and `requested_order_type` are not present, and pending stop actions still produce a `trade_plan`.

- [ ] **Step 3: Add order intent fields to app-agent types**

In `apps/app-agent/src/types/agent.ts`, add the `TradePlanExecutionType` and `TradePlanRequestedOrderType` exports after `TradePlanSide`, then add the fields to `TradePlan`:

```ts
export type TradePlanMode = 'observe' | 'veto' | 'approve' | 'modify' | 'reduce' | 'close';
export type TradePlanSide = 'buy' | 'sell' | 'dual' | 'none';
export type TradePlanExecutionType = 'market' | 'limit';
export type TradePlanRequestedOrderType = 'market' | 'BUY_LIMIT' | 'SELL_LIMIT';
```

The `TradePlan` interface should include these optional fields after `entry_zone`:

```ts
  entry_zone: TradePlanEntryZone;
  execution_type?: TradePlanExecutionType;
  requested_order_type?: TradePlanRequestedOrderType;
  stop_loss: number;
```

- [ ] **Step 4: Add schema support for order intent fields**

In `apps/app-agent/src/types/schemas.ts`, add these schemas near the existing trade-plan schemas:

```ts
export const TradePlanExecutionTypeSchema = z.enum(['market', 'limit']);
export const TradePlanRequestedOrderTypeSchema = z.enum(['market', 'BUY_LIMIT', 'SELL_LIMIT']);
```

Then add these optional fields to `TradePlanSchema` after `entry_zone`:

```ts
  entry_zone: TradePlanEntryZoneSchema,
  execution_type: TradePlanExecutionTypeSchema.optional(),
  requested_order_type: TradePlanRequestedOrderTypeSchema.optional(),
  stop_loss: z.number().finite().min(0),
```

- [ ] **Step 5: Update compose to map TradeAction to explicit order intent**

In `apps/app-agent/src/graph/compose.ts`, replace the full `buildTradePlanFromTradeAction` function with:

```ts
function buildTradePlanFromTradeAction(
  state: AnalysisGraphStateType,
  action: PendingOrderAction | MarketOrderAction,
): TradePlan | undefined {
  if (!state.arbitration) return undefined;
  if (action.type === 'place_pending_order' && action.order_type === 'stop') {
    return undefined;
  }

  const isMarket = action.type === 'place_market_order';
  const requestedOrderType = isMarket
    ? 'market'
    : action.side === 'buy'
      ? 'BUY_LIMIT'
      : 'SELL_LIMIT';
  const executionType = isMarket ? 'market' : 'limit';
  const bid = state.payload?.market.bid ?? 0;
  const ask = state.payload?.market.ask ?? bid;
  const entry = isMarket
    ? { min: bid, max: ask }
    : { min: (action as PendingOrderAction).entry_price, max: (action as PendingOrderAction).entry_price };
  const tp = [action.take_profit_1, ...(action.take_profit_2 ? [action.take_profit_2] : [])];
  const expiryMs = isMarket
    ? 15 * 60 * 1000
    : ((action as PendingOrderAction).expiry_hours ?? 4) * 3600 * 1000;
  const timestamp = state.timestamp ?? new Date().toISOString();

  return {
    schema_version: TRADE_PLAN_SCHEMA_VERSION,
    decision_id: decisionIdFor(state.accountId, state.symbol, timestamp, state.arbitration),
    account_id: state.accountId,
    symbol: state.symbol,
    mode: 'approve',
    side: action.side,
    confidence: state.arbitration.confidence ?? 70,
    entry_zone: entry,
    execution_type: executionType,
    requested_order_type: requestedOrderType,
    stop_loss: action.stop_loss,
    take_profit: tp,
    max_lots: action.lots,
    expires_at: new Date(Date.now() + expiryMs).toISOString(),
    reason_codes: [`fc.${action.type}`, `side.${action.side}`, `order.${requestedOrderType}`],
    conflicts: [],
    narrative: action.reason,
    add_on: state.riskAssessment?.addOn ?? false,
  };
}
```

- [ ] **Step 6: Run the app-agent compose test**

Run:

```bash
pnpm --filter app-agent test -- src/graph/compose.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Run app-agent typecheck**

Run:

```bash
pnpm --filter app-agent typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit app-agent intent changes**

Run:

```bash
git add apps/app-agent/src/types/agent.ts apps/app-agent/src/types/schemas.ts apps/app-agent/src/graph/compose.ts apps/app-agent/src/graph/compose.spec.ts
git commit -m "feat(app-agent): add explicit AI order intent"
```

Expected: commit contains only the four app-agent files.

---

### Task 2: Add app-server AI Approve Order Intent Rules

**Files:**
- Modify: `apps/app-server/src/services/ai-approve/rules.ts`
- Create: `apps/app-server/src/services/ai-approve/rules.spec.ts`

- [ ] **Step 1: Write failing rules tests**

Create `apps/app-server/src/services/ai-approve/rules.spec.ts` with this full content:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveAIApproveOrderIntent,
  validateAIApproveProtectionDirection
} from './rules.js';

describe('AI approve order intent rules', () => {
  it('accepts market intent near current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'market', requested_order_type: 'market', entry_zone: { min: 3335.5, max: 3335.7 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: true, orderType: 'market' });
  });

  it('rejects market intent when entry is not near current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'market', requested_order_type: 'market', entry_zone: { min: 3330, max: 3330 } }),
      3335.6,
      3330,
      2
    )).toEqual({ accepted: false, reason: 'market_entry_mismatch' });
  });

  it('accepts buy limit at or below current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: true, orderType: 'BUY_LIMIT' });
  });

  it('accepts sell limit at or above current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'SELL_LIMIT' }),
      3335.6,
      3338.5,
      2
    )).toEqual({ accepted: true, orderType: 'SELL_LIMIT' });
  });

  it('rejects limit orders on the wrong side of current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3338,
      2
    )).toEqual({ accepted: false, reason: 'limit_direction_mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'SELL_LIMIT' }),
      3335.6,
      3332,
      2
    )).toEqual({ accepted: false, reason: 'limit_direction_mismatch' });
  });

  it('rejects stop order intent', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ requested_order_type: 'BUY_STOP' }),
      3335.6,
      3338,
      2
    )).toEqual({ accepted: false, reason: 'stop_order.disabled' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'stop' }),
      3335.6,
      3338,
      2
    )).toEqual({ accepted: false, reason: 'stop_order.disabled' });
  });

  it('rejects missing explicit order intent', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: undefined, requested_order_type: undefined }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.missing' });
  });

  it('validates BUY and SELL protection direction', () => {
    expect(validateAIApproveProtectionDirection(
      tradePlan({ side: 'buy', stop_loss: 3330, take_profit: [3345] }),
      3335.6
    )).toEqual({ accepted: true });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ side: 'sell', stop_loss: 3340, take_profit: [3325] }),
      3335.6
    )).toEqual({ accepted: true });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ side: 'buy', stop_loss: 3336, take_profit: [3345] }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ side: 'sell', stop_loss: 3340, take_profit: [3338] }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });
  });
});

function tradePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 'trade_plan.v1',
    decision_id: 'tpv1_rules',
    account_id: '90011087',
    symbol: 'XAUUSD',
    mode: 'approve',
    side: 'buy',
    confidence: 80,
    entry_zone: { min: 3332.5, max: 3332.5 },
    execution_type: 'limit',
    requested_order_type: 'BUY_LIMIT',
    stop_loss: 3330,
    take_profit: [3345],
    max_lots: 0.1,
    expires_at: '2099-06-06T09:15:00Z',
    reason_codes: ['mode.approve', 'side.buy'],
    narrative: 'rules fixture',
    ...overrides
  };
}
```

- [ ] **Step 2: Run the rules tests to verify they fail**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/rules.spec.ts
```

Expected: FAIL because `resolveAIApproveOrderIntent` and `validateAIApproveProtectionDirection` are not exported.

- [ ] **Step 3: Add order intent rule helpers**

In `apps/app-server/src/services/ai-approve/rules.ts`, replace `orderTypeForAIApproveSignal` with these exports and helper functions. Keep the existing `pickAIApproveEntryPrice`, `calcAIApproveLots`, `firstPositiveAIApproveTakeProfit`, and `round2` exports unchanged.

```ts
export type AIApproveOrderType = 'market' | 'BUY_LIMIT' | 'SELL_LIMIT';

export type AIApproveOrderIntentResult =
  | { accepted: true; orderType: AIApproveOrderType }
  | { accepted: false; reason: string };

export type AIApproveProtectionResult =
  | { accepted: true }
  | { accepted: false; reason: string };

export function resolveAIApproveOrderIntent(
  tradePlan: EaRecord,
  currentPrice: number,
  entry: number,
  h1Atr: number
): AIApproveOrderIntentResult {
  const side = stringField(tradePlan, 'side').trim().toLowerCase();
  const executionType = stringField(tradePlan, 'execution_type').trim().toLowerCase();
  const requestedRaw = stringField(tradePlan, 'requested_order_type').trim().toUpperCase();
  const requestedOrderType = requestedRaw === 'MARKET' ? 'market' : requestedRaw;

  if (executionType === 'stop' || requestedRaw === 'BUY_STOP' || requestedRaw === 'SELL_STOP') {
    return rejectOrderIntent('stop_order.disabled');
  }

  if (executionType === 'market' || requestedOrderType === 'market') {
    const allowedDistance = h1Atr > 0 ? h1Atr * 0.3 : 0;
    if (Math.abs(currentPrice - entry) > allowedDistance) {
      return rejectOrderIntent('market_entry_mismatch');
    }
    return { accepted: true, orderType: 'market' };
  }

  if (requestedOrderType === 'BUY_LIMIT' || (executionType === 'limit' && side === 'buy')) {
    if (side !== 'buy' || entry > currentPrice) {
      return rejectOrderIntent('limit_direction_mismatch');
    }
    return { accepted: true, orderType: 'BUY_LIMIT' };
  }

  if (requestedOrderType === 'SELL_LIMIT' || (executionType === 'limit' && side === 'sell')) {
    if (side !== 'sell' || entry < currentPrice) {
      return rejectOrderIntent('limit_direction_mismatch');
    }
    return { accepted: true, orderType: 'SELL_LIMIT' };
  }

  return rejectOrderIntent('order_intent.missing');
}

export function validateAIApproveProtectionDirection(tradePlan: EaRecord, entry: number): AIApproveProtectionResult {
  const side = stringField(tradePlan, 'side').trim().toUpperCase();
  const stopLoss = numberField(tradePlan, 'stop_loss');
  const takeProfit = firstPositiveAIApproveTakeProfit(arrayNumberField(tradePlan, 'take_profit'));
  if (entry <= 0 || stopLoss <= 0 || takeProfit <= 0) {
    return rejectProtection('protection.invalid_direction');
  }
  if (side === 'BUY' && stopLoss < entry && takeProfit > entry) {
    return { accepted: true };
  }
  if (side === 'SELL' && stopLoss > entry && takeProfit < entry) {
    return { accepted: true };
  }
  return rejectProtection('protection.invalid_direction');
}

function rejectOrderIntent(reason: string): AIApproveOrderIntentResult {
  return { accepted: false, reason };
}

function rejectProtection(reason: string): AIApproveProtectionResult {
  return { accepted: false, reason };
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function arrayNumberField(record: EaRecord, field: string): number[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];
}
```

The file already has `numberField`; keep a single `numberField` definition.

- [ ] **Step 4: Run the rules tests**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/rules.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit rules changes**

Run:

```bash
git add apps/app-server/src/services/ai-approve/rules.ts apps/app-server/src/services/ai-approve/rules.spec.ts
git commit -m "feat(app-server): add AI approve order intent rules"
```

Expected: commit contains only the rules files.

---

### Task 3: Enforce Order Intent In The AI Approve Gate

**Files:**
- Modify: `apps/app-server/src/services/ai-approve/gate.ts`
- Modify: `apps/app-server/src/services/ai-approve/gate.spec.ts`

- [ ] **Step 1: Write failing gate tests**

Append these tests before the closing brace of the existing top-level `AI approve pending gate` describe block in `apps/app-server/src/services/ai-approve/gate.spec.ts`:

```ts
  it('returns accepted order type for explicit market, buy limit, and sell limit plans', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'market',
        requested_order_type: 'market',
        entry_zone: { min: 3335.5, max: 3335.7 }
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'market' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3332.5, max: 3332.5 }
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'BUY_LIMIT' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        side: 'sell',
        execution_type: 'limit',
        requested_order_type: 'SELL_LIMIT',
        entry_zone: { min: 3338.5, max: 3338.5 },
        stop_loss: 3344,
        take_profit: [3325],
        reason_codes: ['mode.approve', 'side.sell']
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'SELL_LIMIT' });
  });

  it('rejects disabled stops, mismatched market entry, mismatched limit direction, and invalid protection', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ execution_type: 'stop', requested_order_type: 'BUY_STOP' }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'stop_order.disabled' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'market',
        requested_order_type: 'market',
        entry_zone: { min: 3332, max: 3332 }
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'market_entry_mismatch' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3338, max: 3338 }
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'limit_direction_mismatch' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        stop_loss: 3338
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'protection.invalid_direction' });
  });
```

Update the existing `tradePlan()` test helper in the same file so its default return value includes explicit buy limit intent:

```ts
    execution_type: 'limit',
    requested_order_type: 'BUY_LIMIT',
```

Add those two fields after `entry_zone`.

- [ ] **Step 2: Run gate tests to verify failure**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/gate.spec.ts
```

Expected: FAIL because accepted gate results do not include `orderType`, and intent/protection rejection rules are not wired.

- [ ] **Step 3: Update gate imports and result type**

In `apps/app-server/src/services/ai-approve/gate.ts`, replace the current import from `rules.ts` with:

```ts
import {
  calcAIApproveLots,
  pickAIApproveEntryPrice,
  resolveAIApproveOrderIntent,
  validateAIApproveProtectionDirection,
  type AIApproveOrderType
} from './rules.js';
```

Then add `orderType` to the accepted `AIApprovePendingGateResult`:

```ts
      h1Atr: number;
      orderType: AIApproveOrderType;
```

- [ ] **Step 4: Enforce order intent and protection direction in the gate**

In `evaluateAIApprovePendingGate`, fetch H1 bars once before trend context and insert the order/protection checks after lots validation.

Replace this block:

```ts
  let lots = calcAIApproveLots(numberField(input.tradePlan, 'max_lots'));
  if (lots <= 0) {
    return reject('lots.too_small');
  }

  const trend = buildAIApproveTrendContext({
    D1: await input.store.getBars(input.accountId, input.symbol, 'D1'),
    H4: await input.store.getBars(input.accountId, input.symbol, 'H4'),
    H1: await input.store.getBars(input.accountId, input.symbol, 'H1'),
    M30: await input.store.getBars(input.accountId, input.symbol, 'M30'),
    M15: await input.store.getBars(input.accountId, input.symbol, 'M15')
  });
```

with:

```ts
  let lots = calcAIApproveLots(numberField(input.tradePlan, 'max_lots'));
  if (lots <= 0) {
    return reject('lots.too_small');
  }

  const h1Bars = await input.store.getBars(input.accountId, input.symbol, 'H1');
  const h1Atr = latestAtr(h1Bars);
  const orderIntent = resolveAIApproveOrderIntent(input.tradePlan, currentPrice, entry, h1Atr);
  if (!orderIntent.accepted) {
    return reject(orderIntent.reason);
  }
  const protection = validateAIApproveProtectionDirection(input.tradePlan, entry);
  if (!protection.accepted) {
    return reject(protection.reason);
  }

  const trend = buildAIApproveTrendContext({
    D1: await input.store.getBars(input.accountId, input.symbol, 'D1'),
    H4: await input.store.getBars(input.accountId, input.symbol, 'H4'),
    H1: h1Bars,
    M30: await input.store.getBars(input.accountId, input.symbol, 'M30'),
    M15: await input.store.getBars(input.accountId, input.symbol, 'M15')
  });
```

Then replace the later H1 ATR block:

```ts
  const h1Atr = latestAtr(await input.store.getBars(input.accountId, input.symbol, 'H1'));
  if (h1Atr > 0 && Math.abs(currentPrice - entry) > h1Atr * 3) {
    return reject('entry.too_far_from_market');
  }

  return {
    accepted: true,
    currentPrice,
    entry,
    lots,
    h1Atr
  };
```

with:

```ts
  if (h1Atr > 0 && Math.abs(currentPrice - entry) > h1Atr * 3) {
    return reject('entry.too_far_from_market');
  }

  return {
    accepted: true,
    currentPrice,
    entry,
    lots,
    h1Atr,
    orderType: orderIntent.orderType
  };
```

- [ ] **Step 5: Run gate tests**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/gate.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit gate changes**

Run:

```bash
git add apps/app-server/src/services/ai-approve/gate.ts apps/app-server/src/services/ai-approve/gate.spec.ts
git commit -m "feat(app-server): enforce AI approve order intent"
```

Expected: commit contains only the gate files.

---

### Task 4: Emit Only Accepted AI Approve Order Types

**Files:**
- Modify: `apps/app-server/src/services/ai-approve/command.ts`
- Modify: `apps/app-server/src/services/ai-approve/command.spec.ts`
- Modify: `apps/app-server/src/app.ts`

- [ ] **Step 1: Update command-builder tests to require explicit order type**

In `apps/app-server/src/services/ai-approve/command.spec.ts`, replace the file with:

```ts
import { describe, expect, it } from 'vitest';
import { buildAIApproveCommandCandidate } from './command.js';

describe('AI approve command builder', () => {
  it('builds market SIGNAL payloads from accepted market intent', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T16:00:00+08:00',
      currentPrice: 3335.6,
      atr: 2,
      orderType: 'market',
      riskGate: {
        decision_id: 'tpv1_market',
        mode: 'approve',
        symbol: 'XAUUSD',
        status: 'accepted'
      },
      tradePlan: {
        schema_version: 'trade_plan.v1',
        decision_id: 'tpv1_market',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'market',
        requested_order_type: 'market',
        stop_loss: 3330.456,
        take_profit: [3344.876],
        max_lots: 0.2,
        confidence: 80,
        narrative: 'current price entry'
      }
    });

    expect(command).toEqual({
      command_id: 'ai_pending_90011087_XAUUSD_1776067200000000000',
      action: 'SIGNAL',
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 3335.6,
      entry_min: 3335.5,
      entry_max: 3335.7,
      sl: 3330.46,
      tp: 3344.88,
      lots: 0.01,
      order_type: 'market',
      score: 80,
      strategy: 'ai_signal',
      source: 'ai_approve',
      confidence: 80,
      decision_id: 'tpv1_market',
      reason: 'current price entry',
      trade_plan_mode: 'approve',
      risk_gate: {
        decision_id: 'tpv1_market',
        mode: 'approve',
        symbol: 'XAUUSD',
        status: 'accepted'
      }
    });
  });

  it('builds BUY_LIMIT and SELL_LIMIT payloads without deriving stop orders', () => {
    const buyLimit = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      currentPrice: 3335,
      atr: 2,
      orderType: 'BUY_LIMIT',
      riskGate: { decision_id: 'tpv1_buy_limit', mode: 'approve', symbol: 'XAUUSD' },
      tradePlan: {
        decision_id: 'tpv1_buy_limit',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3332, max: 3333 },
        stop_loss: 3328,
        take_profit: [3345],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'buy pullback'
      }
    });

    expect(buyLimit).toMatchObject({
      type: 'BUY',
      entry: 3332.5,
      lots: 0.01,
      order_type: 'BUY_LIMIT',
      expiration: 1776081600,
      strategy: 'ai_signal'
    });

    const sellLimit = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      currentPrice: 3335,
      atr: 2,
      orderType: 'SELL_LIMIT',
      riskGate: { decision_id: 'tpv1_sell_limit', mode: 'approve', symbol: 'XAUUSD' },
      tradePlan: {
        decision_id: 'tpv1_sell_limit',
        mode: 'approve',
        side: 'sell',
        entry_zone: { min: 3338, max: 3339 },
        stop_loss: 3344,
        take_profit: [3320],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'sell rebound'
      }
    });

    expect(sellLimit).toMatchObject({
      type: 'SELL',
      entry: 3338.5,
      lots: 0.01,
      order_type: 'SELL_LIMIT',
      expiration: 1776081600,
      strategy: 'ai_signal'
    });

    expect([buyLimit.order_type, sellLimit.order_type]).not.toContain('BUY_STOP');
    expect([buyLimit.order_type, sellLimit.order_type]).not.toContain('SELL_STOP');
  });
});
```

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/command.spec.ts
```

Expected: FAIL because `AIApproveCommandInput` does not accept `orderType` and command builder still derives `order_type`.

- [ ] **Step 3: Update command builder to consume accepted order type**

In `apps/app-server/src/services/ai-approve/command.ts`, replace the imports from `rules.ts` with:

```ts
import {
  calcAIApproveLots,
  firstPositiveAIApproveTakeProfit,
  pickAIApproveEntryPrice,
  round2,
  type AIApproveOrderType
} from './rules.js';
```

Add `orderType` to `AIApproveCommandInput`:

```ts
  currentPrice: number;
  atr: number;
  orderType: AIApproveOrderType;
```

Replace the entire `buildAIApproveCommandCandidate` function in `apps/app-server/src/services/ai-approve/command.ts` with this complete function:

```ts
export function buildAIApproveCommandCandidate(input: AIApproveCommandInput): CommandCandidate {
  const side = stringField(input.tradePlan, 'side').toUpperCase();
  const entryZone = recordField(input.tradePlan, 'entry_zone');
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? 0 : numberField(entryZone, 'max');
  const entry = pickAIApproveEntryPrice(entryZone);
  const confidence = numberField(input.tradePlan, 'confidence');
  const candidate: CommandCandidate = {
    command_id: `ai_pending_${input.accountId}_${input.symbol}_${unixNanos(input.nowIso)}`,
    action: 'SIGNAL',
    symbol: input.symbol,
    type: side,
    entry: round2(entry),
    entry_min: round2(entryMin),
    entry_max: round2(entryMax),
    sl: round2(numberField(input.tradePlan, 'stop_loss')),
    tp: round2(firstPositiveAIApproveTakeProfit(arrayNumberField(input.tradePlan, 'take_profit'))),
    lots: round2(calcAIApproveLots(numberField(input.tradePlan, 'max_lots'))),
    order_type: input.orderType,
    score: confidence,
    strategy: 'ai_signal',
    source: 'ai_approve',
    confidence,
    decision_id: stringField(input.tradePlan, 'decision_id'),
    reason: stringField(input.tradePlan, 'narrative'),
    trade_plan_mode: stringField(input.tradePlan, 'mode'),
    risk_gate: input.riskGate
  };
  if (input.orderType !== 'market') {
    candidate.expiration = unixSeconds(input.nowIso) + 4 * 60 * 60;
  }
  return candidate;
}
```

- [ ] **Step 4: Pass accepted order type from app.ts into the command builder**

In `apps/app-server/src/app.ts`, update the call inside `queueAIApprovePendingCommands` from:

```ts
    const candidate = await tradePlanToCommandCandidate(deps.store, accountId, symbol, tradePlan, riskGate, eventTimestamp);
```

to:

```ts
    const candidate = await tradePlanToCommandCandidate(deps.store, accountId, symbol, tradePlan, riskGate, eventTimestamp, pendingGate.orderType);
```

Update the `tradePlanToCommandCandidate` signature:

```ts
function tradePlanToCommandCandidate(
  store: EaStore,
  accountId: string,
  symbol: string,
  tradePlan: EaRecord,
  riskGate: EaRecord,
  nowIso: string,
  orderType: import('./services/ai-approve/rules.js').AIApproveOrderType
): Promise<CommandCandidate> {
```

Then pass `orderType` into `buildAIApproveCommandCandidate`:

```ts
    orderType
```

The final argument object in `tradePlanToCommandCandidate` should end with:

```ts
    currentPrice: aiApproveCurrentPrice((await store.getLatestTick(accountId, symbol)) ?? {}),
    atr: latestH1Atr(await store.getBars(accountId, symbol, 'H1')),
    orderType
```

- [ ] **Step 5: Run command tests**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/command.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run app-server typecheck**

Run:

```bash
pnpm --filter app-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit command builder wiring**

Run:

```bash
git add apps/app-server/src/services/ai-approve/command.ts apps/app-server/src/services/ai-approve/command.spec.ts apps/app-server/src/app.ts
git commit -m "feat(app-server): emit accepted AI approve order type"
```

Expected: commit contains only command builder, command test, and app-server wiring.

---

### Task 5: Add Route-Level Stop Rejection Coverage And Final Verification

**Files:**
- Modify: `apps/app-server/src/app.spec.ts`

- [ ] **Step 1: Add a route-level cutover test for disabled AI stop orders**

Append this test near the existing AI approve route tests in `apps/app-server/src/app.spec.ts`:

```ts
  it('does not queue AI approve stop order intent in cutover mode', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });
    for (const timeframe of ['D1', 'H4', 'H1', 'M30', 'M15']) {
      await store.saveBars({
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe,
        bars: [{ close: 3336, ema20: 3335, ema50: 3330, adx: 35, atr: 2, rsi: 60 }]
      });
    }

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_stop_disabled',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3338, max: 3338 },
          execution_type: 'stop',
          requested_order_type: 'BUY_STOP',
          stop_loss: 3332,
          take_profit: [3350],
          max_lots: 0.1,
          confidence: 80,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy', 'order.BUY_STOP'],
          narrative: 'breakout chase disabled'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'OK',
      received: true,
      risk_gate: { status: 'accepted' }
    });
    expect(JSON.parse(response.body)).not.toHaveProperty('command_status');
    expect(await store.listCommands('90011087')).toEqual([]);
    expect(await store.pollCommands('90011087')).toEqual([]);
  });
```

- [ ] **Step 2: Run the route test**

Run:

```bash
pnpm --filter app-server test -- src/app.spec.ts -t "does not queue AI approve stop order intent in cutover mode"
```

Expected: PASS.

- [ ] **Step 3: Run focused app-server AI approve tests**

Run:

```bash
pnpm --filter app-server test -- src/services/ai-approve/rules.spec.ts src/services/ai-approve/gate.spec.ts src/services/ai-approve/command.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run package test suites**

Run:

```bash
pnpm --filter app-agent test
pnpm --filter app-server test
```

Expected: PASS.

- [ ] **Step 5: Run package typechecks**

Run:

```bash
pnpm --filter app-agent typecheck
pnpm --filter app-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Inspect final diff scope**

Run:

```bash
git diff --stat HEAD
git status --short
```

Expected:

- Diff includes only app-agent and app-server files listed in this plan.
- No Go files under `internal/`.
- No MQL4 files under `mt4_ea/`.
- Existing unrelated dirty CI/Docker files remain separate from this work.

- [ ] **Step 7: Commit final route coverage**

Run:

```bash
git add apps/app-server/src/app.spec.ts
git commit -m "test(app-server): cover disabled AI stop intent"
```

Expected: commit contains only `apps/app-server/src/app.spec.ts`.

---

## Final Acceptance Criteria

- AI current-price recommendations can become `order_type=market`.
- AI pullback long recommendations can become `order_type=BUY_LIMIT`.
- AI rebound short recommendations can become `order_type=SELL_LIMIT`.
- AI approve cannot emit `BUY_STOP` or `SELL_STOP`.
- Missing explicit order intent does not become an executable command.
- Invalid SL/TP direction is rejected before command creation.
- `strategy` remains `ai_signal` in all AI approve commands.
- Go and MQL4 source files remain untouched.
- Targeted and package-level Node tests pass.
