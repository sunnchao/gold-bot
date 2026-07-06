// SMC (Smart Money Concepts) detector
// Ported from internal/strategy/smc/detector.go

import type { SwingPoint, StructureBreak, FVG, OrderBlock, LiquiditySweep, SMCContext } from './types.js';

// Bar shape expected by SMC detectors — matches ReplayRawBar subset
export type SmcBar = {
  high: number;
  low: number;
  close: number;
  open: number;
};

// --------------- Swing Point Detection ---------------

/**
 * Detects local swing highs and lows using N-bar pivot logic.
 * A bar is a swing high if its High is greater than all `left` bars before and `right` bars after.
 * Similarly for swing lows.
 */
export function findSwingPoints(bars: SmcBar[], left: number, right: number): { swingHighs: SwingPoint[]; swingLows: SwingPoint[] } {
  if (left < 1) left = 1;
  if (right < 1) right = 1;
  if (bars.length < left + right + 1) return { swingHighs: [], swingLows: [] };

  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];

  for (let i = left; i < bars.length - right; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= high) isSwingHigh = false;
      if (bars[j].low <= low) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) swingHighs.push({ index: i, price: high, type: 'HIGH' });
    if (isSwingLow) swingLows.push({ index: i, price: low, type: 'LOW' });
  }

  return { swingHighs, swingLows };
}

// --------------- Trend Direction ---------------

/**
 * Infers the current trend direction from the sequence of recent swing points.
 * Returns "BULL", "BEAR", or "NEUTRAL".
 */
export function determineTrendDirection(swingHighs: SwingPoint[], swingLows: SwingPoint[]): 'BULL' | 'BEAR' | 'NEUTRAL' {
  // Merge and sort swing points by index
  type SwingEvent = { index: number; price: number; isHigh: boolean };
  const events: SwingEvent[] = [];
  for (const sh of swingHighs) events.push({ index: sh.index, price: sh.price, isHigh: true });
  for (const sl of swingLows) events.push({ index: sl.index, price: sl.price, isHigh: false });

  if (events.length < 4) return 'NEUTRAL';

  // Sort by index
  events.sort((a, b) => a.index - b.index);

  // Separate into recent highs and lows
  const recentHighs: SwingPoint[] = [];
  const recentLows: SwingPoint[] = [];
  for (const e of events) {
    if (e.isHigh) recentHighs.push({ index: e.index, price: e.price, type: 'HIGH' });
    else recentLows.push({ index: e.index, price: e.price, type: 'LOW' });
  }

  const bullish = recentHighs.length >= 2 && recentLows.length >= 2 &&
    recentHighs[recentHighs.length - 1].price > recentHighs[recentHighs.length - 2].price &&
    recentLows[recentLows.length - 1].price > recentLows[recentLows.length - 2].price;

  const bearish = recentHighs.length >= 2 && recentLows.length >= 2 &&
    recentHighs[recentHighs.length - 1].price < recentHighs[recentHighs.length - 2].price &&
    recentLows[recentLows.length - 1].price < recentLows[recentLows.length - 2].price;

  if (bullish) return 'BULL';
  if (bearish) return 'BEAR';
  return 'NEUTRAL';
}

// --------------- Structure Break Detection (BOS + CHoCH) ---------------

/**
 * Identifies both BOS (continuation) and CHoCH (reversal) by comparing
 * the break direction against the prevailing trend.
 * trendDirection: "BULL", "BEAR", or "NEUTRAL" — if empty, auto-detected from swing points.
 */
export function detectStructureBreaks(bars: SmcBar[], lookback: number, trendDirection: string): StructureBreak[] {
  if (bars.length < 3) return [];
  if (lookback <= 0 || lookback > bars.length) lookback = bars.length;

  const start = bars.length - lookback;
  const window = bars.slice(start);

  // Try swing-point-based detection first
  let { swingHighs, swingLows } = findSwingPoints(window, 3, 3);

  // Adjust indices back to full bars slice
  swingHighs = swingHighs.map(sp => ({ ...sp, index: sp.index + start }));
  swingLows = swingLows.map(sp => ({ ...sp, index: sp.index + start }));

  // Auto-detect trend if not provided
  if (!trendDirection) {
    trendDirection = determineTrendDirection(swingHighs, swingLows);
  }

  // If we have swing points, use them for precise break detection
  if (swingHighs.length > 0 || swingLows.length > 0) {
    const swingBreaks = detectBreaksFromSwings(bars, start, swingHighs, swingLows, trendDirection);

    // If we only have one type of swing point, supplement with fallback
    if (swingHighs.length === 0 || swingLows.length === 0) {
      const fallbackBreaks = detectBreaksFromRecentExtremes(bars, start, trendDirection);
      // Merge: add fallback breaks that don't duplicate swing breaks
      const seen = new Set<string>();
      for (const b of swingBreaks) seen.add(`${b.index}-${b.direction}`);
      for (const b of fallbackBreaks) {
        const key = `${b.index}-${b.direction}`;
        if (!seen.has(key)) swingBreaks.push(b);
      }
    }

    return swingBreaks;
  }

  // Fallback: simple recent-high/low break detection
  return detectBreaksFromRecentExtremes(bars, start, trendDirection);
}

function detectBreaksFromSwings(bars: SmcBar[], start: number, swingHighs: SwingPoint[], swingLows: SwingPoint[], trendDirection: string): StructureBreak[] {
  const events: StructureBreak[] = [];
  let highCursor = 0;
  let lowCursor = 0;

  for (let i = start; i < bars.length; i++) {
    while (highCursor < swingHighs.length && swingHighs[highCursor].index < i) highCursor++;
    while (lowCursor < swingLows.length && swingLows[lowCursor].index < i) lowCursor++;

    if (highCursor > 0) {
      const level = swingHighs[highCursor - 1].price;
      if (bars[i].close > level && (i === 0 || bars[i - 1].close <= level)) {
        const breakDir: 'UP' = 'UP';
        events.push({
          index: i,
          direction: breakDir,
          level,
          type: classifyBreak(breakDir, trendDirection),
        });
      }
    }

    if (lowCursor > 0) {
      const level = swingLows[lowCursor - 1].price;
      if (bars[i].close < level && (i === 0 || bars[i - 1].close >= level)) {
        const breakDir: 'DOWN' = 'DOWN';
        events.push({
          index: i,
          direction: breakDir,
          level,
          type: classifyBreak(breakDir, trendDirection),
        });
      }
    }
  }

  return events;
}

function detectBreaksFromRecentExtremes(bars: SmcBar[], start: number, trendDirection: string): StructureBreak[] {
  const events: StructureBreak[] = [];
  const windowSize = 5;

  for (let i = start + windowSize; i < bars.length; i++) {
    let recentHigh = 0;
    let recentLow = Number.MAX_SAFE_INTEGER;
    let recentHighIdx = -1;
    let recentLowIdx = -1;

    for (let j = i - windowSize; j < i; j++) {
      if (j < start) continue;
      if (bars[j].high > recentHigh) { recentHigh = bars[j].high; recentHighIdx = j; }
      if (bars[j].low < recentLow) { recentLow = bars[j].low; recentLowIdx = j; }
    }

    if (recentHighIdx < 0 && recentLowIdx < 0) continue;

    if (recentHighIdx >= 0 && bars[i].close > recentHigh && (i === 0 || bars[i - 1].close <= recentHigh)) {
      const breakDir: 'UP' = 'UP';
      events.push({
        index: i,
        direction: breakDir,
        level: recentHigh,
        type: classifyBreak(breakDir, trendDirection),
      });
    }

    if (recentLowIdx >= 0 && bars[i].close < recentLow && (i === 0 || bars[i - 1].close >= recentLow)) {
      const breakDir: 'DOWN' = 'DOWN';
      events.push({
        index: i,
        direction: breakDir,
        level: recentLow,
        type: classifyBreak(breakDir, trendDirection),
      });
    }
  }

  return events;
}

/**
 * Determines whether a structure break is BOS (continuation) or CHoCH (reversal).
 */
function classifyBreak(breakDir: 'UP' | 'DOWN', trendDirection: string): 'BOS' | 'CHoCH' {
  switch (trendDirection) {
    case 'BULL':
      return breakDir === 'UP' ? 'BOS' : 'CHoCH';
    case 'BEAR':
      return breakDir === 'DOWN' ? 'BOS' : 'CHoCH';
    default:
      return 'BOS'; // Unknown trend — label all as BOS (conservative)
  }
}

// --------------- FVG Detection ---------------

/**
 * Detects Fair Value Gaps in the bar series.
 * Bullish FVG: bars[i+2].Low > bars[i].High
 * Bearish FVG: bars[i+2].High < bars[i].Low
 */
export function detectFVGs(bars: SmcBar[], lookback: number): FVG[] {
  if (bars.length < 3) return [];
  if (lookback <= 0 || lookback > bars.length) lookback = bars.length;

  const start = bars.length - lookback;
  const gaps: FVG[] = [];

  for (let i = start; i < bars.length - 2; i++) {
    const first = bars[i];
    const third = bars[i + 2];

    // Bullish FVG: third candle's Low > first candle's High
    if (third.low > first.high) {
      let fvg: FVG = {
        startIndex: i,
        endIndex: i + 2,
        side: 'BULL',
        upperBound: third.low,
        lowerBound: first.high,
        filled: false,
        fillIndex: 0,
      };
      fvg = checkFVGFill(fvg, bars, i + 3);
      gaps.push(fvg);
    }

    // Bearish FVG: third candle's High < first candle's Low
    if (third.high < first.low) {
      let fvg: FVG = {
        startIndex: i,
        endIndex: i + 2,
        side: 'BEAR',
        upperBound: first.low,
        lowerBound: third.high,
        filled: false,
        fillIndex: 0,
      };
      fvg = checkFVGFill(fvg, bars, i + 3);
      gaps.push(fvg);
    }
  }

  return gaps;
}

function checkFVGFill(fvg: FVG, bars: SmcBar[], fromIndex: number): FVG {
  for (let j = fromIndex; j < bars.length; j++) {
    if (fvg.side === 'BULL' && bars[j].low <= fvg.lowerBound) {
      return { ...fvg, filled: true, fillIndex: j };
    }
    if (fvg.side === 'BEAR' && bars[j].high >= fvg.upperBound) {
      return { ...fvg, filled: true, fillIndex: j };
    }
  }
  return fvg;
}

// --------------- Liquidity Sweep Detection ---------------

/**
 * Identifies liquidity sweeps (fake breakouts).
 * A sweep occurs when price briefly moves beyond a swing point and then reverses,
 * closing back inside the structural range within a few bars.
 */
export function detectLiquiditySweeps(bars: SmcBar[], swingHighs: SwingPoint[], swingLows: SwingPoint[], maxReversalBars: number): LiquiditySweep[] {
  if (bars.length === 0 || (swingHighs.length === 0 && swingLows.length === 0)) return [];
  if (maxReversalBars <= 0) maxReversalBars = 3;

  const sweeps: LiquiditySweep[] = [];

  // Check swing high sweeps (price spikes above then reverses — bearish context)
  for (const sh of swingHighs) {
    for (let i = sh.index + 1; i < bars.length && i <= sh.index + maxReversalBars; i++) {
      if (bars[i].high > sh.price && bars[i].close < sh.price) {
        sweeps.push({
          index: i,
          level: sh.price,
          side: 'BEAR',
          reversed: true,
        });
        break; // Only record first sweep per swing point
      }
    }
  }

  // Check swing low sweeps (price dips below then reverses — bullish context)
  for (const sl of swingLows) {
    for (let i = sl.index + 1; i < bars.length && i <= sl.index + maxReversalBars; i++) {
      if (bars[i].low < sl.price && bars[i].close > sl.price) {
        sweeps.push({
          index: i,
          level: sl.price,
          side: 'BULL',
          reversed: true,
        });
        break;
      }
    }
  }

  return sweeps;
}

// --------------- Order Block Detection ---------------

/**
 * Finds order blocks based on structure breaks.
 * For a BUY OB: find the last bearish candle before a BOS UP (or CHoCH UP).
 * For a SELL OB: find the last bullish candle before a BOS DOWN (or CHoCH UP → flipped).
 */
export function detectOrderBlocks(bars: SmcBar[], side: 'BUY' | 'SELL', lookback: number, trendDirection: string): OrderBlock[] {
  if (bars.length === 0) return [];

  const bosEvents = detectStructureBreaks(bars, lookback, trendDirection);
  if (bosEvents.length === 0) return [];

  const seen = new Set<number>();
  const blocks: OrderBlock[] = [];

  for (let i = bosEvents.length - 1; i >= 0; i--) {
    const brk = bosEvents[i];
    let obIndex: number;

    if (side === 'BUY' && brk.direction === 'UP') {
      // Bullish OB: last bearish candle before the upward break
      obIndex = findLastOrderBlockCandle(bars, brk.index, 0, false);
    } else if (side === 'SELL' && brk.direction === 'DOWN') {
      // Bearish OB: last bullish candle before the downward break
      obIndex = findLastOrderBlockCandle(bars, brk.index, 0, true);
    } else {
      continue;
    }

    if (obIndex < 0 || seen.has(obIndex)) continue;
    seen.add(obIndex);

    let block: OrderBlock = {
      index: obIndex,
      side,
      high: bars[obIndex].high,
      low: bars[obIndex].low,
      valid: true,
      mitigated: false,
      ageBars: bars.length - 1 - obIndex,
    };
    block = checkOrderBlockValidity(block, bars);
    blocks.push(block);
  }

  return blocks;
}

/**
 * Searches backward from beforeIndex for the last candle that matches
 * the expected direction (close > open for bullish, close < open for bearish).
 * Prefers candles with body/range > 30% (strong body), but will accept any
 * directional candle if no strong-body candidate is found.
 */
function findLastOrderBlockCandle(bars: SmcBar[], beforeIndex: number, start: number, bullish: boolean): number {
  if (beforeIndex > bars.length) beforeIndex = bars.length;
  if (start < 0) start = 0;

  // First pass: find a strong-body candle (>30% body/range)
  for (let i = beforeIndex - 1; i >= start; i--) {
    const barRange = bars[i].high - bars[i].low;
    if (barRange <= 0) continue;
    const bodySize = Math.abs(bars[i].close - bars[i].open);
    if (bodySize <= barRange * 0.30) continue;
    if (bullish && bars[i].close > bars[i].open) return i;
    if (!bullish && bars[i].close < bars[i].open) return i;
  }

  // Second pass: accept any directional candle (fallback)
  for (let i = beforeIndex - 1; i >= start; i--) {
    if (bullish && bars[i].close > bars[i].open) return i;
    if (!bullish && bars[i].close < bars[i].open) return i;
  }

  return -1;
}

/**
 * Updates Valid and Mitigated based on subsequent price action.
 * BUY OB is invalidated if a bar closes below OB.Low.
 * SELL OB is invalidated if a bar closes above OB.High.
 */
function checkOrderBlockValidity(ob: OrderBlock, bars: SmcBar[]): OrderBlock {
  for (let i = ob.index + 1; i < bars.length; i++) {
    if (ob.side === 'BUY') {
      if (bars[i].close < ob.low) {
        return { ...ob, valid: false, mitigated: true };
      }
    } else if (ob.side === 'SELL') {
      if (bars[i].close > ob.high) {
        return { ...ob, valid: false, mitigated: true };
      }
    }
  }
  return ob;
}

// --------------- SMC Context Builder ---------------

/**
 * Constructs a multi-timeframe SMC context from H4, H1, and M30 bars.
 */
export function buildSMCContext(h4: SmcBar[], h1: SmcBar[], _m30: SmcBar[]): SMCContext {
  const ctx: SMCContext = {
    h4OBs: [],
    h1OBs: [],
    h1ShortOBs: [],
    h4FVGs: [],
    h1FVGs: [],
    h4Breaks: [],
    h1Breaks: [],
    h4Sweeps: [],
    h1Sweeps: [],
    h4TrendDirection: 'NEUTRAL',
    h1TrendDirection: 'NEUTRAL',
  };

  if (h4.length >= 20) {
    const { swingHighs: h4Highs, swingLows: h4Lows } = findSwingPoints(h4, 3, 3);
    ctx.h4TrendDirection = determineTrendDirection(h4Highs, h4Lows);
    ctx.h4Breaks = detectStructureBreaks(h4, 50, ctx.h4TrendDirection);
    ctx.h4OBs = [
      ...detectOrderBlocks(h4, 'BUY', 50, ctx.h4TrendDirection),
      ...detectOrderBlocks(h4, 'SELL', 50, ctx.h4TrendDirection),
    ];
    ctx.h4FVGs = detectFVGs(h4, 50);
    ctx.h4Sweeps = detectLiquiditySweeps(h4, h4Highs, h4Lows, 3);
  }

  if (h1.length >= 20) {
    const { swingHighs: h1Highs, swingLows: h1Lows } = findSwingPoints(h1, 3, 3);
    ctx.h1TrendDirection = determineTrendDirection(h1Highs, h1Lows);
    ctx.h1Breaks = detectStructureBreaks(h1, 50, ctx.h1TrendDirection);
    ctx.h1OBs = [
      ...detectOrderBlocks(h1, 'BUY', 50, ctx.h1TrendDirection),
      ...detectOrderBlocks(h1, 'SELL', 50, ctx.h1TrendDirection),
    ];
    ctx.h1FVGs = detectFVGs(h1, 50);
    ctx.h1Sweeps = detectLiquiditySweeps(h1, h1Highs, h1Lows, 3);

    // Short-lookback OBs for breakout_pyramid (lookback=20)
    ctx.h1ShortOBs = [
      ...detectOrderBlocks(h1, 'BUY', 20, ctx.h1TrendDirection),
      ...detectOrderBlocks(h1, 'SELL', 20, ctx.h1TrendDirection),
    ];
  }

  return ctx;
}

// --------------- Helper Functions ---------------

/**
 * Returns order blocks matching the given side.
 */
export function filterOBsBySide(obs: OrderBlock[], side: 'BUY' | 'SELL'): OrderBlock[] {
  return obs.filter(ob => ob.side === side);
}

/**
 * Returns unfilled FVGs whose zone overlaps with the price ± threshold range.
 */
export function unfilledFVGsNearPrice(fvgs: FVG[], price: number, threshold: number): FVG[] {
  return fvgs.filter(fvg =>
    !fvg.filled &&
    fvg.upperBound >= price - threshold &&
    fvg.lowerBound <= price + threshold
  );
}

/**
 * Returns valid order blocks whose zone overlaps with the price ± threshold range.
 */
export function validOBsNearPrice(obs: OrderBlock[], price: number, threshold: number): OrderBlock[] {
  return obs.filter(ob =>
    ob.valid &&
    ob.high >= price - threshold &&
    ob.low <= price + threshold
  );
}

/**
 * Checks whether any CHoCH event exists in the given structure breaks
 * that signals a reversal in the specified direction.
 * direction="BULL" → look for CHoCH with Direction="UP"
 * direction="BEAR" → look for CHoCH with Direction="DOWN"
 */
export function hasCHOCHInDirection(breaks: StructureBreak[], direction: 'BULL' | 'BEAR'): boolean {
  return breaks.some(brk =>
    brk.type === 'CHoCH' &&
    ((direction === 'BULL' && brk.direction === 'UP') ||
     (direction === 'BEAR' && brk.direction === 'DOWN'))
  );
}

/**
 * Checks for recent liquidity sweeps that confirm the given direction.
 * direction="BULL" → swept lows then reversed up
 * direction="BEAR" → swept highs then reversed down
 * maxBarsAgo: only consider sweeps within this many bars from the end of the data
 */
export function recentSweepInDirection(sweeps: LiquiditySweep[], direction: 'BULL' | 'BEAR', lastBarIndex: number, maxBarsAgo: number): boolean {
  return sweeps.some(sweep =>
    sweep.reversed &&
    sweep.side === direction &&
    (maxBarsAgo <= 0 || lastBarIndex - sweep.index <= maxBarsAgo)
  );
}
