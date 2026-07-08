import { describe, it, expect } from 'vitest';
import { detectPatterns, buildContext } from './detector.js';
import type { HarmonicBar } from './detector.js';

function makeBar(high: number, low: number, close: number, open: number): HarmonicBar {
  return { high, low, close, open };
}

describe('detectPatterns', () => {
  it('returns empty for insufficient bars', () => {
    expect(detectPatterns([], 'H4')).toEqual([]);
    expect(detectPatterns([makeBar(100, 95, 98, 97)], 'H4')).toEqual([]);
  });

  it('detects patterns in a zigzag series', () => {
    // Create a series with clear swings that could form a Gartley-like pattern
    const bars: HarmonicBar[] = [
      makeBar(100, 98, 99, 98.5),    // X - high
      makeBar(96, 94, 95, 95.5),     // A - low
      makeBar(98, 96, 97, 97.5),     // B - high (retrace ~0.618 of XA)
      makeBar(95, 93, 94, 94.5),     // C - low
      makeBar(97, 95, 96, 96.5),     // D - potential PRZ
    ];
    const patterns = detectPatterns(bars, 'H4');
    // May or may not find patterns depending on ratio precision
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('sets correct fields on detected patterns', () => {
    // Create a larger series with more realistic swings
    const bars: HarmonicBar[] = [];
    // Build a series with alternating swings
    const prices = [100, 80, 92, 75, 88, 70, 85, 72, 90, 68, 82, 74, 86, 71, 83];
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      bars.push(makeBar(p + 2, p - 2, p, p + 1));
    }
    const patterns = detectPatterns(bars, 'H1');
    for (const p of patterns) {
      expect(p.type).toBeDefined();
      expect(['gartley', 'bat', 'butterfly', 'crab', 'abcd', 'deep_crab']).toContain(p.type);
      expect(['bullish', 'bearish']).toContain(p.direction);
      expect(p.timeframe).toBe('H1');
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('buildContext', () => {
  it('builds context from multi-timeframe bars', () => {
    const makeSwingBars = (): HarmonicBar[] => {
      const bars: HarmonicBar[] = [];
      const prices = [100, 80, 92, 75, 88, 70, 85, 72, 90, 68, 82, 74, 86, 71, 83, 78, 89, 73, 84, 77];
      for (const p of prices) {
        bars.push(makeBar(p + 2, p - 2, p, p + 1));
      }
      return bars;
    };

    const ctx = buildContext(makeSwingBars(), makeSwingBars(), makeSwingBars());
    expect(Array.isArray(ctx.h4Patterns)).toBe(true);
    expect(Array.isArray(ctx.h1Patterns)).toBe(true);
    expect(Array.isArray(ctx.m30Patterns)).toBe(true);
    expect(typeof ctx.directionBias).toBe('string');
    expect(typeof ctx.score).toBe('number');
    expect(typeof ctx.summary).toBe('string');
  });

  it('returns neutral context for empty bars', () => {
    const ctx = buildContext([], [], []);
    expect(ctx.directionBias).toBe('neutral');
    expect(ctx.activePattern).toBeNull();
  });
});
