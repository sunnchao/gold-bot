// SR-based Stop Loss and Take Profit calculation
// Ported from Go: internal/strategy/engine/engine.go:244-349

import type { StrategyConfig } from '../engine/config.js';

export type SRSLTPResult = {
  sl: number;
  tp1: number;
  tp2: number;
  usedSR: boolean;
};

export type AIResult = {
  suggestedSL?: number;
  suggested_sl?: number;
  suggestedTP?: number;
  suggested_tp?: number;
};

type Bar = {
  ema20?: number;
  ema50?: number;
  ema200?: number;
  bbUpper?: number;
  bbLower?: number;
  bb_upper?: number;
  bb_lower?: number;
  fib236?: number;
  fib382?: number;
  fib500?: number;
  fib618?: number;
  fib786?: number;
  pp?: number;
  s1?: number;
  r1?: number;
};

type PickSLTPConfig = Pick<StrategyConfig, 'srMinDistATR' | 'srMaxDistATR' | 'srBufferATR' | 'pullbackSLATR' | 'pullbackTP1ATR' | 'pullbackTP2ATR'> | {
  srMinDistATR: number;
  srMaxDistATR: number;
  srBufferATR: number;
  pullback: {
    slAtr: number;
    tp1Atr: number;
    tp2Atr: number;
  };
};

function roundToPrecision(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * pickSLTP - Intelligent SL/TP placement using support/resistance levels
 *
 * Priority:
 * 1. AI suggestions (if available)
 * 2. SR levels (EMA20/50, BB, Fib, Pivot)
 * 3. ATR-based fallback
 */
export function pickSLTP(
  side: 'BUY' | 'SELL',
  price: number,
  lastBar: Bar,
  atr: number,
  precision: number,
  cfg: PickSLTPConfig,
  aiResult?: AIResult | null
): SRSLTPResult {
  const pullbackSLATR = 'pullbackSLATR' in cfg ? cfg.pullbackSLATR : cfg.pullback.slAtr;
  const pullbackTP1ATR = 'pullbackTP1ATR' in cfg ? cfg.pullbackTP1ATR : cfg.pullback.tp1Atr;
  const pullbackTP2ATR = 'pullbackTP2ATR' in cfg ? cfg.pullbackTP2ATR : cfg.pullback.tp2Atr;
  const bbUpper = lastBar.bbUpper ?? lastBar.bb_upper ?? 0;
  const bbLower = lastBar.bbLower ?? lastBar.bb_lower ?? 0;

  // Step 1: Check AI override
  if (aiResult) {
    const aiSL = aiResult.suggestedSL ?? aiResult.suggested_sl;
    const aiTP = aiResult.suggestedTP ?? aiResult.suggested_tp;

    if (aiSL && aiSL > 0) {
      const sl = roundToPrecision(aiSL, precision);
      const tp1 = aiTP && aiTP > 0
        ? roundToPrecision(aiTP, precision)
        : roundToPrecision(side === 'BUY' ? price + atr * pullbackTP1ATR : price - atr * pullbackTP1ATR, precision);
      const tp2 = roundToPrecision(side === 'BUY' ? price + atr * pullbackTP2ATR : price - atr * pullbackTP2ATR, precision);
      return { sl, tp1, tp2, usedSR: true };
    }
  }

  // Step 2: Validate inputs
  if (price <= 0 || atr <= 0 || isNaN(price) || isNaN(atr) || !isFinite(price) || !isFinite(atr)) {
    return {
      sl: 0,
      tp1: 0,
      tp2: 0,
      usedSR: false
    };
  }

  const minDist = cfg.srMinDistATR * atr;
  const maxDist = cfg.srMaxDistATR * atr;
  const buffer = cfg.srBufferATR * atr;

  if (minDist <= 0 || maxDist <= 0 || minDist > maxDist) {
    return {
      sl: 0,
      tp1: 0,
      tp2: 0,
      usedSR: false
    };
  }

  // Step 3: Find closest level within distance constraints
  const closestLevel = (levels: number[], wantBelow: boolean): number => {
    let best = 0;
    let bestDist = Number.MAX_VALUE;

    for (const level of levels) {
      if (level <= 0 || isNaN(level) || !isFinite(level)) {
        continue;
      }
      if (wantBelow && level >= price) {
        continue;
      }
      if (!wantBelow && level <= price) {
        continue;
      }

      const dist = Math.abs(price - level);
      if (dist < minDist || dist > maxDist) {
        continue;
      }

      if (dist < bestDist) {
        best = level;
        bestDist = dist;
      }
    }

    return best;
  };

  // Step 4: Calculate SR-based SL/TP
  let slLevel: number;
  let tpLevel: number;
  let sl: number;
  let tp1: number;
  let tp2: number;

  if (side === 'BUY') {
    // BUY: SL below support, TP above resistance
    const supports = [
      lastBar.ema20 ?? 0,
      lastBar.ema50 ?? 0,
      bbLower,
      lastBar.fib618 ?? 0,
      lastBar.fib786 ?? 0,
      lastBar.s1 ?? 0
    ];
    const resistances = [
      lastBar.ema20 ?? 0,
      bbUpper,
      lastBar.fib382 ?? 0,
      lastBar.r1 ?? 0
    ];

    slLevel = closestLevel(supports, true);
    tpLevel = closestLevel(resistances, false);

    // Fallback to ATR if no valid SR found
    if (slLevel <= 0 || tpLevel <= 0) {
      return {
        sl: roundToPrecision(price - atr * pullbackSLATR, precision),
        tp1: roundToPrecision(price + atr * pullbackTP1ATR, precision),
        tp2: roundToPrecision(price + atr * pullbackTP2ATR, precision),
        usedSR: false
      };
    }

    sl = roundToPrecision(slLevel - buffer, precision);

    // Validate SL is below price and meets min distance
    if (sl >= price || Math.abs(price - sl) < minDist) {
      return {
        sl: roundToPrecision(price - atr * pullbackSLATR, precision),
        tp1: roundToPrecision(price + atr * pullbackTP1ATR, precision),
        tp2: roundToPrecision(price + atr * pullbackTP2ATR, precision),
        usedSR: false
      };
    }

    tp1 = roundToPrecision(tpLevel, precision);
    tp2 = tp1;

    // Try to find a second TP level
    const secondTPLevel = closestLevel(
      [bbUpper, lastBar.fib382 ?? 0, lastBar.r1 ?? 0],
      false
    );
    if (secondTPLevel > tpLevel) {
      tp2 = roundToPrecision(secondTPLevel, precision);
    }

    if (tp2 < tp1) {
      tp2 = tp1;
    }

    return { sl, tp1, tp2, usedSR: true };

  } else if (side === 'SELL') {
    // SELL: SL above resistance, TP below support
    const resistances = [
      lastBar.ema20 ?? 0,
      bbUpper,
      lastBar.fib382 ?? 0,
      lastBar.r1 ?? 0
    ];
    const supports = [
      lastBar.ema20 ?? 0,
      bbLower,
      lastBar.fib618 ?? 0,
      lastBar.fib786 ?? 0,
      lastBar.s1 ?? 0
    ];

    slLevel = closestLevel(resistances, false);
    tpLevel = closestLevel(supports, true);

    // Fallback to ATR if no valid SR found
    if (slLevel <= 0 || tpLevel <= 0) {
      return {
        sl: roundToPrecision(price + atr * pullbackSLATR, precision),
        tp1: roundToPrecision(price - atr * pullbackTP1ATR, precision),
        tp2: roundToPrecision(price - atr * pullbackTP2ATR, precision),
        usedSR: false
      };
    }

    sl = roundToPrecision(slLevel + buffer, precision);

    // Validate SL is above price and meets min distance
    if (sl <= price || Math.abs(price - sl) < minDist) {
      return {
        sl: roundToPrecision(price + atr * pullbackSLATR, precision),
        tp1: roundToPrecision(price - atr * pullbackTP1ATR, precision),
        tp2: roundToPrecision(price - atr * pullbackTP2ATR, precision),
        usedSR: false
      };
    }

    tp1 = roundToPrecision(tpLevel, precision);
    tp2 = tp1;

    // Try to find a deeper TP level
    for (const level of [bbLower, lastBar.fib618 ?? 0, lastBar.fib786 ?? 0, lastBar.s1 ?? 0]) {
      if (level > 0 && level < tpLevel && Math.abs(price - level) >= minDist && Math.abs(price - level) <= maxDist) {
        tp2 = roundToPrecision(level, precision);
        break;
      }
    }

    if (tp2 > tp1) {
      tp2 = tp1;
    }

    return { sl, tp1, tp2, usedSR: true };
  }

  // Invalid side
  return {
    sl: 0,
    tp1: 0,
    tp2: 0,
    usedSR: false
  };
}
