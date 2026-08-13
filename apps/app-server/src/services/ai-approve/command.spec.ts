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
        status: 'accepted',
        allowed_lots: 0.03
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
      sl: 3330.456,
      tp: 3344.876,
      tp1: 3344.876,
      tp2: 0,
      tp_split: false,
      lots: 0.03,
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
        status: 'accepted',
        allowed_lots: 0.03
      }
    });
  });

  it('builds BUY_LIMIT and SELL_LIMIT payloads without deriving stop orders', () => {
    const buyLimit = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'BUY_LIMIT',
      riskGate: { decision_id: 'tpv1_buy_limit', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.02 },
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
      lots: 0.02,
      order_type: 'BUY_LIMIT',
      expiration: 1776081600,
      strategy: 'ai_signal'
    });

    const sellLimit = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'SELL_LIMIT',
      riskGate: { decision_id: 'tpv1_sell_limit', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.03 },
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
      lots: 0.03,
      order_type: 'SELL_LIMIT',
      expiration: 1776081600,
      strategy: 'ai_signal'
    });

    expect([buyLimit.order_type, sellLimit.order_type]).not.toContain('BUY_STOP');
    expect([buyLimit.order_type, sellLimit.order_type]).not.toContain('SELL_STOP');
  });

  it('builds staged take profit payloads using the legacy single tp target', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'market',
      riskGate: { decision_id: 'tpv1_tp2', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.01 },
      tradePlan: {
        decision_id: 'tpv1_tp2',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3340, 3345],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'staged target'
      }
    });

    expect(command).toMatchObject({
      tp: 3345,
      tp1: 3345,
      tp2: 0,
      tp_split: false
    });
  });

  it('normalizes staged take profits by distance instead of trusting array order', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'market',
      riskGate: { decision_id: 'tpv1_tp_order', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.01 },
      tradePlan: {
        decision_id: 'tpv1_tp_order',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3345, 3340],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'targets arrived far-to-near'
      }
    });

    expect(command).toMatchObject({
      tp: 3345,
      tp1: 3345,
      tp2: 0,
      tp_split: false
    });
  });

  it('preserves EURUSD input precision in the EA payload', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'EURUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'market',
      riskGate: { decision_id: 'tpv1_eurusd_precision', mode: 'approve', symbol: 'EURUSD', allowed_lots: 0.01 },
      tradePlan: {
        decision_id: 'tpv1_eurusd_precision',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 1.09500, max: 1.09500 },
        stop_loss: 1.09420,
        take_profit: [1.09650],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'preserve five digit forex prices'
      }
    });

    expect(command).toMatchObject({
      entry: 1.095,
      entry_min: 1.095,
      entry_max: 1.095,
      sl: 1.0942,
      tp: 1.0965,
      tp1: 1.0965,
      tp2: 0
    });
    expect(command.entry).not.toBe(1.1);
    expect(command.sl).not.toBe(1.09);
    expect(command.tp).not.toBe(1.1);
  });

  it('builds adverse SIGNAL with scale_in_add_on_type/level and unified_sl = min openPrice (BUY)', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'BUY_LIMIT',
      riskGate: { decision_id: 'tpv1_adverse', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.04 },
      tradePlan: {
        decision_id: 'tpv1_adverse',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3345],
        max_lots: 0.05,
        confidence: 76,
        narrative: 'adverse add-on L1',
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1
      },
      positions: [
        { ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.10, open_price: 3337.6, strategy: 'ai_signal' }
      ]
    });

    expect(command).toMatchObject({
      type: 'BUY',
      order_type: 'BUY_LIMIT',
      strategy: 'ai_signal',
      scale_in_parent_ticket: 1001,
      weighted_avg_entry: 3337.6,
      unified_sl: 3337.6,
      scale_in_count: 1,
      scale_in_add_on_type: 'adverse',
      scale_in_add_on_level: 1
    });
  });

  it('builds adverse SIGNAL with unified_sl = min openPrice across multiple positions (BUY)', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'BUY_LIMIT',
      riskGate: { decision_id: 'tpv1_adverse', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.04 },
      tradePlan: {
        decision_id: 'tpv1_adverse',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3345],
        max_lots: 0.05,
        confidence: 76,
        narrative: 'adverse add-on L2',
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 2
      },
      positions: [
        { ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.10, open_price: 3340.0, strategy: 'ai_signal' },
        { ticket: 1002, symbol: 'XAUUSD', type: 'BUY', lots: 0.06, open_price: 3338.0, strategy: 'ai_signal' }
      ]
    });

    expect(command).toMatchObject({
      scale_in_parent_ticket: 1002,
      weighted_avg_entry: 3339.25,
      unified_sl: 3338,
      scale_in_count: 2,
      scale_in_add_on_type: 'adverse',
      scale_in_add_on_level: 2
    });
  });

  it('uses riskGate.allowed_lots as the authoritative command lots', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'market',
      riskGate: { decision_id: 'tpv1_lots', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0.07 },
      tradePlan: {
        decision_id: 'tpv1_lots',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3345],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'gate sized trade'
      }
    });

    expect(command.lots).toBe(0.07);
  });

  it('rejects commands when riskGate.allowed_lots is zero or missing', () => {
    const baseInput = {
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      orderType: 'market' as const,
      tradePlan: {
        decision_id: 'tpv1_invalid_lots',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3335.5, max: 3335.7 },
        stop_loss: 3330,
        take_profit: [3345],
        max_lots: 0.05,
        confidence: 76,
        narrative: 'invalid gate size'
      }
    };

    expect(() => buildAIApproveCommandCandidate({
      ...baseInput,
      riskGate: { decision_id: 'tpv1_zero_lots', mode: 'approve', symbol: 'XAUUSD', allowed_lots: 0 }
    })).toThrow('riskGate.allowed_lots');

    expect(() => buildAIApproveCommandCandidate({
      ...baseInput,
      riskGate: { decision_id: 'tpv1_missing_lots', mode: 'approve', symbol: 'XAUUSD' }
    })).toThrow('riskGate.allowed_lots');
  });
});
