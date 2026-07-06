import type {
  ElliottWaveAnalysis,
  ElliottWaveSegment,
  ElliottWaveSwingPoint,
  ElliottWaveValidation,
} from '../types/analysis.js';

function relativeMove(from: number, to: number): number {
  if (from === 0) {
    return 0;
  }

  return Math.abs(to - from) / Math.abs(from);
}

function buildSegment(
  wave: ElliottWaveSegment['wave'],
  start: ElliottWaveSwingPoint,
  end: ElliottWaveSwingPoint,
): ElliottWaveSegment {
  return {
    wave,
    startIndex: start.index,
    endIndex: end.index,
    startPrice: start.price,
    endPrice: end.price,
    direction: end.price >= start.price ? 'up' : 'down',
    length: Math.abs(end.price - start.price),
  };
}

function expectedPattern(
  direction: 'bullish' | 'bearish',
  kind: 'impulse' | 'correction',
): ElliottWaveSwingPoint['type'][] {
  if (kind === 'impulse') {
    return direction === 'bullish'
      ? ['low', 'high', 'low', 'high', 'low', 'high']
      : ['high', 'low', 'high', 'low', 'high', 'low'];
  }

  return direction === 'bullish'
    ? ['high', 'low', 'high', 'low']
    : ['low', 'high', 'low', 'high'];
}

function matchesPattern(
  points: ElliottWaveSwingPoint[],
  pattern: ElliottWaveSwingPoint['type'][],
): boolean {
  return points.length === pattern.length && points.every((point, index) => point.type === pattern[index]);
}

function hasImpulseStructure(
  points: ElliottWaveSwingPoint[],
  direction: 'bullish' | 'bearish',
): boolean {
  if (direction === 'bullish') {
    return (
      points[1]!.price > points[0]!.price &&
      points[2]!.price > points[0]!.price &&
      points[3]!.price > points[1]!.price &&
      points[4]!.price > points[2]!.price &&
      points[5]!.price > points[3]!.price
    );
  }

  return (
    points[1]!.price < points[0]!.price &&
    points[2]!.price < points[0]!.price &&
    points[3]!.price < points[1]!.price &&
    points[4]!.price < points[2]!.price &&
    points[5]!.price < points[3]!.price
  );
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function detectSwingPoints(
  prices: number[],
  minMovePercent: number = 0.01,
): ElliottWaveSwingPoint[] {
  if (prices.length === 0) {
    return [];
  }

  const raw: ElliottWaveSwingPoint[] = [{ index: 0, price: prices[0]!, type: 'low' }];

  for (let index = 1; index < prices.length - 1; index++) {
    const prev = prices[index - 1]!;
    const current = prices[index]!;
    const next = prices[index + 1]!;

    if (current > prev && current >= next) {
      raw.push({ index, price: current, type: 'high' });
      continue;
    }

    if (current < prev && current <= next) {
      raw.push({ index, price: current, type: 'low' });
    }
  }

  const lastIndex = prices.length - 1;
  const lastType = raw[raw.length - 1]?.type === 'high' ? 'low' : 'high';
  raw.push({ index: lastIndex, price: prices[lastIndex]!, type: lastType });

  const filtered: ElliottWaveSwingPoint[] = [];

  for (const point of raw) {
    const previous = filtered[filtered.length - 1];
    if (!previous) {
      filtered.push(point);
      continue;
    }

    if (point.type === previous.type) {
      const shouldReplace =
        (point.type === 'high' && point.price >= previous.price) ||
        (point.type === 'low' && point.price <= previous.price);
      if (shouldReplace) {
        filtered[filtered.length - 1] = point;
      }
      continue;
    }

    if (relativeMove(previous.price, point.price) < minMovePercent) {
      continue;
    }

    filtered.push(point);
  }

  if (filtered.length > 1 && filtered[0]!.type === filtered[1]!.type) {
    filtered.shift();
  }

  return filtered;
}

export function labelImpulseWaves(
  swingPoints: ElliottWaveSwingPoint[],
  direction: 'bullish' | 'bearish',
): ElliottWaveSegment[] {
  const pattern = expectedPattern(direction, 'impulse');

  for (let start = Math.max(0, swingPoints.length - 6); start >= 0; start--) {
    const candidate = swingPoints.slice(start, start + 6);
    if (!matchesPattern(candidate, pattern)) {
      continue;
    }
    if (!hasImpulseStructure(candidate, direction)) {
      continue;
    }

    return [
      buildSegment(1, candidate[0]!, candidate[1]!),
      buildSegment(2, candidate[1]!, candidate[2]!),
      buildSegment(3, candidate[2]!, candidate[3]!),
      buildSegment(4, candidate[3]!, candidate[4]!),
      buildSegment(5, candidate[4]!, candidate[5]!),
    ];
  }

  return [];
}

export function labelCorrectiveWaves(
  swingPoints: ElliottWaveSwingPoint[],
  direction: 'bullish' | 'bearish',
  impulseEndIndex?: number,
): ElliottWaveSegment[] {
  const startAt =
    impulseEndIndex == null
      ? 0
      : Math.max(0, swingPoints.findIndex((point) => point.index === impulseEndIndex));
  const pattern = expectedPattern(direction, 'correction');

  for (let offset = startAt; offset <= swingPoints.length - 4; offset++) {
    const candidate = swingPoints.slice(offset, offset + 4);
    if (!matchesPattern(candidate, pattern)) {
      continue;
    }

    if (direction === 'bullish') {
      if (!(candidate[1]!.price < candidate[0]!.price && candidate[2]!.price < candidate[0]!.price && candidate[3]!.price < candidate[1]!.price)) {
        continue;
      }
    } else if (!(candidate[1]!.price > candidate[0]!.price && candidate[2]!.price > candidate[0]!.price && candidate[3]!.price > candidate[1]!.price)) {
      continue;
    }

    return [
      buildSegment('A', candidate[0]!, candidate[1]!),
      buildSegment('B', candidate[1]!, candidate[2]!),
      buildSegment('C', candidate[2]!, candidate[3]!),
    ];
  }

  return [];
}

export function validateWaveRules(
  impulseWaves: ElliottWaveSegment[],
  direction: 'bullish' | 'bearish',
): ElliottWaveValidation {
  const violations: string[] = [];

  if (impulseWaves.length !== 5) {
    return {
      isValid: false,
      violations: ['A valid impulse requires exactly 5 labeled waves.'],
    };
  }

  const [wave1, wave2, wave3, wave4, wave5] = impulseWaves;
  const motiveLengths = [wave1.length, wave3.length, wave5.length];

  if (wave3.length === Math.min(...motiveLengths)) {
    violations.push('Wave 3 cannot be the shortest motive wave.');
  }

  if (direction === 'bullish') {
    if (wave2.endPrice <= wave1.startPrice) {
      violations.push('Wave 2 cannot retrace beyond the start of wave 1.');
    }
    if (wave4.endPrice <= wave1.endPrice) {
      violations.push('Wave 4 cannot overlap the price territory of wave 1.');
    }
  } else {
    if (wave2.endPrice >= wave1.startPrice) {
      violations.push('Wave 2 cannot retrace beyond the start of wave 1.');
    }
    if (wave4.endPrice >= wave1.endPrice) {
      violations.push('Wave 4 cannot overlap the price territory of wave 1.');
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

function determineRecentDirection(
  swingPoints: ElliottWaveSwingPoint[],
): 'bullish' | 'bearish' {
  if (swingPoints.length < 2) {
    return 'bullish';
  }

  const recent = swingPoints.slice(-6);
  return recent[recent.length - 1]!.price >= recent[0]!.price ? 'bullish' : 'bearish';
}

export function analyzeElliottWave(
  prices: number[],
  minMovePercent: number = 0.01,
): ElliottWaveAnalysis {
  const swingPoints = detectSwingPoints(prices, minMovePercent);
  const direction = determineRecentDirection(swingPoints);
  const impulseWaves = labelImpulseWaves(swingPoints, direction);
  const correctiveWaves =
    impulseWaves.length === 5
      ? labelCorrectiveWaves(swingPoints, direction, impulseWaves[4]!.endIndex)
      : [];
  const validation = validateWaveRules(impulseWaves, direction);

  let confidence = 20;
  if (swingPoints.length >= 6) {
    confidence += 20;
  }
  if (impulseWaves.length === 5) {
    confidence += 30;
  }
  if (correctiveWaves.length === 3) {
    confidence += 10;
  }
  if (validation.isValid) {
    confidence += 20;
  } else {
    confidence -= validation.violations.length * 5;
  }

  return {
    direction,
    swingPoints,
    impulseWaves,
    correctiveWaves,
    validation,
    confidence: clampConfidence(confidence),
  };
}
