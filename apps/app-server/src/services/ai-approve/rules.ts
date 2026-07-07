import type { EaRecord } from '@gold-bot/persistence';

export function pickAIApproveEntryPrice(entryZone: EaRecord | undefined): number {
  const min = entryZone == null ? 0 : numberField(entryZone, 'min');
  const max = entryZone == null ? 0 : numberField(entryZone, 'max');
  if (min <= 0 || max <= 0) {
    return 0;
  }
  return min === max ? min : (min + max) / 2;
}

export function calcAIApproveLots(maxLots: number): number {
  if (maxLots <= 0) {
    return 0;
  }
  const lots = Math.ceil((maxLots * 0.5) / 0.01) * 0.01;
  if (lots < 0.01) {
    return 0;
  }
  if (lots > 0.01) {
    return 0.01;
  }
  return lots;
}

export function firstPositiveAIApproveTakeProfit(values: number[]): number {
  return values.find((value) => value > 0) ?? 0;
}

export type AIApproveOrderType = 'market' | 'BUY_LIMIT' | 'SELL_LIMIT';

export type AIApproveOrderIntentResult =
  | { accepted: true; orderType: AIApproveOrderType }
  | { accepted: false; reason: string };

export type AIApproveProtectionResult =
  | { accepted: true }
  | { accepted: false; reason: string };

export function resolveAIApproveOrderIntent(
  tradePlan: EaRecord,
  currentPrice: number,
  entry: number,
  h1Atr: number
): AIApproveOrderIntentResult {
  const side = stringField(tradePlan, 'side').trim().toLowerCase();
  const executionType = stringField(tradePlan, 'execution_type').trim().toLowerCase();
  const requestedRaw = stringField(tradePlan, 'requested_order_type').trim().toUpperCase();
  const requestedOrderType = requestedRaw === 'MARKET' ? 'market' : requestedRaw;

  if (executionType === 'stop' || requestedRaw === 'BUY_STOP' || requestedRaw === 'SELL_STOP') {
    return { accepted: false, reason: 'stop_order.disabled' };
  }

  if (executionType === '' || requestedOrderType === '') {
    return { accepted: false, reason: 'order_intent.missing' };
  }

  if (
    (executionType === 'market' && requestedOrderType !== 'market') ||
    (executionType === 'limit' && requestedOrderType === 'market')
  ) {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (requestedOrderType === 'BUY_LIMIT' && side !== 'buy') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (requestedOrderType === 'SELL_LIMIT' && side !== 'sell') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }

  if (executionType === 'market' || requestedOrderType === 'market') {
    const allowedDistance = h1Atr > 0 ? h1Atr * 0.3 : 0;
    if (Math.abs(currentPrice - entry) > allowedDistance) {
      return { accepted: false, reason: 'market_entry_mismatch' };
    }
    return { accepted: true, orderType: 'market' };
  }

  if (requestedOrderType === 'BUY_LIMIT') {
    if (side !== 'buy' || entry > currentPrice) {
      return { accepted: false, reason: 'limit_direction_mismatch' };
    }
    return { accepted: true, orderType: 'BUY_LIMIT' };
  }

  if (requestedOrderType === 'SELL_LIMIT') {
    if (side !== 'sell' || entry < currentPrice) {
      return { accepted: false, reason: 'limit_direction_mismatch' };
    }
    return { accepted: true, orderType: 'SELL_LIMIT' };
  }

  return { accepted: false, reason: 'order_intent.missing' };
}

export function validateAIApproveProtectionDirection(tradePlan: EaRecord, entry: number): AIApproveProtectionResult {
  const side = stringField(tradePlan, 'side').trim().toUpperCase();
  const stopLoss = numberField(tradePlan, 'stop_loss');
  const takeProfit = firstPositiveAIApproveTakeProfit(arrayNumberField(tradePlan, 'take_profit'));
  if (entry <= 0 || stopLoss <= 0 || takeProfit <= 0) {
    return { accepted: false, reason: 'protection.invalid_direction' };
  }
  if (side === 'BUY' && stopLoss < entry && takeProfit > entry) {
    return { accepted: true };
  }
  if (side === 'SELL' && stopLoss > entry && takeProfit < entry) {
    return { accepted: true };
  }
  return { accepted: false, reason: 'protection.invalid_direction' };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function arrayNumberField(record: EaRecord, field: string): number[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
}
