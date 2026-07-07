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
