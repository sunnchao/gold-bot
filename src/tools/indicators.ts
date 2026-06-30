/**
 * Technical indicator calculation functions.
 * All pure functions — no external dependencies.
 */

// ─── EMA ──────────────────────────────────────────────────────────────────────

export function EMA(closes: number[], period: number): number[] {
  if (closes.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with SMA of first `period` values
  if (closes.length < period) return [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  result.push(sum / period);
  for (let i = period; i < closes.length; i++) {
    const prev = result[result.length - 1]!;
    result.push(closes[i]! * k + prev * (1 - k));
  }
  return result;
}

// ─── ATR ──────────────────────────────────────────────────────────────────────

export function ATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < 2 || period <= 0) return [];

  // True Range array (starts at index 1)
  const tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const high = highs[i]!;
    const low = lows[i]!;
    const prevClose = closes[i - 1]!;
    tr.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      ),
    );
  }

  if (tr.length < period) return [];

  const result: number[] = [];
  // Seed with SMA of first `period` TR values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i]!;
  }
  result.push(sum / period);

  // Wilder smoothing
  for (let i = period; i < tr.length; i++) {
    const prev = result[result.length - 1]!;
    result.push((prev * (period - 1) + tr[i]!) / period);
  }
  return result;
}

// ─── RSI (Wilder smoothing) ───────────────────────────────────────────────────

export function RSI(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return [];

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  // First average: SMA of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i]!;
    avgLoss += losses[i]!;
  }
  avgGain /= period;
  avgLoss /= period;

  const result: number[] = [];
  if (avgLoss === 0) {
    result.push(100);
  } else {
    const rs = avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  // Wilder smoothing for subsequent values
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function MACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9,
): MACDResult {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);

  // MACD line: EMA_fast - EMA_slow
  // The slow EMA has fewer values; align from the end
  const offset = emaFast.length - emaSlow.length;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset]! - emaSlow[i]!);
  }

  // Signal line: EMA of MACD line
  const signalLine = EMA(macdLine, signalPeriod);

  // Histogram: MACD - Signal (aligned from end)
  const signalOffset = macdLine.length - signalLine.length;
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + signalOffset]! - signalLine[i]!);
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

// ─── ADX ──────────────────────────────────────────────────────────────────────

export function ADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number[] {
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period + 1) return [];

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < len; i++) {
    const highDiff = highs[i]! - highs[i - 1]!;
    const lowDiff = lows[i - 1]! - lows[i]!;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const high = highs[i]!;
    const low = lows[i]!;
    const prevClose = closes[i - 1]!;
    tr.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }

  if (tr.length < period) return [];

  // First smoothed values: sum of first `period`
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;
  for (let i = 0; i < period; i++) {
    smoothTR += tr[i]!;
    smoothPlusDM += plusDM[i]!;
    smoothMinusDM += minusDM[i]!;
  }

  const dxValues: number[] = [];

  const processSmoothed = (sTR: number, sPlusDM: number, sMinusDM: number) => {
    const plusDI = sTR > 0 ? (sPlusDM / sTR) * 100 : 0;
    const minusDI = sTR > 0 ? (sMinusDM / sTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    return diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  };

  dxValues.push(processSmoothed(smoothTR, smoothPlusDM, smoothMinusDM));

  // Wilder smoothing for subsequent values
  for (let i = period; i < tr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i]!;
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i]!;
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i]!;
    dxValues.push(processSmoothed(smoothTR, smoothPlusDM, smoothMinusDM));
  }

  if (dxValues.length < period) return [];

  // ADX = smoothed DX
  let adxSum = 0;
  for (let i = 0; i < period; i++) {
    adxSum += dxValues[i]!;
  }
  const result: number[] = [adxSum / period];

  for (let i = period; i < dxValues.length; i++) {
    const prev = result[result.length - 1]!;
    result.push((prev * (period - 1) + dxValues[i]!) / period);
  }

  return result;
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function bollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2,
): BollingerBandsResult {
  if (closes.length < period) return { upper: [], middle: [], lower: [] };

  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += closes[j]!;
    }
    const sma = sum / period;

    let sqDiffSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqDiffSum += (closes[j]! - sma) ** 2;
    }
    const sd = Math.sqrt(sqDiffSum / period);

    middle.push(sma);
    upper.push(sma + stdDev * sd);
    lower.push(sma - stdDev * sd);
  }

  return { upper, middle, lower };
}

// ─── Stochastic ───────────────────────────────────────────────────────────────

export interface StochasticResult {
  k: number[];
  d: number[];
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3,
): StochasticResult {
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < kPeriod) return { k: [], d: [] };

  const kValues: number[] = [];

  for (let i = kPeriod - 1; i < len; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j]! > highestHigh) highestHigh = highs[j]!;
      if (lows[j]! < lowestLow) lowestLow = lows[j]!;
    }
    const range = highestHigh - lowestLow;
    kValues.push(range > 0 ? ((closes[i]! - lowestLow) / range) * 100 : 50);
  }

  // %D = SMA of %K
  const dValues: number[] = [];
  if (kValues.length >= dPeriod) {
    for (let i = dPeriod - 1; i < kValues.length; i++) {
      let sum = 0;
      for (let j = i - dPeriod + 1; j <= i; j++) {
        sum += kValues[j]!;
      }
      dValues.push(sum / dPeriod);
    }
  }

  return { k: kValues, d: dValues };
}
