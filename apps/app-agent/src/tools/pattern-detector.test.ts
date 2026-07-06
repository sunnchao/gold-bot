import { describe, expect, it } from 'vitest';
import {
  detectChannel,
  detectTriangle,
  detectWedge,
  linearRegression,
} from './pattern-detector.js';

function buildSeries(
  length: number,
  highAt: (index: number) => number,
  lowAt: (index: number) => number,
  closeAt?: (index: number, high: number, low: number) => number,
  volumeAt?: (index: number) => number,
) {
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];

  for (let index = 0; index < length; index++) {
    const high = highAt(index);
    const low = lowAt(index);
    highs.push(high);
    lows.push(low);
    closes.push(closeAt ? closeAt(index, high, low) : (high + low) / 2);
    volumes.push(volumeAt ? volumeAt(index) : 1000);
  }

  return { highs, lows, closes, volumes };
}

describe('linearRegression', () => {
  it('fits a simple upward sloping line', () => {
    const result = linearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: 14 },
      { x: 3, y: 16 },
    ]);

    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(10);
  });
});

describe('detectWedge', () => {
  it('detects a rising wedge with bearish breakout confirmation', () => {
    const series = buildSeries(
      20,
      (index) => 110 + index * 0.6,
      (index) => 100 + index * 0.9,
      (index, high, low) => {
        if (index === 19) {
          return low - 0.6;
        }
        return low + (high - low) * 0.45;
      },
      (index) => 2000 - index * 45,
    );

    const patterns = detectWedge(
      series.highs,
      series.lows,
      series.closes,
      series.volumes,
      20,
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.type).toBe('rising_wedge');
    expect(patterns[0]?.direction).toBe('bearish');
    expect(patterns[0]?.breakoutPrice).not.toBeNull();
    expect(patterns[0]?.lowerLine.slope).toBeGreaterThan(patterns[0]!.upperLine.slope);
  });

  it('detects a falling wedge with bullish breakout confirmation', () => {
    const series = buildSeries(
      20,
      (index) => 120 - index * 0.9,
      (index) => 108 - index * 0.6,
      (index, high, low) => {
        if (index === 19) {
          return high + 0.6;
        }
        return low + (high - low) * 0.55;
      },
      (index) => 1800 - index * 35,
    );

    const patterns = detectWedge(
      series.highs,
      series.lows,
      series.closes,
      series.volumes,
      20,
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.type).toBe('falling_wedge');
    expect(patterns[0]?.direction).toBe('bullish');
    expect(patterns[0]?.breakoutPrice).not.toBeNull();
    expect(Math.abs(patterns[0]!.upperLine.slope)).toBeGreaterThan(
      Math.abs(patterns[0]!.lowerLine.slope),
    );
  });
});

describe('detectChannel', () => {
  it('detects an ascending channel when trend lines are parallel', () => {
    const series = buildSeries(
      24,
      (index) => 130 + index * 0.7,
      (index) => 120 + index * 0.68,
      (index, high, low) => low + (high - low) * 0.6,
    );

    const patterns = detectChannel(series.highs, series.lows, 24);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.type).toBe('ascending_channel');
    expect(patterns[0]?.direction).toBe('bullish');
    expect(Math.abs(patterns[0]!.upperLine.slope - patterns[0]!.lowerLine.slope)).toBeLessThan(0.1);
  });
});

describe('detectTriangle', () => {
  it('detects a symmetrical triangle', () => {
    const series = buildSeries(
      24,
      (index) => 145 - index * 0.5,
      (index) => 120 + index * 0.5,
      (index, high, low) => low + (high - low) * 0.5,
    );

    const patterns = detectTriangle(series.highs, series.lows, series.closes, 24);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.type).toBe('symmetrical');
    expect(patterns[0]?.direction).toBe('continuation');
    expect(patterns[0]?.apexPrice).not.toBeNull();
  });
});
