import { describe, expect, it } from 'vitest';
import { buildAIApproveCommandCandidate } from './command.js';

describe('AI approve command builder', () => {
  it('builds the Go-shaped BUY pending SIGNAL payload', () => {
    const command = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T16:00:00+08:00',
      currentPrice: 3336,
      atr: 2,
      riskGate: {
        decision_id: 'tpv1_buy',
        mode: 'approve',
        symbol: 'XAUUSD',
        status: 'accepted'
      },
      tradePlan: {
        schema_version: 'trade_plan.v1',
        decision_id: 'tpv1_buy',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3334.98, max: 3335.22 },
        stop_loss: 3330.456,
        take_profit: [0, 3344.876],
        max_lots: 0.2,
        confidence: 80,
        narrative: 'approved by AI'
      }
    });

    expect(command).toEqual({
      command_id: 'ai_pending_90011087_XAUUSD_1776067200000000000',
      action: 'SIGNAL',
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 3335.1,
      entry_min: 3334.98,
      entry_max: 3335.22,
      sl: 3330.46,
      tp: 3344.88,
      lots: 0.01,
      order_type: 'BUY_LIMIT',
      expiration: 1776081600,
      score: 80,
      strategy: 'ai_signal',
      source: 'ai_approve',
      confidence: 80,
      decision_id: 'tpv1_buy',
      reason: 'approved by AI',
      trade_plan_mode: 'approve',
      risk_gate: {
        decision_id: 'tpv1_buy',
        mode: 'approve',
        symbol: 'XAUUSD',
        status: 'accepted'
      }
    });
  });

  it('builds SELL stop payloads and falls back to market when ATR is unavailable', () => {
    const stop = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      currentPrice: 3335,
      atr: 2,
      riskGate: { decision_id: 'tpv1_sell', mode: 'approve', symbol: 'XAUUSD' },
      tradePlan: {
        decision_id: 'tpv1_sell',
        mode: 'approve',
        side: 'sell',
        entry_zone: { min: 3332, max: 3333 },
        stop_loss: 3340,
        take_profit: [3320],
        max_lots: 0.01,
        confidence: 76,
        narrative: 'sell stop'
      }
    });
    expect(stop).toMatchObject({
      type: 'SELL',
      entry: 3332.5,
      lots: 0.01,
      order_type: 'SELL_STOP'
    });

    const market = buildAIApproveCommandCandidate({
      accountId: '90011087',
      symbol: 'XAUUSD',
      nowIso: '2026-04-13T08:00:00Z',
      currentPrice: 3335,
      atr: 0,
      riskGate: { decision_id: 'tpv1_market', mode: 'approve', symbol: 'XAUUSD' },
      tradePlan: {
        decision_id: 'tpv1_market',
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3338, max: 3338 },
        stop_loss: 3330,
        take_profit: [3345],
        max_lots: 0.01,
        confidence: 78,
        narrative: 'market fallback'
      }
    });
    expect(market.order_type).toBe('market');
  });
});
