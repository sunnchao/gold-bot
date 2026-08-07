/**
 * SymbolProfile — per-instrument characteristics for AI analysis context injection.
 *
 * Ensures LLM agents reason about the correct instrument instead of
 * defaulting to gold (XAUUSD) assumptions.
 */

export interface SymbolProfile {
  /** Canonical symbol name */
  symbol: string;
  /** Human-readable name (bilingual) */
  name: string;
  /** Decimal places for price display */
  pricePrecision: number;
  /** Value of 1 pip in price terms */
  pipValue: number;
  /** Typical ATR ranges per timeframe (used for sanity checks) */
  typicalAtrRange: Record<string, { min: number; max: number }>;
  /** Suggested stop-loss as ATR multiplier */
  slAtrMultiplier: number;
  /** Suggested take-profit as ATR multiplier */
  tpAtrMultiplier: number;
  /** Volatility classification */
  volatilityLevel: 'high' | 'medium' | 'low';
  /** Human-readable typical price range */
  priceRangeHint: string;
  /** Numeric price range for validation [min, max] (optional) */
  priceRange?: [number, number];
  /** Asset class for prompt context */
  assetClass: 'metal' | 'forex' | 'index' | 'energy' | 'commodity' | 'crypto';
  /** Whether volume data is reliable (forex OTC volume is unreliable) */
  volumeReliable: boolean;
  /** Minimum order size in MT4 lots for this symbol/profile */
  minLots?: number;
  /** Maximum order size in MT4 lots for this symbol/profile */
  maxLots?: number;
}

export const DEFAULT_MIN_LOTS = 0.01;
export const DEFAULT_MAX_LOTS = 0.5;
const MICRO_CONTRACT_MIN_LOTS = 0.1;

const PROFILES: Record<string, SymbolProfile> = {
  XAUUSD: {
    symbol: 'XAUUSD',
    name: '黄金/美元 (Gold/USD)',
    pricePrecision: 2,
    pipValue: 0.1,
    typicalAtrRange: {
      M15: { min: 1.5, max: 8 },
      M30: { min: 2, max: 12 },
      H1: { min: 4, max: 25 },
      H4: { min: 10, max: 60 },
    },
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    volatilityLevel: 'medium',
    priceRangeHint: 'typically 1800–4500 USD/oz',
    priceRange: [1800, 4500],
    assetClass: 'metal',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  GOLD: {
    symbol: 'GOLD',
    name: '黄金 (Gold)',
    pricePrecision: 2,
    pipValue: 0.1,
    typicalAtrRange: {
      M15: { min: 1.5, max: 8 },
      M30: { min: 2, max: 12 },
      H1: { min: 4, max: 25 },
      H4: { min: 10, max: 60 },
    },
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    volatilityLevel: 'medium',
    priceRangeHint: 'typically 1800–4500',
    priceRange: [1800, 4500],
    assetClass: 'metal',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  GBPJPY: {
    symbol: 'GBPJPY',
    name: '英镑/日元 (British Pound/Japanese Yen)',
    pricePrecision: 3,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.05, max: 0.30 },
      M30: { min: 0.08, max: 0.45 },
      H1: { min: 0.15, max: 0.80 },
      H4: { min: 0.30, max: 1.50 },
    },
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    volatilityLevel: 'high',
    priceRangeHint: 'typically 150–250 JPY per GBP',
    priceRange: [150, 250],
    assetClass: 'forex',
    volumeReliable: false,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  EURJPY: {
    symbol: 'EURJPY',
    name: '欧元/日元 (Euro/Japanese Yen)',
    pricePrecision: 3,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.04, max: 0.25 },
      M30: { min: 0.06, max: 0.40 },
      H1: { min: 0.12, max: 0.70 },
      H4: { min: 0.25, max: 1.30 },
    },
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    volatilityLevel: 'high',
    priceRangeHint: 'typically 130–200 JPY per EUR',
    priceRange: [130, 200],
    assetClass: 'forex',
    volumeReliable: false,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  USDJPY: {
    symbol: 'USDJPY',
    name: '美元/日元 (US Dollar/Japanese Yen)',
    pricePrecision: 3,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.03, max: 0.20 },
      M30: { min: 0.05, max: 0.35 },
      H1: { min: 0.10, max: 0.60 },
      H4: { min: 0.20, max: 1.10 },
    },
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    volatilityLevel: 'medium',
    priceRangeHint: 'typically 120–180 JPY per USD',
    priceRange: [120, 180],
    assetClass: 'forex',
    volumeReliable: false,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  XAGUSD: {
    symbol: 'XAGUSD',
    name: '白银/美元 (Silver/USD)',
    pricePrecision: 3,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.03, max: 0.20 },
      M30: { min: 0.05, max: 0.30 },
      H1: { min: 0.10, max: 0.60 },
      H4: { min: 0.20, max: 1.20 },
    },
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    volatilityLevel: 'high',
    priceRangeHint: 'typically 20–40 USD/oz',
    priceRange: [15, 50],
    assetClass: 'metal',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  US100CASH: {
    symbol: 'US100CASH',
    name: '纳斯达克100指数 (US100 Cash CFD)',
    pricePrecision: 2,
    pipValue: 1.0,
    typicalAtrRange: {
      M15: { min: 30, max: 200 },
      M30: { min: 50, max: 400 },
      H1: { min: 100, max: 800 },
      H4: { min: 300, max: 2000 },
    },
    slAtrMultiplier: 0.8,       // was 1.0 — matching new tighter SL
    tpAtrMultiplier: 2.5,       // was 2.0 — matching new wider TP
    volatilityLevel: 'high',
    priceRangeHint: 'typically 15000–35000 USD',
    priceRange: [15000, 35000],
    assetClass: 'index',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  USOILCASH: {
    symbol: 'USOILCASH',
    name: 'WTI原油 (US Oil Cash CFD)',
    pricePrecision: 2,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.2, max: 1.5 },
      M30: { min: 0.3, max: 2.5 },
      H1: { min: 0.5, max: 4.0 },
      H4: { min: 1.0, max: 8.0 },
    },
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 3.5,
    volatilityLevel: 'medium',
    priceRangeHint: 'typically 60–100 USD/barrel',
    priceRange: [40, 120],
    assetClass: 'commodity',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
  UKOILCASH: {
    symbol: 'UKOILCASH',
    name: '布伦特原油 (UK Oil Cash CFD)',
    pricePrecision: 2,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.2, max: 1.5 },
      M30: { min: 0.3, max: 2.5 },
      H1: { min: 0.6, max: 4.5 },
      H4: { min: 1.2, max: 9.0 },
    },
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 3.5,
    volatilityLevel: 'medium',
    priceRangeHint: 'typically 65–105 USD/barrel',
    priceRange: [40, 120],
    assetClass: 'commodity',
    volumeReliable: true,
    minLots: DEFAULT_MIN_LOTS,
    maxLots: DEFAULT_MAX_LOTS,
  },
};

function hasMicroContractSuffix(rawSymbol: string): boolean {
  const normalized = rawSymbol.trim();
  if (normalized.includes('#')) return true;
  return /m$/i.test(normalized.replace(/[^A-Z0-9]/gi, ''));
}

function withLotBounds(profile: SymbolProfile, rawSymbol: string): SymbolProfile {
  const minLots = hasMicroContractSuffix(rawSymbol)
    ? MICRO_CONTRACT_MIN_LOTS
    : profile.minLots ?? DEFAULT_MIN_LOTS;

  return {
    ...profile,
    minLots,
    maxLots: profile.maxLots ?? DEFAULT_MAX_LOTS,
  };
}

/**
 * Resolve a SymbolProfile for the given symbol string.
 * Handles base-symbol stripping (e.g. GOLDm# → GOLD).
 */
export function getSymbolProfile(rawSymbol: string): SymbolProfile {
  // Try exact match first
  if (PROFILES[rawSymbol]) return withLotBounds(PROFILES[rawSymbol], rawSymbol);

  // Strip common suffixes (m, #, ., etc.) to find base symbol
  const base = rawSymbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (PROFILES[base]) return withLotBounds(PROFILES[base], rawSymbol);

  // Try prefix matching for known patterns (one-way only: input starts with known key)
  // e.g., "XAUUSDm" → matches "XAUUSD"; but "XAG" should NOT match "XAUUSD"
  for (const [key, profile] of Object.entries(PROFILES)) {
    if (base.startsWith(key)) {
      return withLotBounds(profile, rawSymbol);
    }
  }

  // Fallback: construct a generic forex profile
  return withLotBounds({
    symbol: rawSymbol,
    name: rawSymbol,
    pricePrecision: 3,
    pipValue: 0.01,
    typicalAtrRange: {
      M15: { min: 0.01, max: 1 },
      M30: { min: 0.02, max: 2 },
      H1: { min: 0.05, max: 5 },
      H4: { min: 0.1, max: 10 },
    },
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    volatilityLevel: 'medium',
    priceRangeHint: 'unknown — validate prices against current market data',
    // No priceRange for generic fallback — validation will use current price heuristic
    assetClass: 'forex',
    volumeReliable: false,
  }, rawSymbol);
}

/**
 * Cross-instrument price collision detection.
 *
 * Detects when an LLM output price is suspiciously closer to another instrument's
 * current price than to the target instrument's current price. This catches cases
 * where static priceRange alone cannot help (e.g., XAGUSD $36 vs USOILCASH $65
 * both fit within overlapping priceRange bands, and JPY crosses all cluster
 * around ¥130-250).
 *
 * Returns the suspect instrument symbol if the price appears to belong to it,
 * or null if the price is legitimate for the target instrument.
 */
export function detectCrossInstrumentPrice(
  targetSymbol: string,
  price: number,
  currentPrice: number,
  allCurrentPrices: Record<string, number>,
): string | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  const targetProfile = getSymbolProfile(targetSymbol);

  for (const [otherSymbol, otherPrice] of Object.entries(allCurrentPrices)) {
    // Skip self
    if (otherSymbol === targetSymbol) continue;
    // Skip if other price is unavailable
    if (!Number.isFinite(otherPrice) || otherPrice <= 0) continue;

    const otherProfile = getSymbolProfile(otherSymbol);

    // Only check instruments in a different asset class or price tier
    // (same-asset-class instruments at similar levels, e.g., USOILCASH vs UKOILCASH, are expected to have similar prices)
    if (targetProfile.assetClass === otherProfile.assetClass && targetProfile.assetClass !== 'forex') {
      continue;  // Same non-forex asset class → price similarity is expected, skip
    }

    // For JPY crosses: they share 'forex' asset class, but different base currencies
    // Allow GBPJPY/EURJPY/USDJPY cross-contamination check
    // (they are different instruments even though both are 'forex')

    const distToOther = Math.abs(price - otherPrice);
    const distToTarget = Math.abs(price - currentPrice);

    // If the price is much closer to another instrument's current price than to our own
    const ratio = distToTarget > 0 ? distToOther / distToTarget : Infinity;

    // Heuristic: if the price is within ±8% of another instrument's live price
    // AND more than 3x closer to that price than to our own → cross-instrument contamination
    const nearOther = distToOther / otherPrice < 0.08;  // within 8% of other instrument
    const closerToOther = ratio < 0.33;                    // 3x closer to other than self

    if (nearOther && closerToOther) {
      return otherSymbol;
    }
  }

  return null;
}
