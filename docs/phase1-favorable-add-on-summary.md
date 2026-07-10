# Phase 1: Favorable Add-on Implementation Summary

**Date**: 2026-07-09  
**Status**: ✅ Complete (pending commit)

## Changes Overview

Phase 1 implements favorable add-on (同向盈利加仓) logic per the design spec at `docs/specs/2026-07-09-ai-signal-add-on-design.md`.

### Modified Files

1. **`apps/app-agent/src/types/schemas.ts`**
   - Added `add_on_type?: 'favorable' | 'adverse'` field to trade_plan schema

2. **`apps/app-server/src/services/ai-approve/gate.ts`**
   - Extended same-side position check with favorable add-on validation:
     - Profit must be >= 1.0 ATR (weighted average across existing positions)
     - New lots must be <= existing_lots * 0.5
   - Added helper functions:
     - `totalLotsOnSide()` — sum lots for symbol+side
     - `calculateProfitAtr()` — weighted average profit in ATR units
   - New rejection reasons:
     - `position.favorable_add_no_existing_lots`
     - `position.favorable_add_profit_not_enough`
     - `position.favorable_add_lots_too_large`

3. **`apps/app-server/src/services/ai-approve/command.ts`**
   - Extended `AIApproveCommandInput` type with optional `positions?: EaRecord[]`
   - Updated `buildAIApproveCommandCandidate()` to attach scale_in metadata bridge fields when `add_on_type === 'favorable'`:
     - `scale_in_parent_ticket` — largest ticket in group
     - `weighted_avg_entry` — group average entry (lots-weighted)
     - `unified_sl` — group best SL (BUY: max openPrice, SELL: min openPrice)
     - `scale_in_count` — number of positions in group

4. **`apps/app-server/src/app.ts`**
   - Modified `queueAIApprovePendingCommands()` to fetch positions once and pass through
   - Updated `tradePlanToCommandCandidate()` signature to accept optional `positions` parameter

5. **`packages/trading-core/src/positionmgr/manager.ts`**
   - Extended `applySameSameBreakeven()` function signature with `previousTickets: Set<number>` parameter
   - Added favorable add-on detection logic:
     - Identifies new positions (not in previousTickets) vs old positions (in previousTickets)
     - Calculates weighted average entry price of old positions
     - Checks if any new position is opened at a better price than average (BUY: higher, SELL: lower)
   - Triggers stop loss tightening when favorable add-on is detected
   - Reason code: `group_favorable_addon_{BUY|SELL}`

6. **`packages/trading-core/src/positionmgr/manager.spec.ts`**
   - Added 1 test case for favorable add-on stop loss tightening
   - ✅ Test passes: verifies that ticket 2001 SL is tightened to 3340 when ticket 2002 (favorable add-on) is opened at 3340

7. **`apps/app-server/src/services/ai-approve/gate.spec.ts`**
   - Added 6 test cases across two describe blocks:
     - ✅ accepts favorable add-on when profit >= 1.0 ATR and lots <= existing*0.5 (2 tests)
     - ✅ rejects favorable add-on when profit < 1.0 ATR (2 tests)
     - ✅ rejects favorable add-on when new lots > existing*0.5 (2 tests)

## Test Results

**Before Phase 1**: 
- app-server: 2 failed / 158 passed (160 total)
- trading-core: 13 failed / 173 passed (186 total, 13 pre-existing momentum_scalp failures)

**After Phase 1**: 
- app-server: 2 failed / 164 passed (166 total) — **+6 new tests, all passing**
- trading-core: 13 failed / 174 passed (187 total) — **+1 new test, passing**

- **7 new tests added, all passing**
- **0 new regressions**
- Pre-existing failures unchanged (unrelated to Phase 1)

## Design Decisions

### Option 3 (分层 / Layered) Relationship

Per user clarification, favorable add-on uses **Option 3 (分层)** relationship with scale_in:
- `scale_in` manages EA execution details (basket position linking, BE trigger)
- `favorable add-on` manages AI decision (profit check, lot sizing)
- They connect via **shared metadata bridge fields** (`scale_in_parent_ticket`, `weighted_avg_entry`, `unified_sl`, `scale_in_count`)

This approach:
- ✅ Avoids group attribution conflicts
- ✅ Reuses existing EA basket engine infrastructure
- ✅ Keeps AI decision logic separate from EA execution logic

### Profit Calculation

Profit is calculated as **weighted average** across all existing positions:
```typescript
profitAtr = (Σ(lots[i] × (currentPrice - openPrice[i])) / Σ(lots[i])) / ATR
```

For BUY: profit = currentPrice - openPrice  
For SELL: profit = openPrice - currentPrice

### Lots Limit

New lots are capped at **50% of existing lots**:
```typescript
if (newLots > existingLots * 0.5) {
  reject('position.favorable_add_lots_too_large');
}
```

This enforces the design spec principle: "新加仓手数 ≤ 现有持仓手数 × 0.5"

### Group Best SL

For favorable add-on, `unified_sl` is set to the **most favorable openPrice** in the group:
- BUY side: `max(openPrice[i])` across all positions
- SELL side: `min(openPrice[i])` across all positions

This acts as a **bridge value** for the EA basket engine to tighten stops after add-on (handled by `applySameSideBreakeven` in position_manager).

## Next Steps (Not Started)

### Phase 1 Completed Features

✅ **Position Manager Integration**
- Extended `applySameSideBreakeven()` with `previousTickets` parameter
- Added favorable add-on detection: checks if new positions are opened at better prices than group average
- Tightens stop losses for all group members when favorable add-on is detected
- Reason code: `group_favorable_addon_{BUY|SELL}`

### Phase 2: Adverse Add-on (逆势浮亏加仓)
- Level system (L1/L2/L3)
- Price spacing: 1.0/1.5/2.0 × M30 ATR
- Time intervals: 45/90/180 min
- Decreasing lots: 1.00→0.60→0.35→0.20
- Drawdown circuit breaker (maxAdverseDrawdownPct=5%)
- Programmatic exit (equity * maxAdverseRiskPct=6%)

### Phase 3: Group State Persistence
- `position_group` table migration
- `group_metadata` table migration
- Unified stop reanchor logic

## Files Modified
- `apps/app-agent/src/types/schemas.ts` (1 line)
- `apps/app-server/src/services/ai-approve/gate.ts` (66 lines)
- `apps/app-server/src/services/ai-approve/command.ts` (36 lines)
- `apps/app-server/src/app.ts` (4 lines)
- `packages/trading-core/src/positionmgr/manager.ts` (25 lines)
- `packages/trading-core/src/positionmgr/manager.spec.ts` (18 lines)
- `apps/app-server/src/services/ai-approve/gate.spec.ts` (89 lines)
- `docs/phase1-favorable-add-on-summary.md` (new file)

**Total**: 7 files modified, 1 file created, ~240 insertions
