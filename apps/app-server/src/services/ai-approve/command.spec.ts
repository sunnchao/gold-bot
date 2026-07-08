import { describe, expect, it } from 'vitest';
import { buildAIApproveCommandCandidate } from './command.js';

describe('AI approve command builder', () => {
  it('builds market SIGNAL payloads from accepted market intent', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T16:00:00+08:00',
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
      lots: 0.02,
      order_type: 'market',
      expiration: 1776081600,
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
