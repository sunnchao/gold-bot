import { describe, expect, it } from 'vitest';
import { composeFinalSignal } from './compose.js';
import type { AnalysisGraphStateType } from './state.js';
import { TradePlanSchema } from '../types/schemas.js';

describe('composeFinalSignal trade_plan.v1', () => {
  it('exports a real TradePlanSchema validator', () => {
    expect(TradePlanSchema).toBeDefined();
    expect(typeof TradePlanSchema.parse).toBe('function');
  });

  it('adds a traceable trade_plan beside legacy AI result fields', () => {
    const signal = composeFinalSignal({
      accountId: '90011087',
      symbol: 'XAUUSD',
      timestamp: '2026-06-06T09:00:00.000Z',
      payload: {
        account: {
          account_id: '90011087',
          balance: 10000,
          equity: 10100,
          margin: 200,
          free_margin: 9900,
          currency: 'USD',
          leverage: 500,
        },
        market: {
          symbol: 'XAUUSD',
          bid: 3335.55,
          ask: 3335.75,
          spread: 0.2,
        },
        indicators: {},
        positions: [],
        market_status: {
          market_open: true,
          is_trade_allowed: true,
          tradeable: true,
        },
        strategy_mapping: {},
      },
      technicalAnalysis: {
        bias: 'bullish',
        confidence: 74,
        phase: 'trending',
        indicators_summary: 'H1 momentum aligned',
        support_levels: [
          { price: 3328, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
        ],
        resistance_levels: [
          { price: 3350, type: 'resistance', strength: 'moderate', timeframe: 'H1', touches: 2 },
        ],
        recommendation: 'hold',
        rationale: 'trend continuation',
      },
      riskAssessment: {
        riskLevel: 'medium',
        maxPositionSize: 0.2,
        suggestedSL: 3328,
        warnings: ['spread normal'],
      },
      arbitration: {
        final_direction: 'buy',
        confidence: 82,
        primary_contradiction: 'none',
        phase: 'trend-following',
        reasoning: 'multi-timeframe bullish alignment',
        action: 'open',
        united_front_analysis: 'aligned',
      },
      logs: [],
      errors: [],
    } as AnalysisGraphStateType);

    expect(signal).not.toBeNull();
    expect(signal?.bias).toBe('bullish');
    expect(signal?.trade_plan).toEqual(
      expect.objectContaining({
        schema_version: 'trade_plan.v1',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        confidence: 82,
        stop_loss: 3328,
        max_lots: 0.2,
        reason_codes: expect.arrayContaining(['mode.approve', 'side.buy']),
      }),
    );
    expect(signal?.trade_plan?.decision_id).toMatch(/^tpv1_[a-f0-9]{16}$/);
    expect(signal?.trade_plan?.entry_zone).toEqual({ min: 3335.55, max: 3335.75 });
    expect(signal?.trade_plan?.take_profit).toEqual([3350]);
    expect(signal?.trade_plan?.expires_at).toBe('2026-06-06T09:15:00.000Z');
    expect(signal?.trade_plan?.add_on).toBe(false);
    expect(TradePlanSchema.parse(signal?.trade_plan).decision_id).toBe(
      signal?.trade_plan?.decision_id,
    );
  });

  it('rejects active trade plans with zero execution fields', () => {
    expect(() =>
      TradePlanSchema.parse({
        schema_version: 'trade_plan.v1',
        decision_id: 'tpv1_bad',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        confidence: 70,
        entry_zone: { min: 0, max: 0 },
        stop_loss: 0,
        take_profit: [],
        max_lots: 0,
        expires_at: '2026-06-06T09:15:00.000Z',
        reason_codes: ['mode.approve'],
        conflicts: [],
        narrative: 'invalid active plan',
        add_on: false,
      }),
    ).toThrow();
  });

  it('defaults add_on to false when omitted from trade plan input', () => {
    const parsed = TradePlanSchema.parse({
      schema_version: 'trade_plan.v1',
      decision_id: 'tpv1_default_add_on',
      account_id: '90011087',
      symbol: 'XAUUSD',
      mode: 'observe',
      side: 'none',
      confidence: 50,
      entry_zone: { min: 0, max: 0 },
      stop_loss: 0,
      take_profit: [],
      max_lots: 0,
      expires_at: '2026-06-06T09:15:00.000Z',
      reason_codes: ['mode.observe'],
      conflicts: [],
      narrative: 'default add_on behavior',
    });

    expect(parsed.add_on).toBe(false);
  });

  it('downgrades an open decision to observe when required execution fields are incomplete', () => {
    const signal = composeFinalSignal({
      accountId: '90011087',
      symbol: 'XAUUSD',
      timestamp: '2026-06-06T09:00:00.000Z',
      payload: {
        account: {
          account_id: '90011087',
          balance: 10000,
          equity: 10100,
          margin: 200,
          free_margin: 9900,
          currency: 'USD',
          leverage: 500,
        },
        market: {
          symbol: 'XAUUSD',
          bid: 3335.55,
          ask: 3335.75,
          spread: 0.2,
        },
        indicators: {},
        positions: [],
        market_status: {
          market_open: true,
          is_trade_allowed: true,
          tradeable: true,
        },
        strategy_mapping: {},
      },
      technicalAnalysis: {
        bias: 'bullish',
        confidence: 74,
        phase: 'trending',
        indicators_summary: 'H1 momentum aligned',
        support_levels: [
          { price: 3328, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
        ],
        resistance_levels: [],
        recommendation: 'hold',
        rationale: 'trend continuation',
      },
      riskAssessment: {
        riskLevel: 'medium',
        maxPositionSize: 0.2,
        suggestedSL: 3328,
        warnings: [],
      },
      arbitration: {
        final_direction: 'buy',
        confidence: 82,
        primary_contradiction: 'none',
        phase: 'trend-following',
        reasoning: 'multi-timeframe bullish alignment',
        action: 'open',
        united_front_analysis: 'aligned',
      },
      logs: [],
      errors: [],
    } as AnalysisGraphStateType);

    expect(signal?.trade_plan).toEqual(
      expect.objectContaining({
        mode: 'observe',
        side: 'none',
        entry_zone: { min: 0, max: 0 },
        stop_loss: 0,
        take_profit: [],
        max_lots: 0,
        reason_codes: expect.arrayContaining([
          'mode.observe',
          'side.none',
          'execution.incomplete_fields',
        ]),
        conflicts: expect.arrayContaining(['execution.incomplete_fields']),
      }),
    );
    expect(TradePlanSchema.parse(signal?.trade_plan).mode).toBe('observe');
  });

  it('maps blocking market filters to a zero-risk veto trade plan', () => {
    const signal = composeFinalSignal({
      accountId: '90011087',
      symbol: 'XAUUSD',
      timestamp: '2026-06-06T09:00:00.000Z',
      payload: {
        account: {
          account_id: '90011087',
          balance: 10000,
          equity: 10100,
          margin: 200,
          free_margin: 9900,
          currency: 'USD',
          leverage: 500,
        },
        market: {
          symbol: 'XAUUSD',
          bid: 3335.55,
          ask: 3335.75,
          spread: 0.2,
        },
        indicators: {},
        positions: [],
        market_status: {
          market_open: true,
          is_trade_allowed: true,
          tradeable: false,
        },
        market_filters: {
          blocked: true,
          blocking: [
            { code: 'market.closed', severity: 'blocking' },
            { code: 'spread.too_wide', severity: 'blocking' },
          ],
          warnings: [{ code: 'session.rollover_window', severity: 'warning' }],
          reason_codes: ['market.closed', 'spread.too_wide', 'session.rollover_window'],
        },
        strategy_mapping: {},
      },
      technicalAnalysis: {
        bias: 'bullish',
        confidence: 74,
        phase: 'trending',
        indicators_summary: 'H1 momentum aligned',
        support_levels: [
          { price: 3328, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
        ],
        resistance_levels: [
          { price: 3350, type: 'resistance', strength: 'moderate', timeframe: 'H1', touches: 2 },
        ],
        recommendation: 'hold',
        rationale: 'trend continuation',
      },
      riskAssessment: {
        riskLevel: 'low',
        maxPositionSize: 0.2,
        suggestedSL: 3328,
        warnings: [],
      },
      arbitration: {
        final_direction: 'buy',
        confidence: 82,
        primary_contradiction: 'none',
        phase: 'trend-following',
        reasoning: 'multi-timeframe bullish alignment',
        action: 'open',
        united_front_analysis: 'aligned',
      },
      logs: [],
      errors: [],
    } as AnalysisGraphStateType);

    expect(signal?.risk_alert).toBe(true);
    expect(signal?.alert_reason).toContain('market.closed');
    expect(signal?.max_position_size).toBe(0);
    expect(signal?.trade_plan).toEqual(
      expect.objectContaining({
        mode: 'veto',
        side: 'none',
        entry_zone: { min: 0, max: 0 },
        stop_loss: 0,
        take_profit: [],
        max_lots: 0,
        reason_codes: expect.arrayContaining([
          'mode.veto',
          'side.none',
          'market.closed',
          'spread.too_wide',
        ]),
        conflicts: expect.arrayContaining(['market.closed', 'spread.too_wide']),
      }),
    );
    expect(TradePlanSchema.parse(signal?.trade_plan).mode).toBe('veto');
  });

  it('propagates riskAssessment.addOn into trade_plan.add_on', () => {
    const signal = composeFinalSignal({
      accountId: '90011087',
      symbol: 'XAUUSD',
      timestamp: '2026-06-06T09:00:00.000Z',
      payload: {
        account: {
          account_id: '90011087',
          balance: 10000,
          equity: 10100,
          margin: 200,
          free_margin: 9900,
          currency: 'USD',
          leverage: 500,
        },
        market: {
          symbol: 'XAUUSD',
          bid: 3335.55,
          ask: 3335.75,
          spread: 0.2,
        },
        indicators: {},
        positions: [],
        market_status: {
          market_open: true,
          is_trade_allowed: true,
          tradeable: true,
        },
        strategy_mapping: {},
      },
      technicalAnalysis: {
        bias: 'bullish',
        confidence: 74,
        phase: 'trending',
        indicators_summary: 'H1 momentum aligned',
        support_levels: [
          { price: 3328, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
        ],
        resistance_levels: [
          { price: 3350, type: 'resistance', strength: 'moderate', timeframe: 'H1', touches: 2 },
        ],
        recommendation: 'hold',
        rationale: 'trend continuation',
      },
      riskAssessment: {
        riskLevel: 'medium',
        maxPositionSize: 0.2,
        suggestedSL: 3328,
        warnings: ['trend intact'],
        addOn: true,
      },
      arbitration: {
        final_direction: 'buy',
        confidence: 82,
        primary_contradiction: 'none',
        phase: 'trend-following',
        reasoning: 'multi-timeframe bullish alignment',
        action: 'open',
        united_front_analysis: 'aligned',
      },
      logs: [],
      errors: [],
    } as AnalysisGraphStateType);

    expect(signal?.trade_plan?.add_on).toBe(true);
    expect(TradePlanSchema.parse(signal?.trade_plan).add_on).toBe(true);
  });
});
