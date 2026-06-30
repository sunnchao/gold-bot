import { describe, expect, it } from 'vitest';
import { calculateFibonacciExtensions } from './sr-calculator.js';

describe('calculateFibonacciExtensions', () => {
  it('calculates bullish extension levels above retracement end', () => {
    const levels = calculateFibonacciExtensions(100, 150, 130, 'bullish');

    expect(levels.level_1_272).toBeCloseTo(193.6);
    expect(levels.level_1_618).toBeCloseTo(210.9);
    expect(levels.level_2_0).toBeCloseTo(230);
    expect(levels.level_2_618).toBeCloseTo(260.9);
  });

  it('calculates bearish extension levels below retracement end', () => {
    const levels = calculateFibonacciExtensions(150, 100, 120, 'bearish');

    expect(levels.level_1_272).toBeCloseTo(56.4);
    expect(levels.level_1_618).toBeCloseTo(39.1);
    expect(levels.level_2_0).toBeCloseTo(20);
    expect(levels.level_2_618).toBeCloseTo(-10.9);
  });
});
