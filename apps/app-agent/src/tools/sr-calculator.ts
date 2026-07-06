/**
 * Support/Resistance calculator — pure functions for key level detection.
 */

import type { BarData } from '../types/goldbot.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwingPoint {
  price: number;
  index: number;
}

export interface SwingPoints {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

export interface FibonacciLevels {
  level_0: number;   // Low
  level_0_236: number;
  level_0_382: number;
  level_0_5: number;
  level_0_618: number;
  level_0_786: number;
  level_1: number;   // High
}

export interface FibonacciExtensions {
  level_1_272: number;
  level_1_618: number;
  level_2_0: number;
  level_2_618: number;
}

export interface PivotPoints {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface PsychologicalLevel {
  price: number;
  label: string;
}

// ─── Swing Points ─────────────────────────────────────────────────────────────

export function calculateSwingPoints(
  bars: BarData[],
  lookback: number = 20,
): SwingPoints {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  if (bars.length < lookback * 2 + 1) {
    return { highs, lows };
  }

  const halfLookback = Math.floor(lookback / 2);

  for (let i = halfLookback; i < bars.length - halfLookback; i++) {
    const current = bars[i]!;
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - halfLookback; j <= i + halfLookback; j++) {
      if (j === i) continue;
      const bar = bars[j]!;
      if (bar.high >= current.high) isSwingHigh = false;
      if (bar.low <= current.low) isSwingLow = false;
    }

    if (isSwingHigh) {
      highs.push({ price: current.high, index: i });
    }
    if (isSwingLow) {
      lows.push({ price: current.low, index: i });
    }
  }

  return { highs, lows };
}

// ─── Fibonacci Levels ─────────────────────────────────────────────────────────

export function calculateFibonacci(high: number, low: number): FibonacciLevels {
  const diff = high - low;
  return {
    level_0: low,
    level_0_236: low + diff * 0.236,
    level_0_382: low + diff * 0.382,
    level_0_5: low + diff * 0.5,
    level_0_618: low + diff * 0.618,
    level_0_786: low + diff * 0.786,
    level_1: high,
  };
}

/**
 * Calculate Fibonacci extension levels from an impulse wave and retracement.
 *
 * @param waveStart Starting price of the impulse wave.
 * @param waveEnd Ending price of the impulse wave.
 * @param retracementEnd Ending price of the retracement.
 * @param direction Extension direction derived from market structure.
 * @returns Fibonacci extension target levels.
 */
export function calculateFibonacciExtensions(
  waveStart: number,
  waveEnd: number,
  retracementEnd: number,
  direction: 'bullish' | 'bearish',
): FibonacciExtensions {
  const diff = Math.abs(waveEnd - waveStart);

  if (direction === 'bullish') {
    return {
      level_1_272: retracementEnd + diff * 1.272,
      level_1_618: retracementEnd + diff * 1.618,
      level_2_0: retracementEnd + diff * 2.0,
      level_2_618: retracementEnd + diff * 2.618,
    };
  }

  return {
    level_1_272: retracementEnd - diff * 1.272,
    level_1_618: retracementEnd - diff * 1.618,
    level_2_0: retracementEnd - diff * 2.0,
    level_2_618: retracementEnd - diff * 2.618,
  };
}

// ─── Pivot Points ─────────────────────────────────────────────────────────────

export function calculatePivotPoints(bars: BarData[]): PivotPoints | null {
  if (bars.length === 0) return null;

  // Use the last complete bar for pivot calculation
  const last = bars[bars.length - 1]!;
  const high = last.high;
  const low = last.low;
  const close = last.close;

  const pivot = (high + low + close) / 3;

  return {
    pivot,
    r1: 2 * pivot - low,
    r2: pivot + (high - low),
    r3: high + 2 * (pivot - low),
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
    s3: low - 2 * (high - pivot),
  };
}

// ─── Psychological Levels ─────────────────────────────────────────────────────

/**
 * Find psychological levels near current price.
 * Filters out levels that are too far from current price.
 * 
 * @param price Current price
 * @param range Search range (default 100)
 * @param maxDistance Maximum distance from price (default: step * 2)
 *                    Levels beyond this distance are filtered out
 */
export function findPsychologicalLevels(
  price: number,
  range: number = 100,
  maxDistance?: number,
): PsychologicalLevel[] {
  const levels: PsychologicalLevel[] = [];
  
  // Determine step size based on price magnitude
  // For forex pairs like GBPJPY (~200), step should be smaller
  let step: number;
  if (price >= 1000) {
    step = 50;  // Gold/XAUUSD: 50 points
  } else if (price >= 100) {
    step = 10;  // Forex major pairs (GBPJPY, EURJPY): 10 points (not 25!)
  } else if (price >= 10) {
    step = 5;
  } else {
    step = 1;
  }
  
  // Default maxDistance = step * 3 (e.g., for GBPJPY at 213, max 30 points away)
  const effectiveMaxDistance = maxDistance ?? step * 3;
  
  const lowerBound = Math.max(price - range, price - effectiveMaxDistance);
  const upperBound = Math.min(price + range, price + effectiveMaxDistance);

  const start = Math.ceil(lowerBound / step) * step;

  for (let level = start; level <= upperBound; level += step) {
    const roundedLevel = Math.round(level * 100) / 100;
    const distance = Math.abs(roundedLevel - price);
    
    // Only include levels within effectiveMaxDistance
    if (distance <= effectiveMaxDistance) {
      const isRound = roundedLevel % (step * 10) === 0;
      levels.push({
        price: roundedLevel,
        label: isRound 
          ? `Major Round ${roundedLevel}` 
          : roundedLevel % (step * 2) === 0 
            ? `Round ${roundedLevel}` 
            : `Half ${roundedLevel}`,
      });
    }
  }

  return levels;
}
