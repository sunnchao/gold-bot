import type { CommandCandidate, EaRecord } from '@gold-bot/persistence';

export type AIApproveCommandInput = {
  accountId: string;
  symbol: string;
  tradePlan: EaRecord;
  riskGate: EaRecord;
  nowIso: string;
  currentPrice: number;
  atr: number;
};

export function buildAIApproveCommandCandidate(input: AIApproveCommandInput): CommandCandidate {
  const side = stringField(input.tradePlan, 'side').toUpperCase();
  const entryZone = recordField(input.tradePlan, 'entry_zone');
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? 0 : numberField(entryZone, 'max');
  const entry = pickEntryPrice(entryMin, entryMax);
  const confidence = numberField(input.tradePlan, 'confidence');
  return {
    command_id: `ai_pending_${input.accountId}_${input.symbol}_${unixNanos(input.nowIso)}`,
    action: 'SIGNAL',
    symbol: input.symbol,
    type: side,
    entry: round2(entry),
    entry_min: round2(entryMin),
    entry_max: round2(entryMax),
    sl: round2(numberField(input.tradePlan, 'stop_loss')),
    tp: round2(firstPositiveNumber(arrayNumberField(input.tradePlan, 'take_profit'))),
    lots: round2(calcAILots(numberField(input.tradePlan, 'max_lots'))),
    order_type: orderTypeForSignal(input.currentPrice, entry, input.atr, side),
    expiration: unixSeconds(input.nowIso) + 4 * 60 * 60,
    score: confidence,
    strategy: 'ai_signal',
    source: 'ai_approve',
    confidence,
    decision_id: stringField(input.tradePlan, 'decision_id'),
    reason: stringField(input.tradePlan, 'narrative'),
    trade_plan_mode: stringField(input.tradePlan, 'mode'),
    risk_gate: input.riskGate
  } satisfies CommandCandidate;
}

function orderTypeForSignal(price: number, entry: number, atr: number, side: string): string {
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

function pickEntryPrice(min: number, max: number): number {
  if (min <= 0 || max <= 0) {
    return 0;
  }
  return min === max ? min : (min + max) / 2;
}

function calcAILots(maxLots: number): number {
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

function firstPositiveNumber(values: number[]): number {
  return values.find((value) => value > 0) ?? 0;
}

function unixNanos(value: string): string {
  return (BigInt(unixMillis(value)) * 1_000_000n).toString();
}

function unixSeconds(value: string): number {
  return Math.floor(unixMillis(value) / 1000);
}

function unixMillis(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : Date.now();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

function arrayNumberField(record: EaRecord, field: string): number[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];
}
