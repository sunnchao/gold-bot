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

export function orderTypeForAIApproveSignal(price: number, entry: number, atr: number, side: string): string {
  if (atr <= 0) {
    return 'market';
  }
  if (Math.abs(price - entry) <= atr * 0.3) {
    return 'market';
  }
  if (side === 'BUY') {
    return entry <= price ? 'BUY_LIMIT' : 'BUY_STOP';
  }
  return entry >= price ? 'SELL_LIMIT' : 'SELL_STOP';
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
