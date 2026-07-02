import { describe, expect, it } from 'vitest';
import { EA_STRATEGY_NAMES, isEaStrategyName } from './strategy.js';

describe('EA strategy names', () => {
  it('freezes the EA-recognized strategy name list', () => {
    expect(EA_STRATEGY_NAMES).toEqual([
      'pullback',
      'breakout_retest',
      'divergence',
      'breakout_pyramid',
      'counter_pullback',
      'range',
      'momentum_scalp',
      'ai_signal'
    ]);
  });

  it('rejects internal or invented strategy names', () => {
    expect(isEaStrategyName('pullback')).toBe(true);
    expect(isEaStrategyName('scale_in')).toBe(false);
    expect(isEaStrategyName('smc')).toBe(false);
    expect(isEaStrategyName('')).toBe(false);
  });
});
