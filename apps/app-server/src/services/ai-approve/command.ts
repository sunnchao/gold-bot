import type { CommandCandidate, EaRecord } from '@gold-bot/persistence';
import {
  calcAIApproveLots,
  firstPositiveAIApproveTakeProfit,
  pickAIApproveEntryPrice,
  round2,
  type AIApproveOrderType
} from './rules.js';

export type AIApproveCommandInput = {
  accountId: string;
  symbol: string;
  tradePlan: EaRecord;
  riskGate: EaRecord;
  nowIso: string;
  orderType: AIApproveOrderType;
};

export function buildAIApproveCommandCandidate(input: AIApproveCommandInput): CommandCandidate {
  const side = stringField(input.tradePlan, 'side').toUpperCase();
  const entryZone = recordField(input.tradePlan, 'entry_zone');
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? 0 : numberField(entryZone, 'max');
  const entry = pickAIApproveEntryPrice(entryZone);
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
    tp: round2(firstPositiveAIApproveTakeProfit(arrayNumberField(input.tradePlan, 'take_profit'))),
    lots: round2(calcAIApproveLots(numberField(input.tradePlan, 'max_lots'))),
    order_type: input.orderType,
    ...(input.orderType === 'market' ? {} : { expiration: unixSeconds(input.nowIso) + 4 * 60 * 60 }),
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
