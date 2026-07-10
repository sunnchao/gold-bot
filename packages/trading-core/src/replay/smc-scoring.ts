// SMC Context Scoring Boost
// Adds scoring bonus when SMC structure confirms signal

export type SMCContext = {
  h1_breaks?: Array<{ type: string; direction: string; index: number }>;
  h1_sweeps?: Array<{ side: string; level: number }>;
  h1_obs?: Array<{ side: string; high: number; low: number }>;
  h1_fvgs?: Array<{ side: string; high: number; low: number }>;
  m30_breaks?: Array<{ type: string; direction: string; index: number }>;
  m30_sweeps?: Array<{ side: string; level: number }>;
  m30_obs?: Array<{ side: string; high: number; low: number }>;
  m30_fvgs?: Array<{ side: string; high: number; low: number }>;
  m15_breaks?: Array<{ type: string; direction: string; index: number }>;
  m15_sweeps?: Array<{ side: string; level: number }>;
  m15_obs?: Array<{ side: string; high: number; low: number }>;
  m15_fvgs?: Array<{ side: string; high: number; low: number }>;
};

/**
 * Check if there's a recent CHoCH (Change of Character) that aligns with signal direction
 */
export function hasRecentCHoCH(
  smc: SMCContext | undefined,
  side: 'BUY' | 'SELL',
  timeframe: 'h1' | 'm30' | 'm15',
  maxBarsAgo: number = 10
): boolean {
  if (!smc) return false;

  const breaksKey = `${timeframe}_breaks` as keyof SMCContext;
  const breaks = smc[breaksKey];

  if (!breaks || !Array.isArray(breaks)) return false;

  // Find most recent CHoCH
  for (let i = breaks.length - 1; i >= 0; i--) {
    const br = breaks[i];
    if ('type' in br && br.type === 'CHoCH') {
      // Check if it's recent enough (assumes bars.length - br.index < maxBarsAgo)
      const direction = 'direction' in br ? br.direction?.toUpperCase() : undefined;
      if (side === 'BUY' && direction === 'UP') return true;
      if (side === 'SELL' && direction === 'DOWN') return true;
    }
  }

  return false;
}

/**
 * Check if there's a sweep that confirms signal direction
 * BUY signal: look for BULL sweep (swept lows before reversal)
 * SELL signal: look for BEAR sweep (swept highs before reversal)
 */
export function hasConfirmingSweep(
  smc: SMCContext | undefined,
  side: 'BUY' | 'SELL',
  timeframe: 'h1' | 'm30' | 'm15',
  price: number,
  atr: number,
  maxDistance: number = 2.0
): boolean {
  if (!smc) return false;

  const sweepsKey = `${timeframe}_sweeps` as keyof SMCContext;
  const sweeps = smc[sweepsKey];

  if (!sweeps || !Array.isArray(sweeps)) return false;

  const targetSide = side === 'BUY' ? 'BULL' : 'BEAR';

  // Find most recent sweep matching direction
  for (let i = sweeps.length - 1; i >= 0; i--) {
    const sw = sweeps[i];
    if ('side' in sw && 'level' in sw && sw.side?.toUpperCase() === targetSide) {
      // Check if price is within reasonable distance from sweep level
      if (Math.abs(price - sw.level) <= atr * maxDistance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if there's a valid order block near current price
 */
export function hasValidOBNearPrice(
  smc: SMCContext | undefined,
  side: 'BUY' | 'SELL',
  timeframe: 'h1' | 'm30' | 'm15',
  price: number,
  atr: number,
  maxDistance: number = 1.0
): boolean {
  if (!smc) return false;

  const obsKey = `${timeframe}_obs` as keyof SMCContext;
  const obs = smc[obsKey];

  if (!obs || !Array.isArray(obs)) return false;

  const targetSide = side === 'BUY' ? 'BUY' : 'SELL';

  for (const ob of obs) {
    if ('side' in ob && 'high' in ob && 'low' in ob && ob.side?.toUpperCase() === targetSide) {
      // Check if price is within OB zone
      const obCenter = (ob.high + ob.low) / 2;
      if (Math.abs(price - obCenter) <= atr * maxDistance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if there's a FVG (Fair Value Gap) near current price
 */
export function hasFVGNearPrice(
  smc: SMCContext | undefined,
  side: 'BUY' | 'SELL',
  timeframe: 'h1' | 'm30' | 'm15',
  price: number,
  atr: number,
  maxDistance: number = 1.0
): boolean {
  if (!smc) return false;

  const fvgsKey = `${timeframe}_fvgs` as keyof SMCContext;
  const fvgs = smc[fvgsKey];

  if (!fvgs || !Array.isArray(fvgs)) return false;

  const targetSide = side === 'BUY' ? 'BUY' : 'SELL';

  for (const fvg of fvgs) {
    if ('side' in fvg && 'high' in fvg && 'low' in fvg && fvg.side?.toUpperCase() === targetSide) {
      // Check if price is within FVG zone
      const fvgCenter = (fvg.high + fvg.low) / 2;
      if (Math.abs(price - fvgCenter) <= atr * maxDistance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculate SMC context score bonus for any strategy
 *
 * Bonuses:
 * - Recent CHoCH in direction: +1
 * - Confirming sweep: +1
 * - Valid OB near price: +1
 * - FVG near price: +1
 */
export function calculateSMCBonus(
  smc: SMCContext | undefined,
  side: 'BUY' | 'SELL',
  price: number,
  atr: number,
  timeframe: 'h1' | 'm30' | 'm15' = 'h1'
): number {
  let bonus = 0;

  if (hasRecentCHoCH(smc, side, timeframe)) {
    bonus++;
  }

  if (hasConfirmingSweep(smc, side, timeframe, price, atr)) {
    bonus++;
  }

  if (hasValidOBNearPrice(smc, side, timeframe, price, atr)) {
    bonus++;
  }

  if (hasFVGNearPrice(smc, side, timeframe, price, atr)) {
    bonus++;
  }

  return bonus;
}
