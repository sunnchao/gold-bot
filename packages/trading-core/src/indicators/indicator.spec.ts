import { describe, expect, it } from 'vitest';
import {
  adx,
  atr,
  bollinger,
  calculateFibExtension,
  detectMacdDivergence,
  detectRsiDivergence,
  ema,
  fibonacci,
  isPriceInFibZone,
  macd,
  pivotPoints,
  rsi,
  stoch,
  type IndicatorBar
} from './index.js';

const closes = [
  4430, 4433, 4438, 4435, 4437, 4442, 4440, 4444, 4441, 4448, 4450, 4446, 4452, 4455, 4451, 4458, 4460,
  4457, 4462, 4465
];

function expectTailClose(label: string, got: number[], wantTail: number[], tolerance = 1e-9) {
  const start = got.length - wantTail.length;
  for (let i = 0; i < wantTail.length; i += 1) {
    const gotValue = got[start + i];
    const want = wantTail[i];
    if (Number.isNaN(want)) {
      expect(Number.isNaN(gotValue), `${label} tail[${i}]`).toBe(true);
      continue;
    }
    expect(Math.abs(gotValue - want), `${label} tail[${i}]`).toBeLessThanOrEqual(tolerance);
  }
}

describe('indicator parity with Go oracle', () => {
  it('matches Go EMA20 fixture tail', () => {
    expectTailClose('EMA20', ema(closes, 20), [
      4442.15241473154,
      4443.661708566632,
      4445.217736322191,
      4446.339856672458,
      4447.831298894129,
      4449.466413285164
    ]);
  });

  it('matches Go ATR14 fixture tail', () => {
    const highs = closes.map((close) => close + 2.5);
    const lows = closes.map((close) => close - 2.0);

    expectTailClose('ATR14', atr(highs, lows, closes, 14), [
      6.033163265306,
      6.280794460641,
      6.15359485631,
      6.071195223716,
      6.173252707737,
      6.125163228613
    ]);
  });

  it('matches Go RSI14 fixture tail', () => {
    expectTailClose('RSI14', rsi(closes, 14), [
      69.408369408369,
      73.451497928909,
      74.488931294992,
      70.066064531286,
      72.948963703115,
      74.533735777533
    ]);
  });

  it('matches Go MACD output shape and baseline values', () => {
    const result = macd(closes);

    expect(result.macd).toHaveLength(closes.length);
    expect(result.signal).toHaveLength(closes.length);
    expect(result.histogram).toHaveLength(closes.length);
    expectTailClose('MACD', result.macd, [
      5.542436875906,
      6.102989394834,
      6.632163141631,
      6.731861511441,
      7.132116798198,
      7.603745677586
    ]);
    expectTailClose('MACD signal', result.signal, [
      4.095213190849,
      4.496768431646,
      4.923847373643,
      5.285450201203,
      5.654783520602,
      6.044575951999
    ]);
    expectTailClose('MACD histogram', result.histogram, [
      1.447223685057,
      1.606220963188,
      1.708315767988,
      1.446411310238,
      1.477333277596,
      1.559169725587
    ]);
  });

  it('matches Go Fibonacci helpers', () => {
    expect(fibonacci([100, 103, 108], [90, 94, 95], 3)).toEqual({
      fib236: 103.752,
      fib382: 101.124,
      fib500: 99,
      fib618: 96.876,
      fib786: 93.852
    });
    expect(calculateFibExtension(100, 80, 'UP')).toEqual({
      level1272: 125.44,
      level1618: 132.36,
      level2618: 152.36
    });
    expect(calculateFibExtension(80, 100, 'DOWN')).toEqual({
      level1272: 74.56,
      level1618: 67.64,
      level2618: 47.64
    });
    expect(isPriceInFibZone(92, 92.36, 87.64, 2, 0.1)).toBe(true);
    expect(isPriceInFibZone(96, 92.36, 87.64, 2, 0.1)).toBe(false);
  });

  it('matches Go classic pivot points', () => {
    expect(pivotPoints(108, 94, 107)).toEqual({
      pp: 103,
      r1: 112,
      r2: 117,
      r3: 126,
      s1: 98,
      s2: 89,
      s3: 84
    });
  });

  it('matches Go ADX simple-moving-average implementation', () => {
    const highs = [10, 12, 13, 15, 16, 18];
    const lows = [8, 9, 10, 11, 12, 13];
    const close = [9, 11, 12, 14, 15, 17];

    const result = adx(highs, lows, close, 3);

    expectTailClose('ADX3', result, [100, 100], 1e-9);
    expect(result.slice(0, 4).every(Number.isNaN)).toBe(true);
  });

  it('matches Go Bollinger bands with sample standard deviation', () => {
    const result = bollinger([1, 2, 3, 4, 5], 3, 2);

    expectTailClose('Bollinger upper', result.upper, [4, 5, 6]);
    expectTailClose('Bollinger mid', result.mid, [2, 3, 4]);
    expectTailClose('Bollinger lower', result.lower, [0, 1, 2]);
    expect(result.upper.slice(0, 2).every(Number.isNaN)).toBe(true);
  });

  it('matches Go stochastic K and D smoothing', () => {
    const result = stoch([10, 11, 12, 13, 14], [5, 6, 7, 8, 9], [7, 10, 11, 12, 13], 3, 2);

    expectTailClose('Stoch K', result.k, [85.714285714286, 85.714285714286, 85.714285714286]);
    expectTailClose('Stoch D', result.d, [Number.NaN, 85.714285714286, 85.714285714286]);
  });

  it('detects the same bearish RSI divergence shape as Go oracle test', () => {
    const bars: IndicatorBar[] = Array.from({ length: 20 }, (_, i) => ({
      time: 'test',
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100.5 + i * 0.1,
      rsi: 50 + i * 0.5
    }));
    bars[5].high = 110;
    bars[5].rsi = 75;
    bars[15].high = 112;
    bars[15].rsi = 73;

    expect(detectRsiDivergence(bars)).toEqual({
      type: 'bearish_rsi',
      strength: 'weak',
      confidence: 0.6,
      priceLevel: 112,
      time: 'test'
    });
  });

  it('matches Go MACD divergence no-signal behavior for monotonic sample', () => {
    const bars: IndicatorBar[] = Array.from({ length: 20 }, (_, i) => ({
      time: 'test',
      open: 100 + i * 0.1,
      high: 101 + i * 0.1,
      low: 99 + i * 0.1,
      close: 100.5 + i * 0.1,
      macdHist: i * 0.1
    }));

    expect(detectMacdDivergence(bars)).toBeNull();
  });
});
