// Fibonacci Extension TP calculation
// Ported from Go: internal/strategy/engine/engine.go:351-400 + internal/strategy/indicator/fibonacci.go

import type { FibExtensionTPConfig } from '../engine/config.js';

export type FibExtension = {
  level1272: number;
  level1618: number;
  level2618: number;
};

type SwingResult = {
  swingHigh: number;
  swingLow: number;
  trend: 'UP' | 'DOWN' | 'NONE';
};

type Bar = {
  high: number;
  low: number;
  close: number;
  adx?: number;
};

type Signal = {
  side: 'BUY' | 'SELL';
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  score: number;
  strategy: string;
};

function roundToPrecision(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * Calculate Fibonacci extension levels from a swing
 * For uptrend: extensions are above swing high
 * For downtrend: extensions are below swing low
 */
export function calculateFibExtension(
  swingHigh: number,
  swingLow: number,
  trend: 'UP' | 'DOWN'
): FibExtension {
  const diff = Math.abs(swingHigh - swingLow);

  if (trend === 'UP') {
    return {
      level1272: Math.round((swingHigh + diff * 1.272) * 100) / 100,
      level1618: Math.round((swingHigh + diff * 1.618) * 100) / 100,
      level2618: Math.round((swingHigh + diff * 2.618) * 100) / 100
    };
  } else {
    return {
      level1272: Math.round((swingLow - diff * 1.272) * 100) / 100,
      level1618: Math.round((swingLow - diff * 1.618) * 100) / 100,
      level2618: Math.round((swingLow - diff * 2.618) * 100) / 100
    };
  }
}

/**
 * Detect the last swing high/low in the given window
 * Returns the most recent swing and its trend direction
 */
function detectLastSwing(bars: Bar[], window: number): SwingResult {
  if (bars.length < window) {
    return { swingHigh: 0, swingLow: 0, trend: 'NONE' };
  }

  const recentBars = bars.slice(-window);
  let swingHigh = recentBars[0].high;
  let swingLow = recentBars[0].low;
  let swingHighIdx = 0;
  let swingLowIdx = 0;

  for (let i = 1; i < recentBars.length; i++) {
    if (recentBars[i].high > swingHigh) {
      swingHigh = recentBars[i].high;
      swingHighIdx = i;
    }
    if (recentBars[i].low < swingLow) {
      swingLow = recentBars[i].low;
      swingLowIdx = i;
    }
  }

  // Determine trend: if low happened before high, trend is UP
  const trend: 'UP' | 'DOWN' | 'NONE' = swingLowIdx < swingHighIdx ? 'UP' : swingHighIdx < swingLowIdx ? 'DOWN' : 'NONE';

  return { swingHigh, swingLow, trend };
}

/**
 * Apply Fibonacci extension TP to signal if conditions are met
 *
 * Conditions:
 * - FibExtension must be enabled in config
 * - ADX must meet minimum threshold
 * - Valid swing detected from H4 (preferred) or H1 bars
 * - Signal direction must align with trend
 */
export function applyFibExtensionTP(
  signal: Signal | null,
  h4Bars: Bar[],
  h1Bars: Bar[],
  price: number,
  atr: number,
  cfg: FibExtensionTPConfig,
  precision: number
): Signal | null {
  if (!signal || !cfg.enabled) {
    return signal;
  }

  let swingResult: SwingResult = { swingHigh: 0, swingLow: 0, trend: 'NONE' };
  let adx = 0;

  // Try H4 first if preferred and available
  if (cfg.useH4Preference && h4Bars.length >= cfg.swingWindow) {
    swingResult = detectLastSwing(h4Bars, cfg.swingWindow);
    const lastH4 = h4Bars[h4Bars.length - 1];
    adx = lastH4.adx ?? 0;
  }

  // Fallback to H1 if H4 didn't meet criteria or not preferred
  if (
    (!cfg.useH4Preference || adx < cfg.minADX || swingResult.swingHigh === 0 || swingResult.swingLow === 0) &&
    h1Bars.length >= cfg.swingWindow
  ) {
    swingResult = detectLastSwing(h1Bars, cfg.swingWindow);
    const lastH1 = h1Bars[h1Bars.length - 1];
    adx = lastH1.adx ?? 0;
  }

  // Exit if ADX too weak or no valid swing detected
  if (adx < cfg.minADX || swingResult.swingHigh === 0 || swingResult.swingLow === 0) {
    return signal;
  }

  // Skip if no valid trend detected
  if (swingResult.trend === 'NONE') {
    return signal;
  }

  const ext = calculateFibExtension(swingResult.swingHigh, swingResult.swingLow, swingResult.trend);

  // Apply extension TP only if signal aligns with trend
  if (signal.side === 'BUY' && swingResult.trend === 'UP') {
    // For BUY: extension levels should be above current price
    if (ext.level1272 > price && ext.level1272 - price > atr * 0.5) {
      signal.tp1 = roundToPrecision(ext.level1272, precision);
    }
    if (ext.level1618 > price && ext.level1618 - price > atr * 1.0) {
      signal.tp2 = roundToPrecision(ext.level1618, precision);
    }
  } else if (signal.side === 'SELL' && swingResult.trend === 'DOWN') {
    // For SELL: extension levels should be below current price
    if (ext.level1272 < price && price - ext.level1272 > atr * 0.5) {
      signal.tp1 = roundToPrecision(ext.level1272, precision);
    }
    if (ext.level1618 < price && price - ext.level1618 > atr * 1.0) {
      signal.tp2 = roundToPrecision(ext.level1618, precision);
    }
  }

  return signal;
}
