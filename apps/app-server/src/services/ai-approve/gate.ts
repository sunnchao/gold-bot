import { type EaRecord, type EaStore, type PositionStateRecord } from '@gold-bot/persistence';
import {
  calcAIApproveLots,
  pickAIApproveEntryPrice,
  resolveAIApproveExecutableTakeProfits,
  resolveAIApproveOrderIntent,
  validateAIApproveProtectionDirection,
  type AIApproveOrderType
} from './rules.js';

export const AI_APPROVE_COOLDOWN_MS = 30 * 60 * 1000;

// 每品种每日 AI 信号限额（Phase 4.1）：实盘数据 XAUUSD 单日最多 8 笔 AI 信号
// （含同日反向互相止损），限制为每 UTC 日每品种 2 笔。
export const AI_APPROVE_MAX_DAILY_SIGNALS_PER_SYMBOL = 2;

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
  positionStates?: PositionStateRecord[];
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

function normalizeSymbolForMatch(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export async function evaluateAIApprovePendingGate(input: AIApprovePendingGateInput): Promise<AIApprovePendingGateResult> {
  const registration = await input.store.getRegistration(input.accountId);
  const aiSymbols = stringArrayField(registration, 'ai_symbols');
  const normalizedSymbol = normalizeSymbolForMatch(input.symbol);
  const tradableSymbol = aiSymbols.find((symbol) => normalizeSymbolForMatch(symbol) === normalizedSymbol);
  if (aiSymbols.length === 0 || !tradableSymbol) {
    return reject('account.symbol_not_loaded');
  }

  const tick = (await input.store.getLatestTick(input.accountId, tradableSymbol)) ?? {};
  const currentPrice = currentPriceFromTick(tick);
  const executionPrice = executionPriceFromTick(tick, stringField(input.tradePlan, 'side'));
  if (currentPrice <= 0) {
    return reject('current_price.missing');
  }

  const entry = pickAIApproveEntryPrice(recordField(input.tradePlan, 'entry_zone'));
  if (entry <= 0) {
    return reject('entry_zone.invalid');
  }

  const maxLots = numberField(input.tradePlan, 'max_lots');
  if (maxLots <= 0) {
    return reject('lots.too_small');
  }
  // 0 =  defer to EA FixedLots/SymbolLotsMap（不下发 cmd.lots）
  let lots = calcAIApproveLots(maxLots);

  const h1Bars = await input.store.getBars(input.accountId, tradableSymbol, 'H1');
  const h1Atr = latestAtr(h1Bars);
  const orderIntent = resolveAIApproveOrderIntent(input.tradePlan, executionPrice, entry, h1Atr);
  if (!orderIntent.accepted) {
    return reject(orderIntent.reason);
  }
  const protection = validateAIApproveProtectionDirection(input.tradePlan, entry);
  if (!protection.accepted) {
    return reject(protection.reason);
  }

  const trend = buildAIApproveTrendContext({
    D1: await input.store.getBars(input.accountId, tradableSymbol, 'D1'),
    H4: await input.store.getBars(input.accountId, tradableSymbol, 'H4'),
    H1: h1Bars,
    M30: await input.store.getBars(input.accountId, tradableSymbol, 'M30'),
    M15: await input.store.getBars(input.accountId, tradableSymbol, 'M15')
  });
  const signalDirection = stringField(input.tradePlan, 'side').trim().toLowerCase() === 'sell' ? 'BEAR' : 'BULL';
  if (trend.hasIndicatorContext) {
    if (trend.consensusDirection !== 'NEUTRAL' && trend.consensusDirection !== signalDirection && numberField(input.tradePlan, 'confidence') < 75) {
      return reject('trend.inverse_confidence');
    }
    if (trend.consensusStrength < 0.3) {
      // 手数由 EA 决定时服务端无法减半，弱趋势直接拒绝
      if (lots <= 0) {
        return reject('trend.weak_lots_below_min');
      }
      lots /= 2;
      if (lots < 0.01) {
        return reject('trend.weak_lots_below_min');
      }
    }
  }

  const positions = await input.store.getPositions(input.accountId, tradableSymbol);
  const side = stringField(input.tradePlan, 'side');
  if (hasOpenPositionOnSide(positions, tradableSymbol, side, 'ai_signal')) {
    if (booleanField(input.tradePlan, 'add_on') !== true) {
      return reject('position.same_side');
    }
    const averagePrice = averageEntryPrice(positions, tradableSymbol, side);
    if (averagePrice <= 0) {
      return reject('position.average_entry_missing');
    }
    const m30Atr = latestAtr(await input.store.getBars(input.accountId, tradableSymbol, 'M30'));
    if (m30Atr <= 0) {
      return reject('position.m30_atr_missing');
    }
    const addOnType = stringField(input.tradePlan, 'add_on_type');
    const addOnLevel = numberField(input.tradePlan, 'add_on_level') || 1;
    const spacingMultiplier = addOnType === 'adverse'
      ? (addOnLevel >= 3 ? 2.0 : addOnLevel === 2 ? 1.5 : 1.0)
      : 1.0;
    if (Math.abs(entry - averagePrice) < spacingMultiplier * m30Atr) {
      return reject('position.add_on_distance');
    }

    // 实际下单手数由 EA 配置决定；加仓比例用 max_lots 作为意图上限做服务端校验
    const sizeForAddOnLimit = lots > 0 ? lots : maxLots;

    if (addOnType === 'favorable') {
      const existingLots = totalLotsOnSide(positions, tradableSymbol, side);
      if (existingLots <= 0) {
        return reject('position.favorable_add_no_existing_lots');
      }
      const profitAtr = calculateProfitAtr(positions, tradableSymbol, side, currentPrice, m30Atr);
      if (profitAtr < 1.0) {
        return reject('position.favorable_add_profit_not_enough');
      }
      if (sizeForAddOnLimit > existingLots * 0.5) {
        return reject('position.favorable_add_lots_too_large');
      }
    }

    if (addOnType === 'adverse') {
      const existingLots = totalLotsOnSide(positions, tradableSymbol, side);
      if (existingLots <= 0) {
        return reject('position.adverse_add_no_existing_lots');
      }

      const lossAtr = calculateLossAtr(positions, tradableSymbol, side, currentPrice, m30Atr);
      const level = addOnLevel >= 1 && addOnLevel <= 3 ? addOnLevel : inferAdverseLevel(lossAtr);
      const lossThreshold = level >= 3 ? 3.5 : level === 2 ? 2.0 : 1.0;
      if (lossAtr < lossThreshold) {
        return reject('position.adverse_add_loss_not_enough');
      }

      const positionStates = input.positionStates ?? await input.store.loadPositionStates(input.accountId, tradableSymbol);
      const addOnMeta = latestAdverseAddOnState(positionStates);
      const intervalMs = level >= 3 ? 90 * 60 * 1000 : level === 2 ? 45 * 60 * 1000 : 0;
      if (intervalMs > 0 && addOnMeta.lastAddOnTime.length > 0) {
        const elapsed = nowMillis(input.nowIso) - nowMillis(addOnMeta.lastAddOnTime);
        if (elapsed >= 0 && elapsed < intervalMs) {
          return reject('position.adverse_add_interval_active');
        }
      }

      const maxAddCount = numberField(input.tradePlan, 'max_add_count') || 2;
      if (addOnMeta.addOnCount >= maxAddCount) {
        return reject('position.adverse_add_count_exceeded');
      }

      if (sizeForAddOnLimit > existingLots * 0.6) {
        return reject('position.adverse_add_single_lots_too_large');
      }

      const initialLots = largestLotsOnSide(positions, tradableSymbol, side);
      if (initialLots > 0 && addOnMeta.addOnCount > 0 && existingLots - initialLots + sizeForAddOnLimit > initialLots * 1.5) {
        return reject('position.adverse_add_cumulative_lots_exceeded');
      }

      const maxTotalLots = numberField(input.tradePlan, 'max_total_lots');
      if (maxTotalLots > 0 && existingLots + sizeForAddOnLimit > maxTotalLots) {
        return reject('position.adverse_add_total_lots_exceeded');
      }

      const heartbeat = await input.store.getHeartbeat(input.accountId);
      const balance = numberField(heartbeat ?? {}, 'balance');
      const equity = numberField(heartbeat ?? {}, 'equity');
      if (balance > 0 && equity > 0) {
        const drawdownPct = ((balance - equity) / balance) * 100;
        if (drawdownPct >= 5.0) {
          return reject('position.adverse_add_account_drawdown_exceeded');
        }
      }
    }
  }

  if (await input.store.hasActiveAIApprovePending(input.accountId, tradableSymbol, side, input.nowIso)) {
    return reject('pending.duplicate');
  }

  // 每品种每日限额（Phase 4.1）：当日（UTC）该品种已下发的 AI 信号 ≥ 上限时拒绝，
  // 阻断同日高频反向互扫。draft/shadow_only 不计入（未真正下发）。
  if (await countAIApproveSignalsToday(input.store, input.accountId, tradableSymbol, input.nowIso) >= AI_APPROVE_MAX_DAILY_SIGNALS_PER_SYMBOL) {
    return reject('daily_limit.symbol');
  }

  if (input.cooldown?.active(tradableSymbol, input.nowIso, AI_APPROVE_COOLDOWN_MS) === true) {
    return reject('cooldown.active');
  }

  if (h1Atr > 0 && Math.abs(currentPrice - entry) > h1Atr * 3) {
    return reject('entry.too_far_from_market');
  }

  // R:R 下限过滤：实盘数据显示约40%的AI信号 R:R < 1.0（含0.25、0.35等），
  // 数学期望接近负值。要求最低1.25，过滤无效入场同时保留高质量信号。
  // 市价单以当前执行价（bid/ask）计算，限价单以指定入场价计算，两者不同。
  const stopLoss = numberField(input.tradePlan, 'stop_loss');
  const takeProfitValues = arrayNumberField(input.tradePlan, 'take_profit');
  const rrEntry = orderIntent.orderType === 'market' ? executionPrice : entry;
  const takeProfits = resolveAIApproveExecutableTakeProfits({
    side: signalDirection === 'BULL' ? 'buy' : 'sell',
    entry: rrEntry,
    stopLoss,
    takeProfitValues
  });
  if (!takeProfits.accepted) {
    return reject(takeProfits.reason);
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


/**
 * 当日（UTC）该品种已进入队列的 ai_approve 信号数。按 created_at 的 UTC 日期
 * 与 nowIso 同日计数；queued/delivered/acked/failed/superseded 都算"已下发过"，
 * draft/shadow_only/rejected 不算（未真正下发）。
 */
async function countAIApproveSignalsToday(store: EaStore, accountId: string, symbol: string, nowIso: string): Promise<number> {
  const today = nowIso.slice(0, 10);
  if (today.length !== 10) {
    return 0;
  }
  const commands = await store.listCommands(accountId);
  const wantSymbol = symbol.trim().toUpperCase();
  return commands.filter((command) => {
    if (command.source !== 'ai_approve') {
      return false;
    }
    if (command.status === 'draft' || command.status === 'shadow_only' || command.status === 'rejected') {
      return false;
    }
    const commandSymbol = stringField(command as EaRecord, 'symbol').trim().toUpperCase();
    if (commandSymbol !== wantSymbol) {
      return false;
    }
    return command.created_at.slice(0, 10) === today;
  }).length;
}

function currentPriceFromTick(tick: EaRecord): number {
  const bid = numberField(tick, 'bid');
  const ask = numberField(tick, 'ask');
  if (bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return ask || bid;
}

function executionPriceFromTick(tick: EaRecord, side: string): number {
  const normalizedSide = side.trim().toLowerCase();
  const bid = numberField(tick, 'bid');
  const ask = numberField(tick, 'ask');
  if (normalizedSide === 'buy') {
    return ask || bid;
  }
  if (normalizedSide === 'sell') {
    return bid || ask;
  }
  return currentPriceFromTick(tick);
}

function buildAIApproveTrendContext(barsByTimeframe: Record<'D1' | 'H4' | 'H1' | 'M30' | 'M15', EaRecord[]>): {
  consensusDirection: string;
  consensusStrength: number;
  hasIndicatorContext: boolean;
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
  ].filter((item) => item.hasIndicatorContext);
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return { consensusDirection: 'NEUTRAL', consensusStrength: 0, hasIndicatorContext: false };
  }
  const bullWeight = weights.filter((item) => item.direction === 'BULL').reduce((sum, item) => sum + item.weight, 0);
  const bearWeight = weights.filter((item) => item.direction === 'BEAR').reduce((sum, item) => sum + item.weight, 0);
  return {
    consensusDirection: bullWeight > bearWeight ? 'BULL' : bearWeight > bullWeight ? 'BEAR' : 'NEUTRAL',
    consensusStrength: weights.reduce((sum, item) => sum + item.weight * trendConfidence(item.direction, item.adx), 0) / totalWeight,
    hasIndicatorContext: true
  };
}

function barDirection(bars: EaRecord[]): { direction: string; adx: number; hasIndicatorContext: boolean } {
  const last = bars.at(-1);
  if (last == null) {
    return { direction: 'NEUTRAL', adx: 0, hasIndicatorContext: false };
  }
  const ema20 = numberField(last, 'ema20') || numberField(last, 'EMA20');
  const ema50 = numberField(last, 'ema50') || numberField(last, 'EMA50');
  const close = numberField(last, 'close') || numberField(last, 'Close');
  const adx = numberField(last, 'adx') || numberField(last, 'ADX');
  const hasIndicatorContext = ema20 > 0 && ema50 > 0 && close > 0 && adx > 0;
  if (!hasIndicatorContext) {
    return { direction: 'NEUTRAL', adx, hasIndicatorContext: false };
  }
  if (ema20 > ema50 && close > ema20) {
    return { direction: 'BULL', adx, hasIndicatorContext };
  }
  if (ema20 < ema50 && close < ema20) {
    return { direction: 'BEAR', adx, hasIndicatorContext };
  }
  return { direction: 'NEUTRAL', adx, hasIndicatorContext };
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

function stringArrayField(record: EaRecord | undefined, field: string): string[] {
  const value = record?.[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function booleanField(record: EaRecord, field: string): boolean {
  return record[field] === true;
}

function arrayNumberField(record: EaRecord, field: string): number[] {
  const value = record[field];
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
}

function totalLotsOnSide(positions: EaRecord[], symbol: string, side: string): number {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  let total = 0;
  for (const position of positions) {
    const positionSymbol = stringField(position, 'symbol');
    if (wantSymbol.length > 0 && positionSymbol.length > 0 && positionSymbol.trim().toUpperCase() !== wantSymbol) {
      continue;
    }
    if (stringField(position, 'type').trim().toUpperCase() !== wantSide) {
      continue;
    }
    const lots = numberField(position, 'lots');
    if (lots > 0) {
      total += lots;
    }
  }
  return total;
}

function calculateProfitAtr(positions: EaRecord[], symbol: string, side: string, currentPrice: number, atr: number): number {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  let totalLots = 0;
  let weightedProfit = 0;
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
    if (lots <= 0 || openPrice <= 0 || currentPrice <= 0 || atr <= 0) {
      continue;
    }
    const priceDiff = wantSide === 'BUY' ? currentPrice - openPrice : openPrice - currentPrice;
    totalLots += lots;
    weightedProfit += lots * priceDiff;
  }
  if (totalLots <= 0 || atr <= 0) {
    return 0;
  }
  return (weightedProfit / totalLots) / atr;
}

function calculateLossAtr(positions: EaRecord[], symbol: string, side: string, currentPrice: number, atr: number): number {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  let totalLots = 0;
  let weightedLoss = 0;
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
    if (lots <= 0 || openPrice <= 0 || currentPrice <= 0 || atr <= 0) {
      continue;
    }
    const priceDiff = wantSide === 'BUY' ? openPrice - currentPrice : currentPrice - openPrice;
    totalLots += lots;
    weightedLoss += lots * priceDiff;
  }
  if (totalLots <= 0 || atr <= 0) {
    return 0;
  }
  return (weightedLoss / totalLots) / atr;
}

function inferAdverseLevel(lossAtr: number): number {
  if (lossAtr >= 3.5) {
    return 3;
  }
  if (lossAtr >= 2.0) {
    return 2;
  }
  return 1;
}

function largestLotsOnSide(positions: EaRecord[], symbol: string, side: string): number {
  const wantSymbol = symbol.trim().toUpperCase();
  const wantSide = side.trim().toUpperCase();
  let largest = 0;
  for (const position of positions) {
    const positionSymbol = stringField(position, 'symbol');
    if (wantSymbol.length > 0 && positionSymbol.length > 0 && positionSymbol.trim().toUpperCase() !== wantSymbol) {
      continue;
    }
    if (stringField(position, 'type').trim().toUpperCase() !== wantSide) {
      continue;
    }
    const lots = numberField(position, 'lots');
    if (lots > largest) {
      largest = lots;
    }
  }
  return largest;
}

type AdverseAddOnMeta = {
  lastAddOnTime: string;
  lastAddOnPrice: number;
  addOnCount: number;
};

function latestAdverseAddOnState(positionStates: PositionStateRecord[]): AdverseAddOnMeta {
  let latestTime = '';
  let latestPrice = 0;
  let addOnCount = 0;
  for (const state of positionStates) {
    const count = Number(state.add_on_count) || 0;
    if (count > addOnCount) {
      addOnCount = count;
    }
    const lastTime = typeof state.last_add_on_time === 'string' ? state.last_add_on_time : '';
    if (lastTime.length > 0 && (latestTime.length === 0 || lastTime > latestTime)) {
      latestTime = lastTime;
      latestPrice = Number(state.last_add_on_price) || 0;
    }
  }
  return { lastAddOnTime: latestTime, lastAddOnPrice: latestPrice, addOnCount };
}
