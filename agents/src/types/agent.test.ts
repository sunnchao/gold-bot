import { describe, it, expect } from 'vitest';
import { createInitialState, type AnalysisState } from '../types/agent.js';
import type { GoldbotPayload } from '../types/goldbot.js';
import type { TechnicalAnalysis, SRLevels, ArbitrationResult, RiskAssessment } from '../types/analysis.js';

describe('createInitialState', () => {
  it('should create a valid initial state', () => {
    const state = createInitialState('acc-001', 'XAUUSD');

    expect(state.accountId).toBe('acc-001');
    expect(state.symbol).toBe('XAUUSD');
    expect(state.timestamp).toBeDefined();
    expect(state.logs).toEqual([]);
    expect(state.errors).toEqual([]);
    expect(state.payload).toBeUndefined();
    expect(state.technicalAnalysis).toBeUndefined();
  });

  it('should have ISO timestamp', () => {
    const state = createInitialState('acc-001', 'XAUUSD');
    expect(() => new Date(state.timestamp)).not.toThrow();
    expect(new Date(state.timestamp).toISOString()).toBe(state.timestamp);
  });
});

describe('AnalysisState types', () => {
  it('should allow setting all optional fields', () => {
    const state = createInitialState('acc-001', 'XAUUSD');

    // Verify the state can hold all optional fields
    const payload: GoldbotPayload = {
      market: {
        symbol: 'XAUUSD',
        timeframe: 'H1',
        currentPrice: 2350.50,
        bid: 2350.30,
        ask: 2350.70,
        spread: 0.40,
        bars: [],
        indicators: {
          ema20: 2348,
          ema50: 2340,
          rsi: 55,
          macd: 1.2,
          macdSignal: 0.8,
          macdHist: 0.4,
          adx: 25,
          bbUpper: 2360,
          bbMiddle: 2350,
          bbLower: 2340,
          atr: 15,
          stochK: 65,
          stochD: 60,
        },
      },
      account: {
        id: 'acc-001',
        balance: 10000,
        equity: 10050,
        margin: 500,
        free_margin: 9550,
        leverage: 100,
        currency: 'USD',
      },
      indicators: {
        ema20: 2348,
        ema50: 2340,
        rsi: 55,
        macd: 1.2,
        macdSignal: 0.8,
        macdHist: 0.4,
        adx: 25,
        bbUpper: 2360,
        bbMiddle: 2350,
        bbLower: 2340,
        atr: 15,
        stochK: 65,
        stochD: 60,
      },
      positions: [],
      market_status: {
        market_open: true,
        session: 'London',
        isHighImpactNews: false,
      },
      strategy_mapping: {
        strategyId: 'default',
        strategyName: 'Default Strategy',
        parameters: {},
      },
    };

    state.payload = payload;
    state.technicalAnalysis = {
      bias: 'bullish',
      confidence: 75,
      phase: 'trending',
      indicators_summary: 'Multi-timeframe bullish alignment',
      support_levels: [
        { price: 2340, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
      ],
      resistance_levels: [
        { price: 2360, type: 'resistance', strength: 'moderate', timeframe: 'H4', touches: 2 },
      ],
      recommendation: 'hold',
      rationale: 'Multi-timeframe bullish alignment',
    };

    expect(state.payload.market.symbol).toBe('XAUUSD');
    expect(state.technicalAnalysis.bias).toBe('bullish');
  });
});
