// Candlestick pattern detection
// Ported from internal/strategy/indicator/candlestick.go

export type CandleSignal =
  | 'hammer'
  | 'shooting_star'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'piercing_line'
  | 'dark_cloud_cover'
  | 'morning_star'
  | 'evening_star'
  | 'three_white_soldiers'
  | 'three_black_crows';

export type CandlestickResult = {
  signal: CandleSignal;
  bullish: boolean;
  barIndex: number;
  strength: number; // 0.0-1.0
};

export type CandleBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  ema50?: number;
  s1?: number;
  s2?: number;
  r1?: number;
  r2?: number;
  atr?: number;
};

const BULLISH_SIGNALS: Set<CandleSignal> = new Set([
  'hammer', 'bullish_engulfing', 'piercing_line', 'morning_star', 'three_white_soldiers',
]);

const BEARISH_SIGNALS: Set<CandleSignal> = new Set([
  'shooting_star', 'bearish_engulfing', 'dark_cloud_cover', 'evening_star', 'three_black_crows',
]);

export function isBullish(s: CandleSignal): boolean { return BULLISH_SIGNALS.has(s); }
export function isBearish(s: CandleSignal): boolean { return BEARISH_SIGNALS.has(s); }

// --------------- Helpers ---------------

function body(b: CandleBar): number { return Math.abs(b.close - b.open); }
function upperShadow(b: CandleBar): number { return b.high - Math.max(b.open, b.close); }
function lowerShadow(b: CandleBar): number { return Math.min(b.open, b.close) - b.low; }
function isBullishBar(b: CandleBar): boolean { return b.close > b.open; }
function isBearishBar(b: CandleBar): boolean { return b.close < b.open; }

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function minFloat(a: number, b: number): number { return a < b ? a : b; }

function localTrend(bars: CandleBar[], idx: number): 'bull' | 'bear' | 'neutral' {
  if (idx < 10) return 'neutral';

  let highCount = 0;
  let lowCount = 0;
  for (let i = idx - 9; i < idx; i++) {
    if (bars[i + 1].high > bars[i].high) highCount++;
    if (bars[i + 1].low < bars[i].low) lowCount++;
  }

  if (idx < 5) return 'neutral';
  const ema50Current = bars[idx].ema50 ?? 0;
  const ema50Prior = bars[idx - 5].ema50 ?? 0;
  if (ema50Prior === 0) return 'neutral';
  const emaSlope = (ema50Current - ema50Prior) / ema50Prior;

  if (highCount >= 6 && emaSlope > 0.001) return 'bull';
  if (lowCount >= 6 && emaSlope < -0.001) return 'bear';
  return 'neutral';
}

// --------------- Single-candle Detectors (exported for testing) ---------------

export function detectHammer(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 0 || i >= bars.length) return null;
  const bar = bars[i];
  let b = body(bar);
  const lower = lowerShadow(bar);
  const upper = upperShadow(bar);

  if (b < atr * 0.01) b = atr * 0.01;

  const minShadow = Math.max(b * 2, atr * 0.15);
  if (lower < minShadow) return null;
  if (upper > b * 0.3) return null;
  if (bar.close < (bar.high + bar.low) / 2) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bull') return null;

  return { signal: 'hammer', bullish: true, barIndex: i, strength: patternStrength('hammer', bars, i, atr) };
}

export function detectShootingStar(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 0 || i >= bars.length) return null;
  const bar = bars[i];
  let b = body(bar);
  const lower = lowerShadow(bar);
  const upper = upperShadow(bar);

  if (b < atr * 0.01) b = atr * 0.01;

  const minShadow = Math.max(b * 2, atr * 0.15);
  if (upper < minShadow) return null;
  if (lower > b * 0.3) return null;
  if (bar.close > (bar.high + bar.low) / 2) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bear') return null;

  return { signal: 'shooting_star', bullish: false, barIndex: i, strength: patternStrength('shooting_star', bars, i, atr) };
}

// --------------- Dual-candle Detectors (exported for testing) ---------------

export function detectBullishEngulfing(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 1 || i >= bars.length) return null;
  const prev = bars[i - 1];
  const curr = bars[i];

  if (!isBearishBar(prev) || !isBullishBar(curr)) return null;
  if (curr.open > prev.close || curr.close < prev.open) return null;
  if (body(curr) <= body(prev)) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bull') return null;

  return { signal: 'bullish_engulfing', bullish: true, barIndex: i, strength: patternStrength('bullish_engulfing', bars, i, atr) };
}

export function detectBearishEngulfing(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 1 || i >= bars.length) return null;
  const prev = bars[i - 1];
  const curr = bars[i];

  if (!isBullishBar(prev) || !isBearishBar(curr)) return null;
  if (curr.open < prev.close || curr.close > prev.open) return null;
  if (body(curr) <= body(prev)) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bear') return null;

  return { signal: 'bearish_engulfing', bullish: false, barIndex: i, strength: patternStrength('bearish_engulfing', bars, i, atr) };
}

export function detectPiercingLine(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 1 || i >= bars.length) return null;
  const prev = bars[i - 1];
  const curr = bars[i];

  if (!isBearishBar(prev) || !isBullishBar(curr)) return null;
  if (curr.open >= prev.close) return null;

  let prevBody = body(prev);
  if (prevBody < atr * 0.01) prevBody = atr * 0.01;
  const penetrationLevel = prev.open - (prevBody * 0.5);
  if (curr.close < penetrationLevel) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bull') return null;

  let strength = patternStrength('piercing_line', bars, i, atr);
  const penetration63Level = prev.open - (prevBody * 0.37);
  if (curr.close >= penetration63Level) strength = clamp(strength + 0.1, 0.0, 1.0);

  return { signal: 'piercing_line', bullish: true, barIndex: i, strength };
}

export function detectDarkCloudCover(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 1 || i >= bars.length) return null;
  const prev = bars[i - 1];
  const curr = bars[i];

  if (!isBullishBar(prev) || !isBearishBar(curr)) return null;
  if (curr.open <= prev.close) return null;

  let prevBody = body(prev);
  if (prevBody < atr * 0.01) prevBody = atr * 0.01;
  const penetrationLevel = prev.close - (prevBody * 0.5);
  if (curr.close > penetrationLevel) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bear') return null;

  let strength = patternStrength('dark_cloud_cover', bars, i, atr);
  const penetration63Level = prev.close - (prevBody * 0.63);
  if (curr.close <= penetration63Level) strength = clamp(strength + 0.1, 0.0, 1.0);

  return { signal: 'dark_cloud_cover', bullish: false, barIndex: i, strength };
}

// --------------- Triple-candle Detectors (exported for testing) ---------------

export function detectMorningStar(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 2 || i >= bars.length) return null;
  const bar0 = bars[i - 2];
  const bar1 = bars[i - 1];
  const bar2 = bars[i];

  if (!isBearishBar(bar0) || body(bar0) < atr * 0.3) return null;
  if (body(bar1) > atr * 0.15 || bar1.high > bar0.close) return null;
  if (!isBullishBar(bar2) || body(bar2) < atr * 0.3) return null;

  const bar0Midpoint = (bar0.open + bar0.close) / 2;
  if (bar2.close < bar0Midpoint) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bull') return null;

  return { signal: 'morning_star', bullish: true, barIndex: i, strength: patternStrength('morning_star', bars, i, atr) };
}

export function detectEveningStar(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 2 || i >= bars.length) return null;
  const bar0 = bars[i - 2];
  const bar1 = bars[i - 1];
  const bar2 = bars[i];

  if (!isBullishBar(bar0) || body(bar0) < atr * 0.3) return null;
  if (body(bar1) > atr * 0.15 || bar1.low < bar0.close) return null;
  if (!isBearishBar(bar2) || body(bar2) < atr * 0.3) return null;

  const bar0Midpoint = (bar0.open + bar0.close) / 2;
  if (bar2.close > bar0Midpoint) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bear') return null;

  return { signal: 'evening_star', bullish: false, barIndex: i, strength: patternStrength('evening_star', bars, i, atr) };
}

export function detectThreeWhiteSoldiers(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 2 || i >= bars.length) return null;
  const bar0 = bars[i - 2];
  const bar1 = bars[i - 1];
  const bar2 = bars[i];

  if (!isBullishBar(bar0) || !isBullishBar(bar1) || !isBullishBar(bar2)) return null;
  if (bar1.close <= bar0.close || bar2.close <= bar1.close) return null;

  const bar0UpperHalf = (bar0.open + bar0.close) / 2;
  const bar1UpperHalf = (bar1.open + bar1.close) / 2;
  if (bar1.open < bar0UpperHalf || bar2.open < bar1UpperHalf) return null;

  const body0 = body(bar0);
  const body1 = body(bar1);
  const body2 = body(bar2);
  const maxBody = Math.max(body0, body1, body2);
  let minBody = Math.min(body0, body1, body2);
  if (minBody < atr * 0.01) minBody = atr * 0.01;
  if (maxBody / minBody > 1.5) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bear') return null;

  return { signal: 'three_white_soldiers', bullish: true, barIndex: i, strength: patternStrength('three_white_soldiers', bars, i, atr) };
}

export function detectThreeBlackCrows(bars: CandleBar[], i: number, atr: number): CandlestickResult | null {
  if (i < 2 || i >= bars.length) return null;
  const bar0 = bars[i - 2];
  const bar1 = bars[i - 1];
  const bar2 = bars[i];

  if (!isBearishBar(bar0) || !isBearishBar(bar1) || !isBearishBar(bar2)) return null;
  if (bar1.close >= bar0.close || bar2.close >= bar1.close) return null;

  const bar0LowerHalf = (bar0.open + bar0.close) / 2;
  const bar1LowerHalf = (bar1.open + bar1.close) / 2;
  if (bar1.open > bar0LowerHalf || bar2.open > bar1LowerHalf) return null;

  const body0 = body(bar0);
  const body1 = body(bar1);
  const body2 = body(bar2);
  const maxBody = Math.max(body0, body1, body2);
  let minBody = Math.min(body0, body1, body2);
  if (minBody < atr * 0.01) minBody = atr * 0.01;
  if (maxBody / minBody > 1.5) return null;

  const trend = localTrend(bars, i);
  if (trend === 'bull') return null;

  return { signal: 'three_black_crows', bullish: false, barIndex: i, strength: patternStrength('three_black_crows', bars, i, atr) };
}

// --------------- Pattern Strength ---------------

function patternStrength(signal: CandleSignal, bars: CandleBar[], i: number, atr: number): number {
  let base = 0.5;
  const bar = bars[i];
  let b = body(bar);
  if (b < atr * 0.01) b = atr * 0.01;

  // 1. Body/shadow ratio bonus (0.0-0.2)
  let ratioBonus = 0;
  switch (signal) {
    case 'hammer': {
      const requiredRatio = 2.0;
      const actualRatio = lowerShadow(bar) / b;
      if (actualRatio > requiredRatio) ratioBonus = minFloat((actualRatio - requiredRatio) / (requiredRatio * 2), 0.2);
      break;
    }
    case 'shooting_star': {
      const requiredRatio = 2.0;
      const actualRatio = upperShadow(bar) / b;
      if (actualRatio > requiredRatio) ratioBonus = minFloat((actualRatio - requiredRatio) / (requiredRatio * 2), 0.2);
      break;
    }
    case 'bullish_engulfing':
    case 'bearish_engulfing': {
      if (i >= 1) {
        let prevBody = body(bars[i - 1]);
        if (prevBody < atr * 0.01) prevBody = atr * 0.01;
        const engulfRatio = b / prevBody;
        if (engulfRatio > 1.5) ratioBonus = minFloat((engulfRatio - 1.5) / 2.0, 0.2);
      }
      break;
    }
    case 'piercing_line':
    case 'dark_cloud_cover':
      ratioBonus = 0;
      break;
    case 'morning_star':
    case 'evening_star': {
      if (i >= 2) {
        const middleBody = body(bars[i - 1]);
        if (middleBody < atr * 0.05) ratioBonus = 0.15;
        else if (middleBody < atr * 0.1) ratioBonus = 0.1;
      }
      break;
    }
    case 'three_white_soldiers':
    case 'three_black_crows':
      ratioBonus = 0.1;
      break;
  }

  // 2. Trend context alignment bonus (0.0-0.2)
  let trendBonus = 0;
  const trend = localTrend(bars, i);
  const isBullPattern = isBullish(signal);
  const isBearPattern = isBearish(signal);

  if (isBullPattern && trend !== 'bull') trendBonus = 0.2;
  else if (isBearPattern && trend !== 'bear') trendBonus = 0.2;

  // 3. Support/Resistance proximity bonus (0.0-0.1)
  let srBonus = 0;
  if (isBullPattern) {
    if (bar.s1 !== undefined && Math.abs(bar.close - bar.s1) < atr * 0.5) srBonus = 0.1;
    else if (bar.s2 !== undefined && Math.abs(bar.close - bar.s2) < atr * 0.5) srBonus = 0.1;
  } else if (isBearPattern) {
    if (bar.r1 !== undefined && Math.abs(bar.close - bar.r1) < atr * 0.5) srBonus = 0.1;
    else if (bar.r2 !== undefined && Math.abs(bar.close - bar.r2) < atr * 0.5) srBonus = 0.1;
  }

  return clamp(base + ratioBonus + trendBonus + srBonus, 0.0, 1.0);
}

// --------------- Detect All ---------------

/**
 * Runs all pattern detectors and returns pattern names for the bar at index i.
 */
export function detectAllCandlestickPatterns(bars: CandleBar[], i: number): string[] {
  if (i < 0 || i >= bars.length) return [];

  let atr = bars[i].atr ?? 0;
  if (atr <= 0) {
    if (i > 0) atr = bars[i].high - bars[i].low;
    else return [];
  }

  const results: string[] = [];

  // Single-candle patterns
  const hammer = detectHammer(bars, i, atr);
  if (hammer && hammer.strength >= 0.5) results.push(hammer.signal);
  const star = detectShootingStar(bars, i, atr);
  if (star && star.strength >= 0.5) results.push(star.signal);

  // Dual-candle patterns
  if (i >= 1) {
    const bullEng = detectBullishEngulfing(bars, i, atr);
    if (bullEng && bullEng.strength >= 0.5) results.push(bullEng.signal);
    const bearEng = detectBearishEngulfing(bars, i, atr);
    if (bearEng && bearEng.strength >= 0.5) results.push(bearEng.signal);
    const pierce = detectPiercingLine(bars, i, atr);
    if (pierce && pierce.strength >= 0.5) results.push(pierce.signal);
    const dark = detectDarkCloudCover(bars, i, atr);
    if (dark && dark.strength >= 0.5) results.push(dark.signal);
  }

  // Triple-candle patterns
  if (i >= 2) {
    const morning = detectMorningStar(bars, i, atr);
    if (morning && morning.strength >= 0.5) results.push(morning.signal);
    const evening = detectEveningStar(bars, i, atr);
    if (evening && evening.strength >= 0.5) results.push(evening.signal);
    const soldiers = detectThreeWhiteSoldiers(bars, i, atr);
    if (soldiers && soldiers.strength >= 0.5) results.push(soldiers.signal);
    const crows = detectThreeBlackCrows(bars, i, atr);
    if (crows && crows.strength >= 0.5) results.push(crows.signal);
  }

  return results;
}
