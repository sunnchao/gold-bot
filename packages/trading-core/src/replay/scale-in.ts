// Scale-In (浮亏加仓) Strategy Implementation
// Ported from Go: internal/strategy/engine/engine.go:2242-2403

import type { StrategyConfig } from '../engine/config.js';

type Position = {
  ticket: number;
  type: string;
  openPrice: number;
  lots: number;
  openTime: number;
  comment?: string;
};

type Bar = {
  adx?: number;
  rsi?: number;
  macdHist?: number;
  fib382?: number;
  fib500?: number;
  fib618?: number;
  pp?: number;
  s1?: number;
  r1?: number;
  ema50?: number;
  ema200?: number;
};

type ScaleInSignal = {
  side: 'BUY' | 'SELL';
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  score: number;
  strategy: string;
  scaleInParentTicket?: number;
  weightedAvgEntry?: number;
  unifiedSL?: number;
  scaleInCount?: number;
  lots?: number;
};

type ScaleInResult = {
  signal: ScaleInSignal | null;
  reason: string;
};

function roundToPrecision(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

function roundDownScaleInLot(value: number): number {
  // Round down to 0.01 precision
  return Math.floor(value * 100) / 100;
}

function nearAnyLevel(price: number, threshold: number, ...levels: number[]): boolean {
  for (const level of levels) {
    if (level <= 0) continue;
    if (Math.abs(price - level) <= threshold) {
      return true;
    }
  }
  return false;
}

function scaleInTakeProfit(weightedAvg: number, atr: number, mult: number, side: 'BUY' | 'SELL', precision: number): number {
  if (side === 'BUY') {
    return roundToPrecision(weightedAvg + atr * mult, precision);
  }
  return roundToPrecision(weightedAvg - atr * mult, precision);
}

/**
 * Calculate unified SL for all positions after scale-in
 * Returns: [weightedAvgEntry, unifiedSL]
 */
function calculateUnifiedSL(
  positions: Position[],
  newPrice: number,
  newLots: number,
  atr: number,
  slATR: number,
  side: 'BUY' | 'SELL',
  precision: number
): [number, number] {
  let totalLots = newLots;
  let weightedEntry = newPrice * newLots;

  for (const pos of positions) {
    totalLots += pos.lots;
    weightedEntry += pos.openPrice * pos.lots;
  }

  const avgEntry = weightedEntry / totalLots;
  const unifiedSL = side === 'BUY'
    ? roundToPrecision(avgEntry - atr * slATR, precision)
    : roundToPrecision(avgEntry + atr * slATR, precision);

  return [avgEntry, unifiedSL];
}

/**
 * checkScaleIn - Scale-in (add to losing position) strategy
 *
 * Triggers when:
 * - Existing position in floating loss
 * - ADX ≥ threshold (trend still strong)
 * - Price moved ≥ minDistATR from last entry
 * - Floating loss ≥ minFloatLossATR
 * - Not exceeded max add count
 * - Min interval elapsed since last entry
 * - Price near technical level (Fib, Pivot, EMA)
 *
 * Logic:
 * - Calculate new lot size (decay factor applied)
 * - Unified SL for all positions (weighted average)
 * - TP based on weighted average entry
 */
export function checkScaleIn(
  h1Bars: Bar[],
  price: number,
  atr: number,
  positions: Position[],
  cfg: StrategyConfig,
  precision: number
): ScaleInResult {
  const name = 'scale_in';

  // Check if scale-in is enabled
  if (!cfg.scaleInEnabled) {
    return {
      signal: null,
      reason: '浮亏加仓未启用 ⏭'
    };
  }

  // Validate data
  if (h1Bars.length === 0 || atr <= 0 || price <= 0) {
    return {
      signal: null,
      reason: '数据不足，跳过浮亏加仓'
    };
  }

  const lastBar = h1Bars[h1Bars.length - 1];

  // Check ADX threshold
  if ((lastBar.adx ?? 0) < cfg.scaleInMinADX) {
    return {
      signal: null,
      reason: `ADX=${lastBar.adx?.toFixed(1) ?? '0'} < ${cfg.scaleInMinADX},趋势不够强 ⏭`
    };
  }

  // Find same-direction positions in loss
  const sameDirection: Position[] = [];
  let side: 'BUY' | 'SELL' | null = null;

  for (const pos of positions) {
    const posSide = pos.type.toUpperCase().trim() as 'BUY' | 'SELL';
    if (posSide !== 'BUY' && posSide !== 'SELL') {
      continue;
    }

    const inLoss = (posSide === 'BUY' && price < pos.openPrice) || (posSide === 'SELL' && price > pos.openPrice);
    if (!inLoss) {
      continue;
    }

    if (side === null) {
      side = posSide;
    }

    if (posSide === side) {
      sameDirection.push(pos);
    }
  }

  if (sameDirection.length === 0 || side === null) {
    return {
      signal: null,
      reason: '无同向浮亏持仓 ⏭'
    };
  }

  // Count existing scale-in additions
  let scaleInCount = 0;
  let existingLots = 0;
  let weightedEntry = 0;
  let latest = sameDirection[0];

  for (const pos of sameDirection) {
    existingLots += pos.lots;
    weightedEntry += pos.openPrice * pos.lots;

    if (pos.comment && pos.comment.toLowerCase().includes('scale_in')) {
      scaleInCount++;
    }

    if (pos.openTime > latest.openTime) {
      latest = pos;
    }
  }

  // Check max add count
  if (scaleInCount >= cfg.scaleInMaxAddCount) {
    return {
      signal: null,
      reason: `加仓次数已达上限: ${scaleInCount}/${cfg.scaleInMaxAddCount} ⏭`
    };
  }

  // Check minimum interval
  if (latest.openTime > 0 && cfg.scaleInMinIntervalMin > 0) {
    const nowMs = Date.now();
    const lastOpenMs = latest.openTime * 1000;
    const elapsedMin = (nowMs - lastOpenMs) / 1000 / 60;

    if (elapsedMin < cfg.scaleInMinIntervalMin) {
      return {
        signal: null,
        reason: `距离最近加仓/开仓不足 ${cfg.scaleInMinIntervalMin} 分钟 ⏭`
      };
    }
  }

  // Check distance from last entry
  const lastEntryDist = Math.abs(price - latest.openPrice);
  if (lastEntryDist < cfg.scaleInMinDistATR * atr) {
    return {
      signal: null,
      reason: `距离最近入场不足: ${lastEntryDist.toFixed(2)} < ${(cfg.scaleInMinDistATR * atr).toFixed(2)} ATR ⏭`
    };
  }

  // Check floating loss
  const avgEntry = weightedEntry / existingLots;
  const floatLossDist = Math.abs(price - avgEntry);
  if (floatLossDist < cfg.scaleInMinFloatLossATR * atr) {
    return {
      signal: null,
      reason: `浮亏不足: ${floatLossDist.toFixed(2)} < ${(cfg.scaleInMinFloatLossATR * atr).toFixed(2)} ATR ⏭`
    };
  }

  // Check if price is near technical level
  const fibNear = nearAnyLevel(price, atr * 0.3, lastBar.fib382 ?? 0, lastBar.fib500 ?? 0, lastBar.fib618 ?? 0);
  const pivotNear = nearAnyLevel(price, atr * 0.3, lastBar.pp ?? 0, lastBar.s1 ?? 0, lastBar.r1 ?? 0);
  const emaNear = nearAnyLevel(price, atr * 0.2, lastBar.ema50 ?? 0, lastBar.ema200 ?? 0);
  const rsiConfirm = (side === 'BUY' && (lastBar.rsi ?? 0) > 0 && (lastBar.rsi ?? 0) < 30) ||
                     (side === 'SELL' && (lastBar.rsi ?? 0) > 70);

  if (!fibNear && !pivotNear && !emaNear && !rsiConfirm) {
    return {
      signal: null,
      reason: '未到关键技术位 ⏭'
    };
  }

  // Calculate new lot size (decay)
  let newLots = roundDownScaleInLot(existingLots * cfg.scaleInLotDecay);
  if (newLots < 0.01) {
    newLots = 0.01;
  }

  // Calculate unified SL and weighted average entry
  const [weightedAvg, unifiedSL] = calculateUnifiedSL(
    sameDirection,
    price,
    newLots,
    atr,
    cfg.scaleInSLATR,
    side,
    precision
  );

  // Calculate score
  let score = 5;
  if ((lastBar.adx ?? 0) > 30) score++;
  if (rsiConfirm) score++;
  if (fibNear) score++;
  if (pivotNear) score++;
  if ((side === 'BUY' && (lastBar.macdHist ?? 0) > 0) || (side === 'SELL' && (lastBar.macdHist ?? 0) < 0)) score++;
  score = Math.min(score, 10);

  const signal: ScaleInSignal = {
    side,
    entry: price,
    stop_loss: unifiedSL,
    tp1: scaleInTakeProfit(weightedAvg, atr, cfg.scaleInTP1ATR, side, precision),
    tp2: scaleInTakeProfit(weightedAvg, atr, cfg.scaleInTP2ATR, side, precision),
    score,
    strategy: name,
    scaleInParentTicket: latest.ticket,
    weightedAvgEntry: weightedAvg,
    unifiedSL,
    scaleInCount,
    lots: newLots
  };

  const message = `➕ 浮亏加仓 ${side} | 原仓均价=${avgEntry.toFixed(2)} | 浮亏=${(floatLossDist / atr).toFixed(1)}ATR | 加仓价=${price.toFixed(2)} | 新手数=${newLots.toFixed(2)} | 加权均价=${weightedAvg.toFixed(2)} | 统一SL=${unifiedSL.toFixed(2)}`;

  return {
    signal,
    reason: message
  };
}
