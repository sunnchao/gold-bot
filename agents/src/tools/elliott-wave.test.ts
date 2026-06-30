import { describe, expect, it } from 'vitest';
import {
  detectSwingPoints,
  labelCorrectiveWaves,
  labelImpulseWaves,
  validateWaveRules,
} from './elliott-wave.js';
import type { ElliottWaveSegment, ElliottWaveSwingPoint } from '../types/analysis.js';

describe('detectSwingPoints', () => {
  it('detects alternating swing highs and lows with zigzag filtering', () => {
    const prices = [100, 105, 102, 110, 106, 114, 109, 118, 112];

    const swings = detectSwingPoints(prices, 0.02);

    expect(swings.map((swing) => swing.type)).toEqual([
      'low',
      'high',
      'low',
      'high',
      'low',
      'high',
      'low',
      'high',
      'low',
    ]);
    expect(swings[1]?.price).toBe(105);
    expect(swings[2]?.price).toBe(102);
  });
});

describe('labelImpulseWaves', () => {
  it('labels a bullish five-wave impulse from alternating swing points', () => {
    const swings: ElliottWaveSwingPoint[] = [
      { index: 0, price: 100, type: 'low' },
      { index: 1, price: 110, type: 'high' },
      { index: 2, price: 104, type: 'low' },
      { index: 3, price: 124, type: 'high' },
      { index: 4, price: 116, type: 'low' },
      { index: 5, price: 136, type: 'high' },
    ];

    const waves = labelImpulseWaves(swings, 'bullish');

    expect(waves).toHaveLength(5);
    expect(waves.map((wave) => wave.wave)).toEqual([1, 2, 3, 4, 5]);
    expect(waves.map((wave) => wave.direction)).toEqual(['up', 'down', 'up', 'down', 'up']);
    expect(waves[2]?.length).toBeGreaterThan(waves[0]!.length);
  });
});

describe('validateWaveRules', () => {
  it('rejects an impulse when wave 3 is the shortest motive wave', () => {
    const impulse: ElliottWaveSegment[] = [
      { wave: 1, startIndex: 0, endIndex: 1, startPrice: 100, endPrice: 112, direction: 'up', length: 12 },
      { wave: 2, startIndex: 1, endIndex: 2, startPrice: 112, endPrice: 106, direction: 'down', length: 6 },
      { wave: 3, startIndex: 2, endIndex: 3, startPrice: 106, endPrice: 114, direction: 'up', length: 8 },
      { wave: 4, startIndex: 3, endIndex: 4, startPrice: 114, endPrice: 113, direction: 'down', length: 1 },
      { wave: 5, startIndex: 4, endIndex: 5, startPrice: 113, endPrice: 130, direction: 'up', length: 17 },
    ];

    const validation = validateWaveRules(impulse, 'bullish');

    expect(validation.isValid).toBe(false);
    expect(validation.violations).toContain('Wave 3 cannot be the shortest motive wave.');
  });
});

describe('labelCorrectiveWaves', () => {
  it('labels an ABC correction after a bullish impulse', () => {
    const swings: ElliottWaveSwingPoint[] = [
      { index: 0, price: 100, type: 'low' },
      { index: 1, price: 110, type: 'high' },
      { index: 2, price: 104, type: 'low' },
      { index: 3, price: 124, type: 'high' },
      { index: 4, price: 116, type: 'low' },
      { index: 5, price: 136, type: 'high' },
      { index: 6, price: 126, type: 'low' },
      { index: 7, price: 131, type: 'high' },
      { index: 8, price: 120, type: 'low' },
    ];

    const waves = labelCorrectiveWaves(swings, 'bullish', 5);

    expect(waves).toHaveLength(3);
    expect(waves.map((wave) => wave.wave)).toEqual(['A', 'B', 'C']);
    expect(waves.map((wave) => wave.direction)).toEqual(['down', 'up', 'down']);
  });
});
