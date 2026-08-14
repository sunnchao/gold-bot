import type { CommandCandidate, EaRecord } from '@gold-bot/persistence';
import {
  pickAIApproveEntryPrice,
  resolveAIApproveExecutableTakeProfits,
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
  const takeProfitValues = arrayNumberField(input.tradePlan, 'take_profit');
  const stopLoss = numberField(input.tradePlan, 'stop_loss');
  const takeProfits = resolveAIApproveExecutableTakeProfits({
    side,
    entry,
    stopLoss,
    takeProfitValues
  });
  if (!takeProfits.accepted) {
    throw new Error(`AI approve command received invalid ${takeProfits.label}: ${takeProfits.reason}`);
  }
  const candidate: CommandCandidate = {
    command_id: `ai_pending_${input.accountId}_${input.symbol}_${unixNanos(input.nowIso)}`,
    action: 'SIGNAL',
    symbol: input.symbol,
    type: side,
    entry,
    entry_min: entryMin,
    entry_max: entryMax,
    sl: stopLoss,
    tp: takeProfits.legacyTakeProfit,
    tp1: takeProfits.tp1,
    tp2: takeProfits.tp2,
    lots: 0,
    order_type: input.orderType,
    expiration,
    score: confidence,
    strategy: 'ai_signal',
    source: 'ai_approve',
    confidence,
    decision_id: stringField(input.tradePlan, 'decision_id'),
    reason: stringField(input.tradePlan, 'narrative'),
    trade_plan_mode: stringField(input.tradePlan, 'mode'),
    risk_gate: input.riskGate,
    tp_split: takeProfits.tpSplit
  };

  const addOnType = stringField(input.tradePlan, 'add_on_type');
  if ((addOnType === 'favorable' || addOnType === 'adverse') && input.positions != null) {
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
      const openPrices = positions
        .map((pos) => numberField(pos, 'open_price') || numberField(pos, 'openPrice'))
        .filter((price) => price > 0);
      const groupBestSl = openPrices.length === 0
        ? 0
        : addOnType === 'adverse'
          ? (side === 'BUY' ? Math.min(...openPrices) : Math.max(...openPrices))
          : (side === 'BUY' ? Math.max(...openPrices) : Math.min(...openPrices));

      candidate.scale_in_parent_ticket = largestTicket;
      candidate.weighted_avg_entry = round2(groupAvgEntry);
      candidate.unified_sl = round2(groupBestSl);
      candidate.scale_in_count = positions.length;

      if (addOnType === 'adverse') {
        candidate.scale_in_add_on_type = 'adverse';
        candidate.scale_in_add_on_level = numberField(input.tradePlan, 'add_on_level') || 1;
      }
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
