import { describe, expect, it } from 'vitest';
import {
  analyzeChanlun,
  buildHubs,
  buildStrokes,
  detectFractals,
  processContainment,
} from './chanlun-core.js';
import type { ChanlunBar, ChanlunFractal } from '../types/analysis.js';

describe('processContainment', () => {
  it('handles containment in an up direction by keeping higher high and higher low', () => {
    const bars: ChanlunBar[] = [
      { index: 0, open: 10, high: 10, low: 8, close: 9 },
      { index: 1, open: 9, high: 12, low: 9, close: 11 },
      { index: 2, open: 11, high: 11, low: 10, close: 10.5 },
      { index: 3, open: 10.5, high: 13, low: 11, close: 12 },
    ];

    const processed = processContainment(bars);

    expect(processed).toHaveLength(3);
    expect(processed[1]).toMatchObject({
      index: 1,
      high: 12,
      low: 10,
    });
  });
});

describe('detectFractals', () => {
  it('detects a top fractal from three processed bars', () => {
    const bars: ChanlunBar[] = [
      { index: 0, open: 10, high: 11, low: 9, close: 10 },
      { index: 1, open: 10, high: 14, low: 10, close: 13 },
      { index: 2, open: 13, high: 12, low: 8, close: 9 },
    ];

    const fractals = detectFractals(bars);

    expect(fractals).toEqual([
      {
        type: 'top',
        index: 1,
        price: 14,
        confirmed: true,
      },
    ]);
  });

  it('detects a bottom fractal from three processed bars', () => {
    const bars: ChanlunBar[] = [
      { index: 0, open: 12, high: 14, low: 10, close: 13 },
      { index: 1, open: 13, high: 12, low: 7, close: 8 },
      { index: 2, open: 8, high: 13, low: 9, close: 12 },
    ];

    const fractals = detectFractals(bars);

    expect(fractals).toEqual([
      {
        type: 'bottom',
        index: 1,
        price: 7,
        confirmed: true,
      },
    ]);
  });
});

describe('buildStrokes', () => {
  it('confirms a stroke when alternating fractals are separated by at least one independent bar', () => {
    const fractals: ChanlunFractal[] = [
      { type: 'top', index: 1, price: 14, confirmed: true },
      { type: 'bottom', index: 3, price: 8, confirmed: true },
    ];

    const strokes = buildStrokes(fractals);

    expect(strokes).toEqual([
      {
        startIndex: 1,
        endIndex: 3,
        startPrice: 14,
        endPrice: 8,
        direction: 'down',
        high: 14,
        low: 8,
      },
    ]);
  });
});

describe('buildHubs', () => {
  it('detects a hub when three consecutive strokes overlap', () => {
    const strokes = [
      { startIndex: 1, endIndex: 3, startPrice: 14, endPrice: 9, direction: 'down', high: 14, low: 9 },
      { startIndex: 3, endIndex: 5, startPrice: 9, endPrice: 13, direction: 'up', high: 13, low: 9 },
      { startIndex: 5, endIndex: 7, startPrice: 13, endPrice: 10, direction: 'down', high: 13, low: 10 },
    ] as const;

    const hubs = buildHubs(strokes);

    expect(hubs).toEqual([
      {
        startIndex: 1,
        endIndex: 7,
        high: 13,
        low: 10,
        strokeIndices: [0, 1, 2],
      },
    ]);
  });
});

describe('analyzeChanlun', () => {
  it('aggregates processed bars, fractals, strokes, and hubs', () => {
    const bars: ChanlunBar[] = [
      { index: 0, open: 10, high: 11, low: 9, close: 10 },
      { index: 1, open: 10, high: 14, low: 10, close: 13 },
      { index: 2, open: 13, high: 12, low: 9, close: 10 },
      { index: 3, open: 10, high: 11, low: 8, close: 9 },
      { index: 4, open: 9, high: 12, low: 9, close: 11 },
      { index: 5, open: 11, high: 13, low: 10, close: 12 },
      { index: 6, open: 12, high: 12, low: 9, close: 10 },
      { index: 7, open: 10, high: 11, low: 7, close: 8 },
      { index: 8, open: 8, high: 11, low: 8, close: 10 },
      { index: 9, open: 10, high: 12, low: 9, close: 11 },
      { index: 10, open: 11, high: 11, low: 8, close: 9 },
      { index: 11, open: 9, high: 10, low: 6, close: 7 },
      { index: 12, open: 7, high: 11, low: 7, close: 10 },
    ];

    const analysis = analyzeChanlun(bars);

    expect(analysis.processedBars.length).toBeGreaterThan(0);
    expect(analysis.fractals.map((fractals) => fractals.type)).toEqual([
      'top',
      'bottom',
      'top',
      'bottom',
      'top',
      'bottom',
    ]);
    expect(analysis.strokes).toHaveLength(5);
    expect(analysis.hubs.length).toBeGreaterThan(0);
    expect(analysis.hubs[0]).toMatchObject({
      high: 13,
      low: 8,
    });
  });
});
