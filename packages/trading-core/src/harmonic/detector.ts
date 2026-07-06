// Harmonic pattern detector
// Ported from internal/strategy/harmonic/detector.go

import type { HarmonicPattern, HarmonicContext } from './types.js';

export type HarmonicBar = {
  high: number;
  low: number;
  close: number;
  open: number;
};

// Internal types
type SwingPoint = { index: number; price: number; kind: string };
type RatioTarget = { value: number; tolerance: number };
type PatternSpec = {
  patternType: string;
  abTargets: RatioTarget[];
  xdTargets: RatioTarget[];
  cdTargets: RatioTarget[];
  abcdTargets: RatioTarget[];
};
type PatternCandidate = {
  spec: PatternSpec;
  x: SwingPoint;
  a: SwingPoint;
  b: SwingPoint;
  c: SwingPoint;
  d: SwingPoint;
  direction: string;
  abRatio: number;
  bcRatio: number;
  cdRatio: number;
  xdRatio: number;
  ratioQuality: number;
  przTargets: number[];
  expectedDLow: number;
  expectedDHigh: number;
};

const DIRECTION_BULLISH = 'bullish';
const DIRECTION_BEARISH = 'bearish';
const STATUS_COMPLETED = 'completed';
const STATUS_INVALID = 'invalidated';
const STATUS_NEUTRAL = 'neutral';

const PATTERN_GARTLEY = 'gartley';
const PATTERN_BAT = 'bat';
const PATTERN_BUTTERFLY = 'butterfly';
const PATTERN_CRAB = 'crab';
const PATTERN_ABCD = 'abcd';

const toleranceByRatio: Record<number, number> = {
  0.382: 0.04,
  0.500: 0.05,
  0.618: 0.05,
  0.786: 0.04,
  0.886: 0.04,
  1.000: 0.06,
  1.272: 0.08,
  1.618: 0.10,
  2.618: 0.15,
};

function target(value: number): RatioTarget {
  return { value, tolerance: toleranceByRatio[value] ?? 0.05 };
}

const patternSpecs: PatternSpec[] = [
  {
    patternType: PATTERN_GARTLEY,
    abTargets: [target(0.618)],
    xdTargets: [target(0.786)],
    cdTargets: [target(1.272), target(1.618)],
    abcdTargets: [target(1.0)],
  },
  {
    patternType: PATTERN_BAT,
    abTargets: [target(0.382), target(0.500)],
    xdTargets: [target(0.886)],
    cdTargets: [target(1.618), target(2.618)],
    abcdTargets: [target(1.0)],
  },
  {
    patternType: PATTERN_BUTTERFLY,
    abTargets: [target(0.786)],
    xdTargets: [target(1.272), target(1.618)],
    cdTargets: [target(1.618), target(2.618)],
    abcdTargets: [target(1.0)],
  },
  {
    patternType: PATTERN_CRAB,
    abTargets: [target(0.382), target(0.618)],
    xdTargets: [target(1.618)],
    cdTargets: [target(2.618)],
    abcdTargets: [target(1.0)],
  },
  {
    patternType: PATTERN_ABCD,
    abTargets: [],
    xdTargets: [],
    cdTargets: [],
    abcdTargets: [target(1.0)],
  },
];

// --------------- Main Detection ---------------

export function detectPatterns(bars: HarmonicBar[], timeframe: string): HarmonicPattern[] {
  const patterns: HarmonicPattern[] = [];
  const swings = extractSwings(bars);
  if (swings.length < 4) return patterns;

  let start = swings.length - 12;
  if (start < 0) start = 0;

  // 5-swing windows: X, A, B, C, D
  for (let i = start; i <= swings.length - 5; i++) {
    const x = swings[i];
    const a = swings[i + 1];
    const b = swings[i + 2];
    const c = swings[i + 3];
    const d = swings[i + 4];
    const [direction, ok] = xabcdDirection(x, a, b, c, d);
    if (!ok) continue;

    for (const spec of patternSpecs) {
      const [candidate, valid] = validateCandidate(spec, x, a, b, c, d, direction);
      if (!valid) continue;
      patterns.push(buildPattern(candidate, timeframe));
    }
  }

  // 4-swing windows: X, A, B, D — infer C from ratios
  for (let i = start; i <= swings.length - 4; i++) {
    const x = swings[i];
    const a = swings[i + 1];
    const b = swings[i + 2];
    const d = swings[i + 3];

    const xabOkStandard = (x.price > a.price && b.price > a.price && b.price < x.price) ||
      (x.price < a.price && b.price < a.price && b.price > x.price);
    const xabOkExtension = (x.price >= a.price && b.price >= a.price && b.price <= x.price) ||
      (x.price <= a.price && b.price <= a.price && b.price >= x.price);
    if (!xabOkStandard && !xabOkExtension) continue;

    let direction = '';
    if (x.price > a.price && d.price < b.price) direction = DIRECTION_BULLISH;
    else if (x.price < a.price && d.price > b.price) direction = DIRECTION_BEARISH;
    if (!direction) continue;

    for (const spec of patternSpecs) {
      // Strategy 1: CD/BC backtrack
      for (const t of spec.cdTargets) {
        const cdTargetRatio = t.value;
        const cPrice = (d.price + cdTargetRatio * b.price) / (1 + cdTargetRatio);

        if (direction === DIRECTION_BULLISH) {
          if (cPrice >= b.price || cPrice <= d.price) continue;
        } else {
          if (cPrice <= b.price || cPrice >= d.price) continue;
        }

        const c: SwingPoint = {
          index: b.index + 1,
          price: cPrice,
          kind: direction === DIRECTION_BEARISH ? 'high' : 'low',
        };

        const [candidate, ok] = validateCandidate(spec, x, a, b, c, d, direction);
        if (!ok) continue;

        const dup = patterns.some(p => p.dIndex === d.index && p.type === spec.patternType && p.direction === direction);
        if (dup) continue;
        patterns.push(buildPattern(candidate, timeframe));
      }

      // Strategy 2: CD/AB backtrack
      for (const t of spec.abcdTargets) {
        const cdAbRatio = t.value;
        const ab = Math.abs(b.price - a.price);
        let cPrice: number;
        if (direction === DIRECTION_BULLISH) {
          cPrice = d.price + cdAbRatio * ab;
          if (cPrice >= b.price || cPrice <= d.price) continue;
        } else {
          cPrice = d.price - cdAbRatio * ab;
          if (cPrice <= b.price || cPrice >= d.price) continue;
        }

        const c: SwingPoint = {
          index: b.index + 1,
          price: cPrice,
          kind: direction === DIRECTION_BEARISH ? 'high' : 'low',
        };

        const [candidate, ok] = validateCandidate(spec, x, a, b, c, d, direction);
        if (!ok) continue;

        const dup = patterns.some(p => p.dIndex === d.index && p.type === spec.patternType && p.direction === direction);
        if (dup) continue;
        patterns.push(buildPattern(candidate, timeframe));
      }
    }
  }

  // Sort by DIndex descending, then score descending
  patterns.sort((a, b) => {
    if (a.dIndex !== b.dIndex) return b.dIndex - a.dIndex;
    return b.score - a.score;
  });

  return patterns;
}

// --------------- Context Builder ---------------

export function buildContext(h4: HarmonicBar[], h1: HarmonicBar[], m30: HarmonicBar[]): HarmonicContext {
  const context: HarmonicContext = {
    h4Patterns: detectPatterns(h4, 'H4'),
    h1Patterns: detectPatterns(h1, 'H1'),
    m30Patterns: detectPatterns(m30, 'M30'),
    activePattern: null,
    directionBias: STATUS_NEUTRAL,
    score: 0,
    summary: 'No completed harmonic pattern detected.',
  };

  const all = [...context.h4Patterns, ...context.h1Patterns, ...context.m30Patterns];

  for (const pattern of all) {
    if (pattern.invalidated || pattern.status === STATUS_INVALID) continue;
    if (!context.activePattern || pattern.score > context.activePattern.score) {
      context.activePattern = pattern;
    }
  }

  if (context.activePattern) {
    context.directionBias = context.activePattern.direction;
    context.score = context.activePattern.score;
    context.summary = `${context.activePattern.timeframe} ${context.activePattern.direction} ${context.activePattern.type} completed score=${context.activePattern.score} PRZ=${context.activePattern.przLow.toFixed(2)}-${context.activePattern.przHigh.toFixed(2)}`;
  }

  return context;
}

// --------------- Internal Functions ---------------

function extractSwings(bars: HarmonicBar[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (bars.length < 2) return swings;

  const prices: number[] = bars.map(b => (b.high + b.low) / 2);

  let dir = 0; // 1=up, -1=down
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) { dir = 1; break; }
    else if (prices[i] < prices[i - 1]) { dir = -1; break; }
  }
  if (dir === 0) return swings;

  let extremumIdx = 0;
  let extremumPrice = prices[0];

  for (let i = 1; i < prices.length; i++) {
    if (dir === 1) {
      if (prices[i] > extremumPrice) { extremumPrice = prices[i]; extremumIdx = i; }
      if (prices[i] < prices[i - 1]) {
        swings.push({ index: extremumIdx, price: bars[extremumIdx].high, kind: 'high' });
        dir = -1;
        extremumPrice = prices[i];
        extremumIdx = i;
      }
    } else {
      if (prices[i] < extremumPrice) { extremumPrice = prices[i]; extremumIdx = i; }
      if (prices[i] > prices[i - 1]) {
        swings.push({ index: extremumIdx, price: bars[extremumIdx].low, kind: 'low' });
        dir = 1;
        extremumPrice = prices[i];
        extremumIdx = i;
      }
    }
  }

  // Final pending extreme
  if (dir === 1) swings.push({ index: extremumIdx, price: bars[extremumIdx].high, kind: 'high' });
  else swings.push({ index: extremumIdx, price: bars[extremumIdx].low, kind: 'low' });

  // Keep last 20 swings
  if (swings.length > 20) return swings.slice(swings.length - 20);
  return swings;
}

function xabcdDirection(x: SwingPoint, a: SwingPoint, b: SwingPoint, c: SwingPoint, d: SwingPoint): [string, boolean] {
  // Standard harmonic patterns
  if (x.price > a.price && b.price > a.price && b.price < x.price && c.price < b.price && d.price < b.price) {
    return [DIRECTION_BULLISH, true];
  }
  if (x.price < a.price && b.price < a.price && b.price > x.price && c.price > b.price && d.price > b.price) {
    return [DIRECTION_BEARISH, true];
  }

  // ABCD / extension patterns
  if (x.price >= a.price && b.price >= a.price && c.price < b.price && d.price < c.price) {
    return [DIRECTION_BULLISH, true];
  }
  if (x.price <= a.price && b.price <= a.price && c.price > b.price && d.price > c.price) {
    return [DIRECTION_BEARISH, true];
  }

  return ['', false];
}

function validateCandidate(spec: PatternSpec, x: SwingPoint, a: SwingPoint, b: SwingPoint, c: SwingPoint, d: SwingPoint, direction: string): [PatternCandidate, boolean] {
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  const cd = Math.abs(d.price - c.price);
  if (xa === 0 || ab === 0 || bc === 0 || cd === 0) return [{} as PatternCandidate, false];

  const candidate: PatternCandidate = {
    spec,
    x, a, b, c, d,
    direction,
    abRatio: ab / xa,
    bcRatio: bc / ab,
    cdRatio: cd / bc,
    xdRatio: Math.abs(d.price - x.price) / xa,
    ratioQuality: 0,
    przTargets: [],
    expectedDLow: 0,
    expectedDHigh: 0,
  };

  const qualities: number[] = [];

  if (spec.abTargets.length > 0) {
    const [quality, ok] = bestRatioQuality(candidate.abRatio, spec.abTargets);
    if (!ok) return [candidate, false];
    qualities.push(quality);
  }
  if (spec.xdTargets.length > 0) {
    const [quality, ok] = bestRatioQuality(candidate.xdRatio, spec.xdTargets);
    if (!ok) return [candidate, false];
    qualities.push(quality);
  }
  if (spec.cdTargets.length > 0) {
    const [quality, ok] = bestRatioQuality(candidate.cdRatio, spec.cdTargets);
    if (!ok) return [candidate, false];
    qualities.push(quality);
  }
  if (spec.abcdTargets.length > 0) {
    const abcdRatio = cd / ab;
    const [quality, ok] = bestRatioQuality(abcdRatio, spec.abcdTargets);
    if (spec.patternType === PATTERN_ABCD && !ok) return [candidate, false];
    if (ok) qualities.push(quality);
  }

  if (qualities.length === 0) return [candidate, false];
  candidate.ratioQuality = average(qualities);
  candidate.przTargets = projectedDTargets(candidate);
  if (candidate.przTargets.length === 0) return [candidate, false];

  const [low, high] = minMax(candidate.przTargets);
  candidate.expectedDLow = low;
  candidate.expectedDHigh = high;
  if (!priceInRange(candidate.d.price, candidate.expectedDLow, candidate.expectedDHigh)) return [candidate, false];

  return [candidate, true];
}

function buildPattern(candidate: PatternCandidate, timeframe: string): HarmonicPattern {
  const [przLow, przHigh] = buildPRZ(candidate);
  const invalidated = isInvalidated(candidate, przLow, przHigh);
  const status = invalidated ? STATUS_INVALID : STATUS_COMPLETED;
  const score = scoreCandidate(candidate, timeframe, przLow, przHigh, invalidated);

  const [stopLoss, target1, target2] = tradeLevels(candidate, przLow, przHigh);

  return {
    type: candidate.spec.patternType,
    direction: candidate.direction,
    timeframe,
    status,
    xIndex: candidate.x.index,
    aIndex: candidate.a.index,
    bIndex: candidate.b.index,
    cIndex: candidate.c.index,
    dIndex: candidate.d.index,
    xPrice: round(candidate.x.price),
    aPrice: round(candidate.a.price),
    bPrice: round(candidate.b.price),
    cPrice: round(candidate.c.price),
    dPrice: round(candidate.d.price),
    abRatio: roundRatio(candidate.abRatio),
    bcRatio: roundRatio(candidate.bcRatio),
    cdRatio: roundRatio(candidate.cdRatio),
    xdRatio: roundRatio(candidate.xdRatio),
    przLow: round(przLow),
    przHigh: round(przHigh),
    stopLoss,
    target1,
    target2,
    invalidated,
    score,
    confidence: roundRatio(score / 100),
    reason: `AB/XA=${candidate.abRatio.toFixed(3)}, BC/AB=${candidate.bcRatio.toFixed(3)}, CD/BC=${candidate.cdRatio.toFixed(3)}, XD/XA=${candidate.xdRatio.toFixed(3)}`,
  };
}

function buildPRZ(candidate: PatternCandidate): [number, number] {
  const targets = [...candidate.przTargets, candidate.d.price];
  let [low, high] = minMax(targets);

  const price = Math.abs(candidate.d.price);
  const maxWidth = Math.max(Math.abs(candidate.a.price - candidate.x.price) * 0.20, price * 0.0015);
  if (maxWidth <= 0) return [low, high];

  const mid = (low + high) / 2;
  if (high - low > maxWidth) {
    low = mid - maxWidth / 2;
    high = mid + maxWidth / 2;
    if (candidate.d.price < low) low = candidate.d.price;
    if (candidate.d.price > high) high = candidate.d.price;
  }
  return [low, high];
}

function tradeLevels(candidate: PatternCandidate, _przLow: number, przHigh: number): [number, number, number] {
  let rangeSize = Math.abs(candidate.a.price - candidate.d.price);
  if (rangeSize === 0) rangeSize = Math.abs(candidate.x.price - candidate.a.price) * 0.5;

  if (candidate.direction === DIRECTION_BULLISH) {
    const stopLoss = round(_przLow - Math.abs(candidate.x.price - candidate.a.price) * 0.10);
    const target1 = round(candidate.d.price + rangeSize * 0.382);
    const target2 = round(candidate.d.price + rangeSize * 0.618);
    return [stopLoss, target1, target2];
  }

  const stopLoss = round(przHigh + Math.abs(candidate.x.price - candidate.a.price) * 0.10);
  const target1 = round(candidate.d.price - rangeSize * 0.382);
  const target2 = round(candidate.d.price - rangeSize * 0.618);
  return [stopLoss, target1, target2];
}

function isInvalidated(candidate: PatternCandidate, przLow: number, przHigh: number): boolean {
  const buffer = Math.abs(candidate.a.price - candidate.x.price) * 0.10;
  if (candidate.direction === DIRECTION_BULLISH) return candidate.d.price < przLow - buffer;
  return candidate.d.price > przHigh + buffer;
}

function scoreCandidate(candidate: PatternCandidate, timeframe: string, przLow: number, przHigh: number, invalidated: boolean): number {
  const ratioScore = candidate.ratioQuality * 40;

  const width = Math.abs(przHigh - przLow);
  const xa = Math.abs(candidate.a.price - candidate.x.price);
  let przScore = 20;
  if (xa > 0) przScore = clampFloat(20 - (width / xa) * 40, 0, 20);

  const completionScore = 15;
  const timeframeScores: Record<string, number> = { H4: 10, H1: 8, M30: 6 };
  let timeframeScore = timeframeScores[timeframe] ?? 5;

  let score = Math.round(ratioScore + przScore + completionScore + timeframeScore);
  if (invalidated) score -= 30;
  return clampInt(score, 0, 100);
}

function projectedDTargets(candidate: PatternCandidate): number[] {
  const targets: number[] = [];
  const xa = Math.abs(candidate.a.price - candidate.x.price);
  const bc = Math.abs(candidate.c.price - candidate.b.price);
  const ab = Math.abs(candidate.b.price - candidate.a.price);

  for (const ratio of candidate.spec.xdTargets) {
    if (candidate.direction === DIRECTION_BULLISH) targets.push(candidate.x.price - xa * ratio.value);
    else targets.push(candidate.x.price + xa * ratio.value);
  }
  for (const ratio of candidate.spec.cdTargets) {
    if (candidate.direction === DIRECTION_BULLISH) targets.push(candidate.c.price - bc * ratio.value);
    else targets.push(candidate.c.price + bc * ratio.value);
  }
  for (const ratio of candidate.spec.abcdTargets) {
    if (candidate.direction === DIRECTION_BULLISH) targets.push(candidate.c.price - ab * ratio.value);
    else targets.push(candidate.c.price + ab * ratio.value);
  }
  return targets;
}

function bestRatioQuality(value: number, targets: RatioTarget[]): [number, boolean] {
  let best = 0;
  for (const t of targets) {
    const delta = Math.abs(value - t.value);
    if (delta > t.tolerance) continue;
    const quality = 1 - delta / t.tolerance;
    if (quality > best) best = quality;
  }
  return [best, best > 0];
}

function minMax(values: number[]): [number, number] {
  let low = values[0];
  let high = values[0];
  for (const v of values.slice(1)) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  return [low, high];
}

function priceInRange(price: number, low: number, high: number): boolean {
  if (low > high) [low, high] = [high, low];
  return price >= low && price <= high;
}

function average(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function clampFloat(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function clampInt(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}
