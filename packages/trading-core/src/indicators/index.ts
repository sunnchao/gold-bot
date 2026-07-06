export type MacdResult = {
  macd: number[];
  signal: number[];
  histogram: number[];
};

export type FibLevels = {
  fib236: number;
  fib382: number;
  fib500: number;
  fib618: number;
  fib786: number;
};

export type FibExtension = {
  level1272: number;
  level1618: number;
  level2618: number;
};

export type PivotLevels = {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export type BollingerBands = {
  upper: number[];
  mid: number[];
  lower: number[];
};

export type StochasticResult = {
  k: number[];
  d: number[];
};

export type IndicatorBar = {
  time?: string;
  open?: number;
  high: number;
  low: number;
  close?: number;
  macdHist?: number;
  rsi?: number;
};

export type DivergenceType = 'bullish_macd' | 'bearish_macd' | 'bullish_rsi' | 'bearish_rsi';

export type DivergenceSignal = {
  type: DivergenceType;
  strength: 'strong' | 'moderate' | 'weak';
  confidence: number;
  priceLevel: number;
  time: string;
};

export function ema(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(0);
  if (values.length === 0 || period <= 0) {
    return out;
  }

  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function atr(high: readonly number[], low: readonly number[], close: readonly number[], period: number): number[] {
  const tr = Array<number>(close.length).fill(0);
  for (let i = 0; i < close.length; i += 1) {
    if (i === 0) {
      tr[i] = high[i] - low[i];
      continue;
    }
    tr[i] = Math.max(high[i] - low[i], Math.max(Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  return wildersSmoothing(tr, period);
}

export function rsi(close: readonly number[], period: number): number[] {
  const out = Array<number>(close.length).fill(Number.NaN);
  if (close.length === 0 || period <= 0) {
    return out;
  }

  const gains = Array<number>(close.length).fill(0);
  const losses = Array<number>(close.length).fill(0);
  for (let i = 1; i < close.length; i += 1) {
    const delta = close[i] - close[i - 1];
    if (delta > 0) {
      gains[i] = delta;
    } else if (delta < 0) {
      losses[i] = -delta;
    }
  }

  const avgGain = wildersSmoothing(gains, period);
  const avgLoss = wildersSmoothing(losses, period);
  for (let i = 0; i < close.length; i += 1) {
    if (Number.isNaN(avgGain[i]) || Number.isNaN(avgLoss[i]) || avgLoss[i] === 0) {
      continue;
    }
    const rs = avgGain[i] / avgLoss[i];
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function macd(close: readonly number[]): MacdResult {
  const ema12 = ema(close, 12);
  const ema26 = ema(close, 26);
  const macdLine = close.map((_, index) => ema12[index] - ema26[index]);
  const signal = ema(macdLine, 9);
  const histogram = close.map((_, index) => macdLine[index] - signal[index]);
  return { macd: macdLine, signal, histogram };
}

export function fibonacci(highs: readonly number[], lows: readonly number[], window: number): FibLevels {
  if (highs.length < window || lows.length < window || window < 2) {
    return { fib236: 0, fib382: 0, fib500: 0, fib618: 0, fib786: 0 };
  }

  let swingHigh = highs[0];
  let swingLow = lows[0];
  for (let i = 1; i < window && i < highs.length; i += 1) {
    if (highs[i] > swingHigh) {
      swingHigh = highs[i];
    }
    if (lows[i] < swingLow) {
      swingLow = lows[i];
    }
  }

  const diff = swingHigh - swingLow;
  return {
    fib236: swingHigh - diff * 0.236,
    fib382: swingHigh - diff * 0.382,
    fib500: swingHigh - diff * 0.5,
    fib618: swingHigh - diff * 0.618,
    fib786: swingHigh - diff * 0.786
  };
}

export function calculateFibExtension(swingHigh: number, swingLow: number, trend: 'UP' | 'DOWN' | string): FibExtension {
  const diff = Math.abs(swingHigh - swingLow);
  if (trend === 'UP') {
    return {
      level1272: round2(swingHigh + diff * 1.272),
      level1618: round2(swingHigh + diff * 1.618),
      level2618: round2(swingHigh + diff * 2.618)
    };
  }
  return {
    level1272: round2(swingLow - diff * 1.272),
    level1618: round2(swingLow - diff * 1.618),
    level2618: round2(swingLow - diff * 2.618)
  };
}

export function isPriceInFibZone(price: number, fib382: number, fib618: number, atrValue: number, bufferATR: number): boolean {
  const buffer = atrValue * bufferATR;
  const low = Math.min(fib382, fib618);
  const high = Math.max(fib382, fib618);
  return price >= low - buffer && price <= high + buffer;
}

export function pivotPoints(prevHigh: number, prevLow: number, prevClose: number): PivotLevels {
  const pp = (prevHigh + prevLow + prevClose) / 3;
  return {
    pp,
    r1: 2 * pp - prevLow,
    r2: pp + (prevHigh - prevLow),
    r3: prevHigh + 2 * (pp - prevLow),
    s1: 2 * pp - prevHigh,
    s2: pp - (prevHigh - prevLow),
    s3: prevLow - 2 * (prevHigh - pp)
  };
}

export function adx(high: readonly number[], low: readonly number[], close: readonly number[], period: number): number[] {
  const plusDM = Array<number>(close.length).fill(0);
  const minusDM = Array<number>(close.length).fill(0);
  const tr = Array<number>(close.length).fill(0);

  for (let i = 0; i < close.length; i += 1) {
    if (i === 0) {
      tr[i] = high[i] - low[i];
      continue;
    }

    const plusRaw = high[i] - high[i - 1];
    const minusRaw = low[i - 1] - low[i];

    plusDM[i] = plusRaw > minusRaw && plusRaw > 0 ? plusRaw : 0;
    minusDM[i] = minusRaw > plusDM[i] && minusRaw > 0 ? minusRaw : 0;
    tr[i] = Math.max(high[i] - low[i], Math.max(Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }

  const atrMean = rollingMean(tr, period);
  const plusAvg = rollingMean(plusDM, period);
  const minusAvg = rollingMean(minusDM, period);
  const dx = Array<number>(close.length).fill(Number.NaN);

  for (let i = 0; i < close.length; i += 1) {
    if (Number.isNaN(atrMean[i]) || atrMean[i] === 0) {
      continue;
    }
    const plusDI = 100 * (plusAvg[i] / atrMean[i]);
    const minusDI = 100 * (minusAvg[i] / atrMean[i]);
    const denominator = plusDI + minusDI;
    if (denominator === 0) {
      continue;
    }
    dx[i] = 100 * (Math.abs(plusDI - minusDI) / denominator);
  }

  return rollingMean(dx, period);
}

export function bollinger(close: readonly number[], period: number, width: number): BollingerBands {
  const mid = rollingMean(close, period);
  const std = rollingStd(close, period);
  const upper = close.map((_, index) => mid[index] + width * std[index]);
  const lower = close.map((_, index) => mid[index] - width * std[index]);
  return { upper, mid, lower };
}

export function stoch(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
  smooth: number
): StochasticResult {
  const lowN = rollingMin(low, period);
  const highN = rollingMax(high, period);
  const k = Array<number>(close.length).fill(Number.NaN);

  for (let i = 0; i < close.length; i += 1) {
    if (Number.isNaN(lowN[i]) || Number.isNaN(highN[i])) {
      continue;
    }
    const denominator = highN[i] - lowN[i];
    if (denominator === 0) {
      continue;
    }
    k[i] = (100 * (close[i] - lowN[i])) / denominator;
  }

  return { k, d: rollingMean(k, smooth) };
}

export function detectMacdDivergence(bars: readonly IndicatorBar[]): DivergenceSignal | null {
  if (bars.length < 20) {
    return null;
  }

  const recent = bars.slice(-Math.min(20, bars.length));
  const priceLows = findLocalLows(recent, 3);
  const priceHighs = findLocalHighs(recent, 3);
  const macdLows = findMacdLows(recent, 3);
  const macdHighs = findMacdHighs(recent, 3);

  if (priceLows.length >= 2 && macdLows.length >= 2) {
    const pl1 = priceLows[priceLows.length - 2];
    const pl2 = priceLows[priceLows.length - 1];
    const [ml1, ml2] = [findNearestMacdLow(recent, pl1), findNearestMacdLow(recent, pl2)];

    if (ml1 !== -1 && ml2 !== -1 && recent[pl2].low < recent[pl1].low && macdHist(recent[ml2]) >= macdHist(recent[ml1])) {
      return {
        type: 'bullish_macd',
        strength: calculateDivergenceStrength(recent, pl1, pl2, ml1, ml2),
        confidence: calculateConfidence(recent, pl1, pl2, ml1, ml2),
        priceLevel: recent[pl2].low,
        time: recent[pl2].time ?? ''
      };
    }
  }

  if (priceHighs.length >= 2 && macdHighs.length >= 2) {
    const ph1 = priceHighs[priceHighs.length - 2];
    const ph2 = priceHighs[priceHighs.length - 1];
    const [mh1, mh2] = [findNearestMacdHigh(recent, ph1), findNearestMacdHigh(recent, ph2)];

    if (mh1 !== -1 && mh2 !== -1 && recent[ph2].high > recent[ph1].high && macdHist(recent[mh2]) <= macdHist(recent[mh1])) {
      return {
        type: 'bearish_macd',
        strength: calculateDivergenceStrength(recent, ph1, ph2, mh1, mh2),
        confidence: calculateConfidence(recent, ph1, ph2, mh1, mh2),
        priceLevel: recent[ph2].high,
        time: recent[ph2].time ?? ''
      };
    }
  }

  return null;
}

export function detectRsiDivergence(bars: readonly IndicatorBar[]): DivergenceSignal | null {
  if (bars.length < 20) {
    return null;
  }

  const recent = bars.slice(-Math.min(20, bars.length));
  const priceLows = findLocalLows(recent, 3);
  const priceHighs = findLocalHighs(recent, 3);

  if (priceLows.length >= 2) {
    const pl1 = priceLows[priceLows.length - 2];
    const pl2 = priceLows[priceLows.length - 1];
    const rsi1 = rsiValue(recent[pl1]);
    const rsi2 = rsiValue(recent[pl2]);

    if (!Number.isNaN(rsi1) && !Number.isNaN(rsi2) && recent[pl2].low < recent[pl1].low && rsi2 > rsi1) {
      return {
        type: 'bullish_rsi',
        strength: calculateRsiDivergenceStrength(recent, pl1, pl2),
        confidence: calculateRsiConfidence(recent, pl1, pl2),
        priceLevel: recent[pl2].low,
        time: recent[pl2].time ?? ''
      };
    }
  }

  if (priceHighs.length >= 2) {
    const ph1 = priceHighs[priceHighs.length - 2];
    const ph2 = priceHighs[priceHighs.length - 1];
    const rsi1 = rsiValue(recent[ph1]);
    const rsi2 = rsiValue(recent[ph2]);

    if (!Number.isNaN(rsi1) && !Number.isNaN(rsi2) && recent[ph2].high > recent[ph1].high && rsi2 < rsi1) {
      return {
        type: 'bearish_rsi',
        strength: calculateRsiDivergenceStrength(recent, ph1, ph2),
        confidence: calculateRsiConfidence(recent, ph1, ph2),
        priceLevel: recent[ph2].high,
        time: recent[ph2].time ?? ''
      };
    }
  }

  return null;
}

function rollingMean(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) {
    return out;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    let valid = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        continue;
      }
      sum += values[j];
      valid += 1;
    }
    if (valid === period) {
      out[i] = sum / period;
    }
  }

  return out;
}

function rollingMin(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) {
    return out;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    let minValue = Number.POSITIVE_INFINITY;
    let valid = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        continue;
      }
      minValue = Math.min(minValue, values[j]);
      valid += 1;
    }
    if (valid === period) {
      out[i] = minValue;
    }
  }

  return out;
}

function rollingMax(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) {
    return out;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    let maxValue = Number.NEGATIVE_INFINITY;
    let valid = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        continue;
      }
      maxValue = Math.max(maxValue, values[j]);
      valid += 1;
    }
    if (valid === period) {
      out[i] = maxValue;
    }
  }

  return out;
}

function rollingStd(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) {
    return out;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    let valid = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        continue;
      }
      sum += values[j];
      valid += 1;
    }
    if (valid !== period || period === 1) {
      continue;
    }

    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = values[j] - mean;
      variance += diff * diff;
    }
    out[i] = Math.sqrt(variance / (period - 1));
  }

  return out;
}

function wildersSmoothing(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (values.length < period || period <= 0) {
    return out;
  }

  let sum = 0;
  for (let i = 0; i < period; i += 1) {
    sum += values[i];
  }
  out[period - 1] = sum / period;

  for (let i = period; i < values.length; i += 1) {
    if (Number.isNaN(values[i])) {
      out[i] = out[i - 1];
      continue;
    }
    out[i] = out[i - 1] * ((period - 1) / period) + values[i] / period;
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function findLocalLows(bars: readonly IndicatorBar[], minBars: number): number[] {
  const lows: number[] = [];
  for (let i = minBars; i < bars.length - minBars; i += 1) {
    let isLow = true;
    for (let j = i - minBars; j <= i + minBars; j += 1) {
      if (j !== i && bars[j].low <= bars[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      lows.push(i);
    }
  }
  return lows;
}

function findLocalHighs(bars: readonly IndicatorBar[], minBars: number): number[] {
  const highs: number[] = [];
  for (let i = minBars; i < bars.length - minBars; i += 1) {
    let isHigh = true;
    for (let j = i - minBars; j <= i + minBars; j += 1) {
      if (j !== i && bars[j].high >= bars[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      highs.push(i);
    }
  }
  return highs;
}

function findMacdLows(bars: readonly IndicatorBar[], minBars: number): number[] {
  const lows: number[] = [];
  for (let i = minBars; i < bars.length - minBars; i += 1) {
    if (Number.isNaN(macdHist(bars[i]))) {
      continue;
    }
    let isLow = true;
    for (let j = i - minBars; j <= i + minBars; j += 1) {
      if (j !== i && !Number.isNaN(macdHist(bars[j])) && macdHist(bars[j]) <= macdHist(bars[i])) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      lows.push(i);
    }
  }
  return lows;
}

function findMacdHighs(bars: readonly IndicatorBar[], minBars: number): number[] {
  const highs: number[] = [];
  for (let i = minBars; i < bars.length - minBars; i += 1) {
    if (Number.isNaN(macdHist(bars[i]))) {
      continue;
    }
    let isHigh = true;
    for (let j = i - minBars; j <= i + minBars; j += 1) {
      if (j !== i && !Number.isNaN(macdHist(bars[j])) && macdHist(bars[j]) >= macdHist(bars[i])) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      highs.push(i);
    }
  }
  return highs;
}

function findNearestMacdLow(bars: readonly IndicatorBar[], idx: number): number {
  let best = -1;
  let bestDist = 999;
  for (let i = 0; i < bars.length; i += 1) {
    if (Number.isNaN(macdHist(bars[i]))) {
      continue;
    }
    let isLow = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(bars.length - 1, i + 2); j += 1) {
      if (j !== i && !Number.isNaN(macdHist(bars[j])) && macdHist(bars[j]) <= macdHist(bars[i])) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      const dist = Math.abs(i - idx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
  }
  return best;
}

function findNearestMacdHigh(bars: readonly IndicatorBar[], idx: number): number {
  let best = -1;
  let bestDist = 999;
  for (let i = 0; i < bars.length; i += 1) {
    if (Number.isNaN(macdHist(bars[i]))) {
      continue;
    }
    let isHigh = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(bars.length - 1, i + 2); j += 1) {
      if (j !== i && !Number.isNaN(macdHist(bars[j])) && macdHist(bars[j]) >= macdHist(bars[i])) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      const dist = Math.abs(i - idx);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
  }
  return best;
}

function calculateDivergenceStrength(bars: readonly IndicatorBar[], p1: number, p2: number, m1: number, m2: number): 'strong' | 'moderate' | 'weak' {
  const priceDiff = Math.abs(bars[p2].low - bars[p1].low);
  const macdDiff = Math.abs(macdHist(bars[m2]) - macdHist(bars[m1]));
  const ratio = priceDiff / (macdDiff + 0.0001);
  if (ratio > 3) {
    return 'strong';
  }
  if (ratio > 1.5) {
    return 'moderate';
  }
  return 'weak';
}

function calculateRsiDivergenceStrength(bars: readonly IndicatorBar[], p1: number, p2: number): 'strong' | 'moderate' | 'weak' {
  const diff = Math.abs(rsiValue(bars[p2]) - rsiValue(bars[p1]));
  if (diff > 10) {
    return 'strong';
  }
  if (diff > 5) {
    return 'moderate';
  }
  return 'weak';
}

function calculateConfidence(bars: readonly IndicatorBar[], p1: number, p2: number, m1: number, m2: number): number {
  let score = 0.5;
  const priceDiff = Math.abs(bars[p2].low - bars[p1].low) / bars[p1].low;
  if (priceDiff > 0.01) {
    score += 0.1;
  }
  const macdDiff = Math.abs(macdHist(bars[m2]) - macdHist(bars[m1]));
  if (!Number.isNaN(macdDiff) && macdDiff > 0.1) {
    score += 0.1;
  }
  if (p2 > p1 && p2 - p1 > 5) {
    score += 0.1;
  }
  return Math.min(score, 1);
}

function calculateRsiConfidence(bars: readonly IndicatorBar[], p1: number, p2: number): number {
  let score = 0.5;
  const diff = Math.abs(rsiValue(bars[p2]) - rsiValue(bars[p1]));
  if (!Number.isNaN(diff) && diff > 5) {
    score += 0.2;
  }
  if (!Number.isNaN(diff) && diff > 10) {
    score += 0.1;
  }
  const rsi2 = rsiValue(bars[p2]);
  if (!Number.isNaN(rsi2) && (rsi2 < 30 || rsi2 > 70)) {
    score += 0.1;
  }
  return Math.min(score, 1);
}

function macdHist(bar: IndicatorBar): number {
  return bar.macdHist ?? Number.NaN;
}

function rsiValue(bar: IndicatorBar): number {
  return bar.rsi ?? Number.NaN;
}
