import { describe, it, expect } from 'vitest';
import type { GoldbotPayload, IndicatorPack, MarketData, AccountInfo, PositionInfo, MarketStatus } from '../types/goldbot.js';
import type { TechnicalAnalysis, SRLevels, ArbitrationResult, RiskAssessment } from '../types/analysis.js';

describe('Goldbot types', () => {
  it('should define IndicatorPack with all required fields', () => {
    const indicators: IndicatorPack = {
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
    };
    expect(indicators.ema20).toBe(2348);
    expect(indicators.rsi).toBe(55);
    expect(indicators.adx).toBe(25);
  });

  it('should define MarketData with bars', () => {
    const market: MarketData = {
      symbol: 'XAUUSD',
      timeframe: 'H1',
      currentPrice: 2350.50,
      bid: 2350.30,
      ask: 2350.70,
      spread: 0.40,
      bars: [
        { time: '2026-05-01T08:00:00Z', open: 2348, high: 2352, low: 2347, close: 2351, volume: 1000 },
      ],
      indicators: {
        ema20: 2348, ema50: 2340, rsi: 55, macd: 1.2, macdSignal: 0.8, macdHist: 0.4,
        adx: 25, bbUpper: 2360, bbMiddle: 2350, bbLower: 2340, atr: 15, stochK: 65, stochD: 60,
      },
    };
    expect(market.bars).toHaveLength(1);
    expect(market.bars[0].close).toBe(2351);
  });
});

describe('Analysis types', () => {
  it('should define TechnicalAnalysis with all timeframes', () => {
    const ta: TechnicalAnalysis = {
      bias: 'bullish',
      confidence: 75,
      phase: 'trending',
      indicators_summary: 'Multi-TF bullish alignment with H4 consolidation',
      support_levels: [
        { price: 2340, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 },
      ],
      resistance_levels: [
        { price: 2360, type: 'resistance', strength: 'moderate', timeframe: 'H4', touches: 2 },
      ],
      recommendation: 'hold',
      rationale: 'Multi-TF bullish alignment with H4 consolidation',
    };
    expect(ta.bias).toBe('bullish');
    expect(ta.support_levels).toHaveLength(1);
  });

  it('should define RiskAssessment with warnings', () => {
    const risk: RiskAssessment = {
      riskLevel: 'medium',
      maxPositionSize: 0.1,
      suggestedSL: 2330,
      warnings: ['High spread detected', 'News event in 30min'],
    };
    expect(risk.warnings).toHaveLength(2);
  });

  it('should define ArbitrationResult', () => {
    const arb: ArbitrationResult = {
      final_direction: 'buy',
      confidence: 70,
      primary_contradiction: 'none',
      phase: 'trending',
      reasoning: 'All timeframes aligned bullish',
      action: 'open',
      united_front_analysis: 'Strong consensus across timeframes',
    };
    expect(arb.final_direction).toBe('buy');
    expect(arb.action).toBe('open');
  });
});
