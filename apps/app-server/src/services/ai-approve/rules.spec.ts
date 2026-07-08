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

  it('accepts market intent when H1 ATR is missing even if entry differs slightly from current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'market', requested_order_type: 'market', entry_zone: { min: 4108.83, max: 4108.83 } }),
      4108.50,
      4108.83,
      0
    )).toEqual({ accepted: true, orderType: 'market' });
  });

  it('accepts buy limit below current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: true, orderType: 'BUY_LIMIT' });
  });

  it('accepts sell limit above current price', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'SELL_LIMIT' }),
      3335.6,
      3338.5,
      2
    )).toEqual({ accepted: true, orderType: 'SELL_LIMIT' });
  });

  it('converts limit orders to market after price reaches the entry and remains protected', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'BUY_LIMIT', entry_zone: { min: 3338, max: 3338 } }),
      3335.6,
      3338,
      2
    )).toEqual({ accepted: true, orderType: 'market' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'SELL_LIMIT', entry_zone: { min: 3332, max: 3332 }, stop_loss: 3340, take_profit: [3325] }),
      3335.6,
      3332,
      2
    )).toEqual({ accepted: true, orderType: 'market' });
  });

  it('converts limit orders at current price to market intent', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'BUY_LIMIT', entry_zone: { min: 3335.6, max: 3335.6 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: true, orderType: 'market' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'SELL_LIMIT', entry_zone: { min: 3335.6, max: 3335.6 }, stop_loss: 3340, take_profit: [3325] }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: true, orderType: 'market' });
  });

  it('converts already-triggered limit entries to market while price remains inside protection range', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({
        side: 'sell',
        execution_type: 'limit',
        requested_order_type: 'SELL_LIMIT',
        entry_zone: { min: 59.94, max: 59.94 },
        stop_loss: 60.85,
        take_profit: [59.15, 58.25]
      }),
      60.6,
      59.94,
      0.5
    )).toEqual({ accepted: true, orderType: 'market' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({
        side: 'buy',
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3335.6, max: 3335.6 },
        stop_loss: 3330,
        take_profit: [3345]
      }),
      3332,
      3335.6,
      2
    )).toEqual({ accepted: true, orderType: 'market' });
  });

  it('rejects triggered limit entries after price crosses beyond the stop loss', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({
        side: 'sell',
        execution_type: 'limit',
        requested_order_type: 'SELL_LIMIT',
        entry_zone: { min: 59.94, max: 59.94 },
        stop_loss: 60.85,
        take_profit: [59.15]
      }),
      60.9,
      59.94,
      0.5
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
      tradePlan({ requested_order_type: 'SELL_STOP' }),
      3335.6,
      3332,
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

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'market', requested_order_type: undefined, entry_zone: { min: 3335.5, max: 3335.7 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.missing' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: undefined, requested_order_type: 'market', entry_zone: { min: 3335.5, max: 3335.7 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.missing' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'limit', requested_order_type: undefined }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.missing' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: undefined, requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.missing' });
  });

  it('rejects contradictory explicit order intent fields', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'market', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'buy', execution_type: 'limit', requested_order_type: 'SELL_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ side: 'sell', execution_type: 'limit', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3338.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });
  });

  it('rejects invalid explicit order intent values', () => {
    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'pending', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'pending', requested_order_type: 'market', entry_zone: { min: 3335.5, max: 3335.7 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'limit', requested_order_type: 'BOGUS' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'MARKET', requested_order_type: 'market', entry_zone: { min: 3335.5, max: 3335.7 } }),
      3335.6,
      3335.6,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'Limit', requested_order_type: 'BUY_LIMIT' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });

    expect(resolveAIApproveOrderIntent(
      tradePlan({ execution_type: 'limit', requested_order_type: 'buy_limit' }),
      3335.6,
      3332.5,
      2
    )).toEqual({ accepted: false, reason: 'order_intent.mismatch' });
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

  it('rejects missing or zero protection values', () => {
    expect(validateAIApproveProtectionDirection(
      tradePlan({ stop_loss: undefined, take_profit: [3345] }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ stop_loss: 0, take_profit: [3345] }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ stop_loss: 3330, take_profit: undefined }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ stop_loss: 3330, take_profit: [0] }),
      3335.6
    )).toEqual({ accepted: false, reason: 'protection.invalid_direction' });

    expect(validateAIApproveProtectionDirection(
      tradePlan({ stop_loss: 3330, take_profit: [-1, 0] }),
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
