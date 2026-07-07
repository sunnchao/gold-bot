# AI Order Intent Design

Date: 2026-07-07

## Summary

AI approve orders will move from price-only inference to explicit order intent. `apps/app-agent` must express whether the trade is an immediate market order or a limit order. `apps/app-server` remains the final safety authority and only converts accepted intents into EA-compatible `SIGNAL` commands.

The executable order set is deliberately narrow:

- Current-price entry: `market`
- Pullback long: `BUY_LIMIT`
- Rebound short: `SELL_LIMIT`

AI stop orders are disabled for this slice. `BUY_STOP` and `SELL_STOP` are rejected and never queued for `/poll`.

## Confirmed Requirements

- If the AI recommendation says the trade can enter at the current price, the agent must produce a market-order intent and the server must create an immediate EA `SIGNAL` command with `order_type=market`.
- If the AI recommendation says to short after price rebounds to a level, the agent must produce a sell limit intent and the server must create `order_type=SELL_LIMIT`.
- If the AI recommendation says to buy after price pulls back to a level, the agent must produce a buy limit intent and the server must create `order_type=BUY_LIMIT`.
- Breakout or breakdown chase entries are not executable in this design.
- Go source and MQL4 EA source remain read-only.
- EA-facing `strategy` remains `ai_signal`. No new strategy names or Magic ownership changes are introduced.
- The existing Node command lifecycle remains in force. Commands only reach `/poll` when the account runtime mode permits queue promotion.

## Non-Goals

- No Go strategy engine changes.
- No MQL4 EA command protocol changes.
- No new EA action type.
- No natural-language keyword parser for "current price", "pullback", or "rebound".
- No support for `BUY_STOP` or `SELL_STOP` in AI approve orders.

## Architecture

### app-agent

`apps/app-agent` owns intent expression. It should use the existing `TradeAction` model as the source of truth:

- `place_market_order` means current-price execution.
- `place_pending_order` with `order_type=limit` means limit execution.
- `do_nothing` means no executable trade.

The composed `trade_plan` should preserve execution intent with explicit fields:

- `execution_type: "market" | "limit"`
- `requested_order_type: "market" | "BUY_LIMIT" | "SELL_LIMIT"`

For limit orders, the mapping is deterministic:

- `side=buy` plus `order_type=limit` becomes `requested_order_type=BUY_LIMIT`.
- `side=sell` plus `order_type=limit` becomes `requested_order_type=SELL_LIMIT`.

If an agent path still produces a pending `stop` intent, compose should not publish it as an executable approve plan. It should downgrade to a non-executable plan or omit the approve `trade_plan`.

### app-server

`apps/app-server` owns final validation and EA command conversion. The AI approve command builder must stop deriving `BUY_STOP` or `SELL_STOP` from price distance. It should consume explicit intent and only emit:

- `market`
- `BUY_LIMIT`
- `SELL_LIMIT`

The command payload remains EA-compatible:

- `action: "SIGNAL"`
- `source: "ai_approve"`
- `strategy: "ai_signal"`
- `type: "BUY" | "SELL"`
- `entry`, `sl`, `tp`, `lots`, `score`, `confidence`, `decision_id`
- `expiration` only for limit orders

## Data Flow

1. `app-agent` runs comprehensive analysis and creates a structured `TradeAction`.
2. `compose.ts` converts executable actions into `trade_plan`.
3. The `trade_plan` includes `execution_type` and `requested_order_type`.
4. `app-agent` publishes the AI result to `/api/v2/ai_result/{accountId}/{symbol}`.
5. `app-server` saves the AI result, evaluates trade-plan risk, then evaluates the AI approve gate.
6. The server validates order intent, price direction, SL/TP direction, duplicate pending commands, cooldown, trend context, position context, confidence, and lots.
7. Accepted plans become `CommandCandidate` records through the existing command lifecycle.
8. The command lifecycle promotes or demotes the command according to runtime mode.

## Validation Rules

### Common Rules

Existing AI approve gates remain active:

- `mode=approve`
- `side` is `buy` or `sell`
- risk gate is not rejected
- confidence passes the configured threshold
- calculated lots are at least `0.01`
- no active duplicate `ai_approve` pending command for the same account, symbol, and side
- cooldown is not active
- trend, same-side position, and add-on distance checks continue to apply

### Market Orders

Market orders require explicit intent:

- `execution_type=market` or `requested_order_type=market`
- `entry_zone` must be close to the current bid/ask midpoint
- the distance from current price to entry must be less than or equal to `0.3 * H1 ATR`

If the market intent is explicit but the entry is not close enough, reject with:

- `market_entry_mismatch`

Accepted market orders emit:

- `order_type=market`
- no pending-order expiry requirement

### BUY_LIMIT

Buy limit orders require:

- `side=buy`
- `execution_type=limit` or `requested_order_type=BUY_LIMIT`
- entry price is less than or equal to current price

If entry is above current price, reject with:

- `limit_direction_mismatch`

Accepted buy limit orders emit:

- `order_type=BUY_LIMIT`
- `expiration = now + 4h`

### SELL_LIMIT

Sell limit orders require:

- `side=sell`
- `execution_type=limit` or `requested_order_type=SELL_LIMIT`
- entry price is greater than or equal to current price

If entry is below current price, reject with:

- `limit_direction_mismatch`

Accepted sell limit orders emit:

- `order_type=SELL_LIMIT`
- `expiration = now + 4h`

### STOP Orders

Any stop order intent is rejected:

- `requested_order_type=BUY_STOP`
- `requested_order_type=SELL_STOP`
- `place_pending_order` with `order_type=stop`

Reject with:

- `stop_order.disabled`

No command candidate is saved or promoted for disabled stop orders.

### Protection Direction

The server must validate SL/TP direction before queueing:

- BUY orders require `sl < entry` and first valid `tp > entry`.
- SELL orders require `sl > entry` and first valid `tp < entry`.

Invalid protection levels are rejected with:

- `protection.invalid_direction`

This prevents EA-side protection attach failures caused by directionally invalid SL or TP levels.

## Testing Scope

### app-agent compose tests

Add or update tests around `apps/app-agent/src/graph/compose.ts`:

- `place_market_order` produces `execution_type=market` and `requested_order_type=market`.
- `place_pending_order`, `side=buy`, `order_type=limit` produces `requested_order_type=BUY_LIMIT`.
- `place_pending_order`, `side=sell`, `order_type=limit` produces `requested_order_type=SELL_LIMIT`.
- `place_pending_order`, `order_type=stop` does not produce an executable approve plan.

### app-server rules tests

Add or update tests around `apps/app-server/src/services/ai-approve/rules.ts`:

- market intent near current price is accepted.
- market intent far from current price rejects with `market_entry_mismatch`.
- buy limit below or at current price is accepted.
- sell limit above or at current price is accepted.
- buy limit above current price rejects with `limit_direction_mismatch`.
- sell limit below current price rejects with `limit_direction_mismatch`.
- stop intent rejects with `stop_order.disabled`.
- invalid SL/TP direction rejects with `protection.invalid_direction`.

### app-server command tests

Add or update tests around `apps/app-server/src/services/ai-approve/command.ts`:

- command builder emits `market` from explicit market intent.
- command builder emits `BUY_LIMIT` from explicit buy limit intent.
- command builder emits `SELL_LIMIT` from explicit sell limit intent.
- command builder never emits `BUY_STOP` or `SELL_STOP`.
- `strategy` remains `ai_signal`.

### Route or gate integration tests

Add one route-level or gate-level test proving a rejected stop or mismatched limit does not reach command lifecycle promotion.

## Verification Commands

Use targeted Node verification:

```bash
pnpm --filter @gold-bot/app-agent test
pnpm --filter @gold-bot/app-server test
pnpm --filter @gold-bot/app-server typecheck
git diff --stat HEAD
```

If `@gold-bot/app-server` has no `typecheck` script at implementation time, use the repository's existing package-specific TypeScript verification command instead.

## Open Implementation Notes

- The existing `orderTypeForAIApproveSignal(price, entry, atr, side)` helper should be replaced or narrowed so AI approve orders cannot auto-infer stop orders.
- The current `TradeAction` type already has `place_market_order`, `place_pending_order`, and `do_nothing`; implementation should reuse it instead of adding a parallel action model.
- Existing dirty worktree changes in CI and Docker files are unrelated and must not be included in this implementation.
