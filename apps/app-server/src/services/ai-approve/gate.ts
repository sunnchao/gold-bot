import type { EaRecord, EaStore } from '@gold-bot/persistence';
import {
  calcAIApproveLots,
  pickAIApproveEntryPrice,
  resolveAIApproveOrderIntent,
  validateAIApproveProtectionDirection,
  type AIApproveOrderType
} from './rules.js';

export const AI_APPROVE_COOLDOWN_MS = 30 * 60 * 1000;

export type AIApproveCooldown = {
  active(symbol: string, nowIso: string, ttlMs?: number): boolean;
  mark(symbol: string, nowIso: string): void;
};

export type AIApprovePendingGateInput = {
  store: EaStore;
  accountId: string;
  symbol: string;
  tradePlan: EaRecord;
  nowIso: string;
  cooldown?: AIApproveCooldown;
};

export type AIApprovePendingGateResult =
  | {
      accepted: true;
      currentPrice: number;
      entry: number;
      lots: number;
      h1Atr: number;
      orderType: AIApproveOrderType;
    }
  | {
      accepted: false;
      reason: string;
    };

export function createAIApproveCooldown(): AIApproveCooldown {
  const lastBySymbol = new Map<string, number>();
  return {
    active(symbol, nowIso, ttlMs = AI_APPROVE_COOLDOWN_MS) {
      const previous = lastBySymbol.get(cooldownKey(symbol));
      return previous != null && nowMillis(nowIso) - previous < ttlMs;
    },
    mark(symbol, nowIso) {
      lastBySymbol.set(cooldownKey(symbol), nowMillis(nowIso));
    }
  };
}

export async function evaluateAIApprovePendingGate(input: AIApprovePendingGateInput): Promise<AIApprovePendingGateResult> {
  const tick = (await input.store.getLatestTick(input.accountId, input.symbol)) ?? {};
  const currentPrice = currentPriceFromTick(tick);
  if (currentPrice <= 0) {
    return reject('current_price.missing');
  }

  const entry = pickAIApproveEntryPrice(recordField(input.tradePlan, 'entry_zone'));
  if (entry <= 0) {
    return reject('entry_zone.invalid');
  }

  let lots = calcAIApproveLots(numberField(input.tradePlan, 'max_lots'));
  if (lots <= 0) {
    return reject('lots.too_small');
  }

  const h1Bars = await input.store.getBars(input.accountId, input.symbol, 'H1');
  const h1Atr = latestAtr(h1Bars);
  const orderIntent = resolveAIApproveOrderIntent(
    resolveGateOrderIntentPlan(input.tradePlan, currentPrice, entry, h1Atr),
    currentPrice,
    entry,
    h1Atr
  );
  if (!orderIntent.accepted) {
    return reject(orderIntent.reason);
  }
  const protection = validateAIApproveProtectionDirection(input.tradePlan, entry);
  if (!protection.accepted) {
    return reject(protection.reason);
  }

  const trend = buildAIApproveTrendContext({
    D1: await input.store.getBars(input.accountId, input.symbol, 'D1'),
    H4: await input.store.getBars(input.accountId, input.symbol, 'H4'),
    H1: h1Bars,
    M30: await input.store.getBars(input.accountId, input.symbol, 'M30'),
    M15: await input.store.getBars(input.accountId, input.symbol, 'M15')
  });
  const signalDirection = stringField(input.tradePlan, 'side') === 'SELL' ? 'BEAR' : 'BULL';
  if (trend.consensusDirection !== 'NEUTRAL' && trend.consensusDirection !== signalDirection && numberField(input.tradePlan, 'confidence') < 75) {
    return reject('trend.inverse_confidence');
  }
  if (trend.consensusStrength < 0.3) {
    lots /= 2;
    if (lots < 0.01) {
      return reject('trend.weak_lots_below_min');
    }
  }

  const positions = await input.store.getPositions(input.accountId, input.symbol);
  const side = stringField(input.tradePlan, 'side');
  if (hasOpenPositionOnSide(positions, input.symbol, side, 'ai_signal')) {
    if (booleanField(input.tradePlan, 'add_on') !== true) {
      return reject('position.same_side');
    }
    const averagePrice = averageEntryPrice(positions, input.symbol, side);
    if (averagePrice <= 0) {
      return reject('position.average_entry_missing');
    }
    const m30Atr = latestAtr(await input.store.getBars(input.accountId, input.symbol, 'M30'));
    if (m30Atr <= 0) {
      return reject('position.m30_atr_missing');
    }
    if (Math.abs(entry - averagePrice) < m30Atr) {
      return reject('position.add_on_distance');
    }
  }

  if (await input.store.hasActiveAIApprovePending(input.accountId, input.symbol, side, input.nowIso)) {
    return reject('pending.duplicate');
  }

  if (input.cooldown?.active(input.symbol, input.nowIso, AI_APPROVE_COOLDOWN_MS) === true) {
    return reject('cooldown.active');
  }

  if (h1Atr > 0 && Math.abs(currentPrice - entry) > h1Atr * 3) {
    return reject('entry.too_far_from_market');
  }

  return {
    accepted: true,
    currentPrice,
    entry,
    lots,
    h1Atr,
    orderType: orderIntent.orderType
  };
}

function reject(reason: string): AIApprovePendingGateResult {
  return { accepted: false, reason };
}

function resolveGateOrderIntentPlan(tradePlan: EaRecord, currentPrice: number, entry: number, h1Atr: number): EaRecord {
  if (stringField(tradePlan, 'execution_type') !== '' || stringField(tradePlan, 'requested_order_type') !== '') {
    return tradePlan;
  }
  const side = stringField(tradePlan, 'side').trim().toLowerCase();
  const allowedMarketDistance = h1Atr > 0 ? h1Atr * 0.3 : 0;
  if (Math.abs(currentPrice - entry) <= allowedMarketDistance) {
    return { ...tradePlan, execution_type: 'market', requested_order_type: 'market' };
  }
  if (side === 'buy') {
    return { ...tradePlan, execution_type: 'limit', requested_order_type: 'BUY_LIMIT' };
  }
  if (side === 'sell') {
    return { ...tradePlan, execution_type: 'limit', requested_order_type: 'SELL_LIMIT' };
  }
  return tradePlan;
}

function currentPriceFromTick(tick: EaRecord): number {
  const bid = numberField(tick, 'bid');
  const ask = numberField(tick, 'ask');
  if (bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return ask > 0 ? ask : bid;
}

function buildAIApproveTrendContext(barsByTimeframe: Record<'D1' | 'H4' | 'H1' | 'M30' | 'M15', EaRecord[]>): {
  consensusDirection: string;
  consensusStrength: number;
} {
  const d1 = barDirection(barsByTimeframe.D1);
  const h4 = barDirection(barsByTimeframe.H4);
  const h1 = barDirection(barsByTimeframe.H1);
  const m30 = barDirection(barsByTimeframe.M30);
  const weights = [
    { ...d1, weight: 0.05 },
    { ...h4, weight: 0.25 },
    { ...h1, weight: 0.35 },
    { ...m30, weight: 0.35 }
  ];
  const bullWeight = weights.filter((item) => item.direction === 'BULL').reduce((sum, item) => sum + item.weight, 0);
  const bearWeight = weights.filter((item) => item.direction === 'BEAR').reduce((sum, item) => sum + item.weight, 0);
  return {
    consensusDirection: bullWeight > bearWeight ? 'BULL' : bearWeight > bullWeight ? 'BEAR' : 'NEUTRAL',
    consensusStrength: weights.reduce((sum, item) => sum + item.weight * trendConfidence(item.direction, item.adx), 0)
  };
}

function barDirection(bars: EaRecord[]): { direction: string; adx: number } {
  const last = bars.at(-1);
  if (last == null) {
    return { direction: 'NEUTRAL', adx: 0 };
  }
  const ema20 = numberField(last, 'ema20') || numberField(last, 'EMA20');
  const ema50 = numberField(last, 'ema50') || numberField(last, 'EMA50');
  const close = numberField(last, 'close') || numberField(last, 'Close');
  const adx = numberField(last, 'adx') || numberField(last, 'ADX');
  if (ema20 > ema50 && close > ema20) {
    return { direction: 'BULL', adx };
  }
  if (ema20 < ema50 && close < ema20) {
    return { direction: 'BEAR', adx };
  }
  return { direction: 'NEUTRAL', adx };
}

function trendConfidence(direction: string, adx: number): number {
  if (direction === 'NEUTRAL') {
    return 0;
  }
  if (adx < 20) {
    return 0.3;
  }
  if (adx <= 30) {
    return 0.6;
  }
  return 0.9;
}

function hasOpenPositionOnSide(positions: EaRecord[], symbol: string, side: string, skipStrategy: string): boolean {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  for (const position of positions) {
    const positionSymbol = stringField(position, 'symbol');
    if (wantSymbol.length > 0 && positionSymbol.length > 0 && positionSymbol.trim().toUpperCase() !== wantSymbol) {
      continue;
    }
    const strategy = stringField(position, 'strategy');
    if (skipStrategy.length > 0 && strategy.length > 0 && strategy !== skipStrategy) {
      continue;
    }
    if (stringField(position, 'type').trim().toUpperCase() === wantSide) {
      return true;
    }
  }
  return false;
}

function averageEntryPrice(positions: EaRecord[], symbol: string, side: string): number {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  let totalLots = 0;
  let weightedPrice = 0;
  for (const position of positions) {
    const positionSymbol = stringField(position, 'symbol');
    if (wantSymbol.length > 0 && positionSymbol.length > 0 && positionSymbol.trim().toUpperCase() !== wantSymbol) {
      continue;
    }
    if (stringField(position, 'type').trim().toUpperCase() !== wantSide) {
      continue;
    }
    const lots = numberField(position, 'lots');
    const openPrice = numberField(position, 'open_price') || numberField(position, 'openPrice');
    if (lots <= 0 || openPrice <= 0) {
      continue;
    }
    totalLots += lots;
    weightedPrice += lots * openPrice;
  }
  return totalLots <= 0 ? 0 : weightedPrice / totalLots;
}

function latestAtr(bars: EaRecord[]): number {
  const last = bars.at(-1);
  return last == null ? 0 : numberField(last, 'atr') || numberField(last, 'ATR');
}

function cooldownKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function nowMillis(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : Date.now();
}

function recordField(record: EaRecord, field: string): EaRecord | undefined {
  const value = record[field];
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as EaRecord : undefined;
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function booleanField(record: EaRecord, field: string): boolean {
  return record[field] === true;
}
