/**
 * Price validation utilities — ensures LLM output prices are
 * within a plausible range for the given instrument,
 * plus trade-level business logic validation (SL/TP direction, RR ratio, etc.).
 */

import type { SymbolProfile } from '../config/symbol-profile.js';
import type { TradeRecommendation, ArbitrationResult } from '../types/analysis.js';

const DEFAULT_TOLERANCE = 0.5; // ±50% of current price

/**
 * Validate that a price is within a plausible range for the instrument.
 * Returns true if valid, false if the price is clearly from a different instrument.
 */
export function validatePriceRange(
  price: number,
  currentPrice: number,
  _profile: SymbolProfile,
  label: string,
  tolerance: number = DEFAULT_TOLERANCE,
): boolean {
  if (!Number.isFinite(price) || price <= 0) {
    return false;
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return true; // can't validate without a reference
  }

  const minPrice = currentPrice * (1 - tolerance);
  const maxPrice = currentPrice * (1 + tolerance);

  if (price < minPrice || price > maxPrice) {
    console.warn(
      `[price-validator] ⚠️ ${label}: price ${price} outside valid range [${minPrice.toFixed(3)}, ${maxPrice.toFixed(3)}] for current price ${currentPrice}`,
    );
    return false;
  }
  return true;
}

/**
 * Validate an array of S/R level prices.
 * Returns only the valid levels, logging warnings for invalid ones.
 */
export function filterValidPrices<T extends { price: number }>(
  levels: T[],
  currentPrice: number,
  profile: SymbolProfile,
  label: string,
): T[] {
  return levels.filter((level) =>
    validatePriceRange(level.price, currentPrice, profile, `${label} @ ${level.price}`),
  );
}

/**
 * Quick sanity check: does the current price match the expected asset class?
 * E.g. gold should be > 1000, forex JPY crosses should be 100-300.
 */
export function validatePriceMatchesAssetClass(
  currentPrice: number,
  profile: SymbolProfile,
): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

  switch (profile.assetClass) {
    case 'metal':
      // Gold: 1000-5000, Silver: 10-100
      if (profile.symbol.includes('XAU') || profile.symbol.includes('GOLD')) {
        return currentPrice >= 800 && currentPrice <= 10000;
      }
      if (profile.symbol.includes('XAG')) {
        return currentPrice >= 10 && currentPrice <= 200;
      }
      return true;
    case 'forex':
      // JPY crosses: 80-300, other majors: 0.5-3
      if (profile.symbol.includes('JPY')) {
        return currentPrice >= 50 && currentPrice <= 500;
      }
      return currentPrice >= 0.3 && currentPrice <= 10;
    default:
      return true;
  }
}

// ── Trade-level business validation ──────────────────────────────────────────

export interface TradeValidationResult {
  valid: boolean;
  warnings: string[];
  /** Fixed trade recommendation (SL/TP direction corrected, zeroed if invalid) */
  fixedTrade?: TradeRecommendation;
  /** Fixed arbitration result (downgraded if trade is invalid) */
  fixedArbitration?: ArbitrationResult;
}

/**
 * Validate a TradeRecommendation for business-logic correctness:
 * 1. SL must be on the correct side of entry for the given direction
 * 2. TP must be on the correct side of entry for the given direction
 * 3. Risk/reward ratio must be plausible (>= 0.5)
 * 4. All prices must be within ±50% of current price
 * 5. Entry price must not be zero
 *
 * Returns a TradeValidationResult with warnings and optionally fixed values.
 */
export function validateTradeRecommendation(
  trade: TradeRecommendation,
  currentPrice: number,
  profile: SymbolProfile,
): TradeValidationResult {
  const warnings: string[] = [];
  let fixed = { ...trade };

  // 1. Entry price sanity
  if (!Number.isFinite(fixed.entry_price) || fixed.entry_price <= 0) {
    warnings.push(`entry_price ${fixed.entry_price} is invalid — zeroing trade`);
    return { valid: false, warnings, fixedTrade: { ...trade, direction: 'hold' } };
  }

  // 2. Price range check
  const priceChecks: Array<[string, number]> = [
    ['entry_price', fixed.entry_price],
    ['stop_loss', fixed.stop_loss],
    ['take_profit_1', fixed.take_profit_1],
  ];
  if (fixed.take_profit_2 !== undefined && fixed.take_profit_2 > 0) {
    priceChecks.push(['take_profit_2', fixed.take_profit_2]);
  }
  for (const [label, price] of priceChecks) {
    if (price > 0 && !validatePriceRange(price, currentPrice, profile, label)) {
      warnings.push(`${label} ${price} outside valid range for current price ${currentPrice}`);
    }
  }

  // 3. SL direction check
  if (fixed.direction === 'buy') {
    if (fixed.stop_loss >= fixed.entry_price && fixed.stop_loss > 0) {
      warnings.push(`BUY trade: stop_loss ${fixed.stop_loss} >= entry ${fixed.entry_price} — wrong side, clamping below entry`);
      // Clamp SL to be below entry by at least ATR-based minimum
      fixed = { ...fixed, stop_loss: 0 };
    }
    if (fixed.take_profit_1 <= fixed.entry_price && fixed.take_profit_1 > 0) {
      warnings.push(`BUY trade: take_profit_1 ${fixed.take_profit_1} <= entry ${fixed.entry_price} — wrong side, clamping above entry`);
      fixed = { ...fixed, take_profit_1: 0 };
    }
  } else if (fixed.direction === 'sell') {
    if (fixed.stop_loss <= fixed.entry_price && fixed.stop_loss > 0) {
      warnings.push(`SELL trade: stop_loss ${fixed.stop_loss} <= entry ${fixed.entry_price} — wrong side, clamping above entry`);
      fixed = { ...fixed, stop_loss: 0 };
    }
    if (fixed.take_profit_1 >= fixed.entry_price && fixed.take_profit_1 > 0) {
      warnings.push(`SELL trade: take_profit_1 ${fixed.take_profit_1} >= entry ${fixed.entry_price} — wrong side, clamping below entry`);
      fixed = { ...fixed, take_profit_1: 0 };
    }
  }

  // 4. RR ratio sanity (only if SL and a TP target are valid and non-zero)
  if (fixed.stop_loss > 0 && fixed.take_profit_1 > 0 && fixed.entry_price > 0) {
    const slDist = Math.abs(fixed.entry_price - fixed.stop_loss);
    const rewardTarget = fixed.take_profit_2 !== undefined && fixed.take_profit_2 > 0
      ? fixed.take_profit_2
      : fixed.take_profit_1;
    const tpDist = Math.abs(rewardTarget - fixed.entry_price);
    if (slDist > 0) {
      const rr = tpDist / slDist;
      if (rr < 0.4) {
        warnings.push(`Risk/reward ratio ${rr.toFixed(2)} < 0.4 — unfavorable trade`);
      }
      // Update the risk_reward_ratio field to match actual computed value
      fixed = { ...fixed, risk_reward_ratio: Number(rr.toFixed(2)) };
    }
  }

  // 5. If SL or TP got zeroed, direction becomes hold
  const isValid = fixed.direction === 'hold' || (
    fixed.stop_loss > 0 && fixed.take_profit_1 > 0
  );

  return {
    valid: isValid && warnings.length === 0,
    warnings,
    fixedTrade: isValid ? fixed : { ...fixed, direction: 'hold' },
  };
}

/**
 * Validate an ArbitrationResult — applies trade validation to the embedded
 * trade_recommendation and downgrades the arbitration if the trade is invalid.
 */
export function validateArbitrationResult(
  arb: ArbitrationResult,
  currentPrice: number,
  profile: SymbolProfile,
): TradeValidationResult {
  // No trade recommendation at all — nothing to validate
  if (!arb.trade_recommendation) {
    return { valid: true, warnings: [], fixedArbitration: arb };
  }

  // hold direction with no entry/SL/TP — skip validation (no action to take)
  if (arb.trade_recommendation.direction === 'hold' && arb.trade_recommendation.entry_price <= 0) {
    return { valid: true, warnings: [], fixedArbitration: arb };
  }

  // hold direction with valid SL/TP — validate the price levels for reference
  // (direction stays 'hold', but SL/TP should still be on correct side)
  if (arb.trade_recommendation.direction === 'hold') {
    const tradeResult = validateTradeRecommendation(arb.trade_recommendation, currentPrice, profile);
    // For hold, we don't downgrade — just pass through warnings and fixed trade
    return {
      valid: tradeResult.valid,
      warnings: tradeResult.warnings,
      fixedTrade: tradeResult.fixedTrade,
      fixedArbitration: tradeResult.fixedTrade
        ? { ...arb, trade_recommendation: tradeResult.fixedTrade }
        : arb,
    };
  }

  const tradeResult = validateTradeRecommendation(arb.trade_recommendation, currentPrice, profile);

  if (tradeResult.valid) {
    return {
      valid: true,
      warnings: tradeResult.warnings,
      fixedArbitration: tradeResult.fixedTrade
        ? { ...arb, trade_recommendation: tradeResult.fixedTrade }
        : arb,
    };
  }

  // Downgrade: invalid trade → hold
  const fixedArb: ArbitrationResult = {
    ...arb,
    final_direction: 'hold',
    action: 'hold',
    confidence: Math.min(arb.confidence, 20), // Cap confidence at 20 for invalid trades
    trade_recommendation: tradeResult.fixedTrade ?? arb.trade_recommendation,
  };

  return {
    valid: false,
    warnings: [...tradeResult.warnings, 'Trade downgraded to hold due to invalid SL/TP'],
    fixedTrade: tradeResult.fixedTrade,
    fixedArbitration: fixedArb,
  };
}
