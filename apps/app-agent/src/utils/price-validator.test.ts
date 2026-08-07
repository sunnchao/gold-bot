import { describe, expect, it } from 'vitest';
import { getSymbolProfile } from '../config/symbol-profile.js';
import type { TradeRecommendation } from '../types/analysis.js';
import { validateTradeRecommendation } from './price-validator.js';

function tradeWithTargets(takeProfit1: number, takeProfit2?: number): TradeRecommendation {
  return {
    direction: 'sell',
    entry_price: 4290,
    stop_loss: 4295,
    take_profit_1: takeProfit1,
    take_profit_2: takeProfit2,
    risk_reward_ratio: 0,
    position_size_lots: '0.1',
    rationale: 'test',
  };
}

describe('validateTradeRecommendation risk/reward calculation', () => {
  it('uses TP2 as the reward target when TP2 is present', () => {
    const result = validateTradeRecommendation(
      tradeWithTargets(4260, 4250),
      4290,
      getSymbolProfile('XAUUSD'),
    );

    expect(result.fixedTrade?.risk_reward_ratio).toBe(8);
  });

  it('falls back to TP1 when TP2 is absent or zero', () => {
    const withoutTp2 = validateTradeRecommendation(
      tradeWithTargets(4260),
      4290,
      getSymbolProfile('XAUUSD'),
    );
    const zeroTp2 = validateTradeRecommendation(
      tradeWithTargets(4260, 0),
      4290,
      getSymbolProfile('XAUUSD'),
    );

    expect(withoutTp2.fixedTrade?.risk_reward_ratio).toBe(6);
    expect(zeroTp2.fixedTrade?.risk_reward_ratio).toBe(6);
  });
});
