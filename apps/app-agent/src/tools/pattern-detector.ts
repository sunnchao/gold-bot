/**
 * Price pattern detection helpers based on regression trend lines.
 * All functions are pure and operate on plain numeric arrays.
 */

export interface WedgePattern {
  type: 'rising_wedge' | 'falling_wedge' | 'none';
  direction: 'bearish' | 'bullish' | null;
  upperLine: { start: number; end: number; slope: number };
  lowerLine: { start: number; end: number; slope: number };
  breakoutPrice: number | null;
  confidence: number;
  barsCount: number;
}

export interface ChannelPattern {
  type: 'ascending_channel' | 'descending_channel' | 'horizontal_channel' | 'none';
  direction: 'bullish' | 'bearish' | 'neutral' | null;
  upperLine: { start: number; end: number; slope: number };
  lowerLine: { start: number; end: number; slope: number };
  confidence: number;
  barsCount: number;
}

export interface TrianglePattern {
  type: 'symmetrical' | 'ascending' | 'descending' | 'none';
  direction: 'continuation' | 'breakout_up' | 'breakout_down' | null;
  upperLine: { start: number; end: number; slope: number };
  lowerLine: { start: number; end: number; slope: number };
  apexPrice: number | null;
  confidence: number;
  barsCount: number;
}

interface RegressionLine {
  slope: number;
  intercept: number;
}

interface WindowData {
  highs: number[];
  lows: number[];
  closes?: number[];
  volumes?: number[];
  startIndex: number;
}

/**
 * Fit a straight line using least-squares linear regression.
 *
 * @param points Points to fit.
 * @returns Regression slope and intercept.
 */
export function linearRegression(
  points: { x: number; y: number }[],
): { slope: number; intercept: number } {
  if (points.length === 0) {
    return { slope: 0, intercept: 0 };
  }

  const count = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  }

  const denominator = count * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / count };
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;

  return { slope, intercept };
}

/**
 * Detect wedge patterns from recent highs, lows, closes, and volumes.
 *
 * @param highs High prices.
 * @param lows Low prices.
 * @param closes Close prices.
 * @param volumes Volumes.
 * @param lookback Number of bars to analyze.
 * @returns Detected wedge patterns for the analyzed window.
 */
export function detectWedge(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  lookback: number = 50,
): WedgePattern[] {
  const window = buildWindow(highs, lows, closes, volumes, lookback);
  if (!window) {
    return [];
  }

  const upperRegression = buildRegression(window.highs);
  const lowerRegression = buildRegression(window.lows);
  const upperLine = buildLineDescriptor(upperRegression, window.startIndex, window.highs.length);
  const lowerLine = buildLineDescriptor(lowerRegression, window.startIndex, window.lows.length);
  const lastIndex = window.highs.length - 1;
  const upperAtLast = project(upperRegression, lastIndex);
  const lowerAtLast = project(lowerRegression, lastIndex);
  const converging = widthAt(upperRegression, lowerRegression, 0) > widthAt(upperRegression, lowerRegression, lastIndex);
  const volumeContracting = isVolumeContracting(window.volumes ?? []);

  if (
    upperRegression.slope > 0.05 &&
    lowerRegression.slope > 0.05 &&
    lowerRegression.slope > upperRegression.slope &&
    converging &&
    volumeContracting &&
    (window.closes?.[lastIndex] ?? 0) < lowerAtLast
  ) {
    return [
      {
        type: 'rising_wedge',
        direction: 'bearish',
        upperLine,
        lowerLine,
        breakoutPrice: window.closes![lastIndex]!,
        confidence: clampConfidence(
          45 +
            slopeGapScore(lowerRegression.slope - upperRegression.slope) +
            convergenceScore(upperRegression, lowerRegression, lastIndex) +
            15,
        ),
        barsCount: window.highs.length,
      },
    ];
  }

  if (
    upperRegression.slope < -0.05 &&
    lowerRegression.slope < -0.05 &&
    Math.abs(upperRegression.slope) > Math.abs(lowerRegression.slope) &&
    converging &&
    volumeContracting &&
    (window.closes?.[lastIndex] ?? 0) > upperAtLast
  ) {
    return [
      {
        type: 'falling_wedge',
        direction: 'bullish',
        upperLine,
        lowerLine,
        breakoutPrice: window.closes![lastIndex]!,
        confidence: clampConfidence(
          45 +
            slopeGapScore(Math.abs(upperRegression.slope) - Math.abs(lowerRegression.slope)) +
            convergenceScore(upperRegression, lowerRegression, lastIndex) +
            15,
        ),
        barsCount: window.highs.length,
      },
    ];
  }

  return [];
}

/**
 * Detect parallel price channels from recent highs and lows.
 *
 * @param highs High prices.
 * @param lows Low prices.
 * @param lookback Number of bars to analyze.
 * @returns Detected channels for the analyzed window.
 */
export function detectChannel(
  highs: number[],
  lows: number[],
  lookback: number = 50,
): ChannelPattern[] {
  const window = buildWindow(highs, lows, undefined, undefined, lookback);
  if (!window) {
    return [];
  }

  const upperRegression = buildRegression(window.highs);
  const lowerRegression = buildRegression(window.lows);
  const upperLine = buildLineDescriptor(upperRegression, window.startIndex, window.highs.length);
  const lowerLine = buildLineDescriptor(lowerRegression, window.startIndex, window.lows.length);
  const slopeDiff = Math.abs(upperRegression.slope - lowerRegression.slope);
  const widthStart = widthAt(upperRegression, lowerRegression, 0);
  const widthEnd = widthAt(upperRegression, lowerRegression, window.highs.length - 1);
  const widthStability = widthStart === 0 ? 0 : 1 - Math.min(Math.abs(widthEnd - widthStart) / widthStart, 1);

  if (slopeDiff > 0.12 || widthStart <= 0 || widthEnd <= 0) {
    return [];
  }

  let type: ChannelPattern['type'] = 'none';
  let direction: ChannelPattern['direction'] = null;

  if (upperRegression.slope > 0.05 && lowerRegression.slope > 0.05) {
    type = 'ascending_channel';
    direction = 'bullish';
  } else if (upperRegression.slope < -0.05 && lowerRegression.slope < -0.05) {
    type = 'descending_channel';
    direction = 'bearish';
  } else if (Math.abs(upperRegression.slope) <= 0.05 && Math.abs(lowerRegression.slope) <= 0.05) {
    type = 'horizontal_channel';
    direction = 'neutral';
  }

  if (type === 'none') {
    return [];
  }

  return [
    {
      type,
      direction,
      upperLine,
      lowerLine,
      confidence: clampConfidence(50 + (1 - Math.min(slopeDiff / 0.12, 1)) * 25 + widthStability * 25),
      barsCount: window.highs.length,
    },
  ];
}

/**
 * Detect triangle patterns from recent highs, lows, and closes.
 *
 * @param highs High prices.
 * @param lows Low prices.
 * @param closes Close prices.
 * @param lookback Number of bars to analyze.
 * @returns Detected triangle patterns for the analyzed window.
 */
export function detectTriangle(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback: number = 50,
): TrianglePattern[] {
  const window = buildWindow(highs, lows, closes, undefined, lookback);
  if (!window) {
    return [];
  }

  const upperRegression = buildRegression(window.highs);
  const lowerRegression = buildRegression(window.lows);
  const upperLine = buildLineDescriptor(upperRegression, window.startIndex, window.highs.length);
  const lowerLine = buildLineDescriptor(lowerRegression, window.startIndex, window.lows.length);
  const lastIndex = window.highs.length - 1;

  let type: TrianglePattern['type'] = 'none';
  let baseConfidence = 0;

  if (
    upperRegression.slope < -0.05 &&
    lowerRegression.slope > 0.05 &&
    Math.abs(Math.abs(upperRegression.slope) - Math.abs(lowerRegression.slope)) <= 0.12
  ) {
    type = 'symmetrical';
    baseConfidence = 55;
  } else if (
    Math.abs(upperRegression.slope) <= 0.05 &&
    lowerRegression.slope > 0.05
  ) {
    type = 'ascending';
    baseConfidence = 60;
  } else if (
    upperRegression.slope < -0.05 &&
    Math.abs(lowerRegression.slope) <= 0.05
  ) {
    type = 'descending';
    baseConfidence = 60;
  }

  if (type === 'none') {
    return [];
  }

  const upperAtLast = project(upperRegression, lastIndex);
  const lowerAtLast = project(lowerRegression, lastIndex);
  const breakoutBuffer = Math.max((upperAtLast - lowerAtLast) * 0.05, 0.15);
  let direction: TrianglePattern['direction'] = 'continuation';

  if ((window.closes?.[lastIndex] ?? 0) > upperAtLast + breakoutBuffer) {
    direction = 'breakout_up';
  } else if ((window.closes?.[lastIndex] ?? 0) < lowerAtLast - breakoutBuffer) {
    direction = 'breakout_down';
  }

  return [
    {
      type,
      direction,
      upperLine,
      lowerLine,
      apexPrice: calculateApexPrice(upperRegression, lowerRegression),
      confidence: clampConfidence(baseConfidence + convergenceScore(upperRegression, lowerRegression, lastIndex)),
      barsCount: window.highs.length,
    },
  ];
}

function buildWindow(
  highs: number[],
  lows: number[],
  closes: number[] | undefined,
  volumes: number[] | undefined,
  lookback: number,
): WindowData | null {
  const count = Math.min(
    highs.length,
    lows.length,
    closes?.length ?? Number.MAX_SAFE_INTEGER,
    volumes?.length ?? Number.MAX_SAFE_INTEGER,
  );

  if (count < 5) {
    return null;
  }

  const barsCount = Math.min(count, lookback);
  const startIndex = count - barsCount;

  return {
    highs: highs.slice(startIndex, count),
    lows: lows.slice(startIndex, count),
    closes: closes?.slice(startIndex, count),
    volumes: volumes?.slice(startIndex, count),
    startIndex,
  };
}

function buildRegression(values: number[]): RegressionLine {
  return linearRegression(values.map((value, index) => ({ x: index, y: value })));
}

function buildLineDescriptor(
  line: RegressionLine,
  startIndex: number,
  length: number,
): { start: number; end: number; slope: number } {
  return {
    start: project(line, 0),
    end: project(line, Math.max(length - 1, 0)),
    slope: line.slope,
  };
}

function project(line: RegressionLine, x: number): number {
  return line.intercept + line.slope * x;
}

function widthAt(upper: RegressionLine, lower: RegressionLine, x: number): number {
  return project(upper, x) - project(lower, x);
}

function isVolumeContracting(volumes: number[]): boolean {
  if (volumes.length < 6) {
    return false;
  }

  const half = Math.floor(volumes.length / 2);
  const firstHalf = average(volumes.slice(0, half));
  const secondHalf = average(volumes.slice(half));

  return secondHalf < firstHalf * 0.95;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateApexPrice(
  upper: RegressionLine,
  lower: RegressionLine,
): number | null {
  const slopeDelta = upper.slope - lower.slope;
  if (Math.abs(slopeDelta) < 1e-9) {
    return null;
  }

  const x = (lower.intercept - upper.intercept) / slopeDelta;
  return project(upper, x);
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function slopeGapScore(gap: number): number {
  return Math.min(Math.abs(gap) * 40, 20);
}

function convergenceScore(
  upper: RegressionLine,
  lower: RegressionLine,
  lastIndex: number,
): number {
  const startWidth = widthAt(upper, lower, 0);
  const endWidth = widthAt(upper, lower, lastIndex);
  if (startWidth <= 0) {
    return 0;
  }

  return Math.min(((startWidth - endWidth) / startWidth) * 20, 20);
}
