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
  positions?: EaRecord[];
};

export function buildAIApproveCommandCandidate(input: AIApproveCommandInput): CommandCandidate {
  const side = stringField(input.tradePlan, 'side').toUpperCase();
  const entryZone = recordField(input.tradePlan, 'entry_zone');
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? 0 : numberField(entryZone, 'max');
  const entry = pickAIApproveEntryPrice(entryZone);
  const confidence = numberField(input.tradePlan, 'confidence');
  const expiration = unixSeconds(input.nowIso) + 4 * 60 * 60;
  const candidate: CommandCandidate = {
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
    expiration,
    score: confidence,
    strategy: 'ai_signal',
    source: 'ai_approve',
    confidence,
    decision_id: stringField(input.tradePlan, 'decision_id'),
    reason: stringField(input.tradePlan, 'narrative'),
    trade_plan_mode: stringField(input.tradePlan, 'mode'),
    risk_gate: input.riskGate
  };

  const addOnType = stringField(input.tradePlan, 'add_on_type');
  if (addOnType === 'favorable' && input.positions != null) {
    const positions = input.positions.filter((pos) => {
      const posSymbol = stringField(pos, 'symbol').trim().toUpperCase();
      const posSide = stringField(pos, 'type').trim().toUpperCase();
      return (posSymbol === input.symbol.trim().toUpperCase() || posSymbol === '') && posSide === side;
    });
    if (positions.length > 0) {
      const largestTicket = positions.reduce((max, pos) => {
        const ticket = numberField(pos, 'ticket');
        return ticket > max ? ticket : max;
      }, 0);
      let totalLots = 0;
      let weightedEntry = 0;
      for (const pos of positions) {
        const lots = numberField(pos, 'lots');
        const openPrice = numberField(pos, 'open_price') || numberField(pos, 'openPrice');
        if (lots > 0 && openPrice > 0) {
          totalLots += lots;
          weightedEntry += lots * openPrice;
        }
      }
      const groupAvgEntry = totalLots > 0 ? weightedEntry / totalLots : 0;
      const groupBestSl = side === 'BUY'
        ? Math.max(...positions.map((pos) => numberField(pos, 'open_price') || numberField(pos, 'openPrice')))
        : Math.min(...positions.filter((pos) => {
            const op = numberField(pos, 'open_price') || numberField(pos, 'openPrice');
            return op > 0;
          }).map((pos) => numberField(pos, 'open_price') || numberField(pos, 'openPrice')));

      candidate.scale_in_parent_ticket = largestTicket;
      candidate.weighted_avg_entry = round2(groupAvgEntry);
      candidate.unified_sl = round2(groupBestSl);
      candidate.scale_in_count = positions.length;
    }
  }

  return candidate;
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
