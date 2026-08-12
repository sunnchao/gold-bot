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
  // AI signal 手数交给 EA 通用配置（UseFixedLots / FixedLots / SymbolLotsMap）。
  // 服务端不下发 lots（返回 0），EA 在 cmd.lots<=0 时走 CalcLotsForStrategy。
  // max_lots 仅表示 LLM 有开仓意图，并用于 gate 加仓比例上限校验。
  if (maxLots <= 0) {
    return 0;
  }
  return 0;
}

export function firstPositiveAIApproveTakeProfit(values: number[]): number {
  return values.find((value) => value > 0) ?? 0;
}

export function primaryAIApproveTakeProfit(values: number[]): number {
  const positiveValues = values.filter((value) => value > 0);
  return positiveValues.at(-1) ?? 0;
}

export const AI_APPROVE_MIN_RR = 1.25;

export type AIApproveOrderType = 'market' | 'BUY_LIMIT' | 'SELL_LIMIT';

export type AIApproveOrderIntentResult =
  | { accepted: true; orderType: AIApproveOrderType }
  | { accepted: false; reason: string };

export type AIApproveProtectionResult =
  | { accepted: true }
  | { accepted: false; reason: string };

export type AIApproveTakeProfitLabel = 'TP1' | 'TP2';

export type AIApproveExecutableTakeProfit = {
  label: AIApproveTakeProfitLabel;
  value: number;
  rr: number;
};

export type AIApproveExecutableTakeProfitsResult =
  | {
      accepted: true;
      tp1: number;
      tp2: number;
      legacyTakeProfit: number;
      tpSplit: boolean;
      targets: AIApproveExecutableTakeProfit[];
    }
  | {
      accepted: false;
      reason: 'rr.invalid' | 'rr.below_minimum';
      label: AIApproveTakeProfitLabel;
    };

export function resolveAIApproveExecutableTakeProfits(input: {
  side: string;
  entry: number;
  stopLoss: number;
  takeProfitValues: number[];
  minRiskReward?: number;
}): AIApproveExecutableTakeProfitsResult {
  const side = input.side.trim().toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return rejectTakeProfit('rr.invalid', 'TP1');
  }
  if (!isPositiveFinite(input.entry) || !isPositiveFinite(input.stopLoss)) {
    return rejectTakeProfit('rr.invalid', 'TP1');
  }

  const risk = side === 'buy' ? input.entry - input.stopLoss : input.stopLoss - input.entry;
  if (!isPositiveFinite(risk)) {
    return rejectTakeProfit('rr.invalid', 'TP1');
  }

  const positiveTargets: number[] = [];
  for (const value of input.takeProfitValues) {
    if (!Number.isFinite(value)) {
      return rejectTakeProfit('rr.invalid', labelForTargetIndex(positiveTargets.length));
    }
    if (value > 0) {
      positiveTargets.push(value);
    }
  }
  if (positiveTargets.length === 0) {
    return rejectTakeProfit('rr.invalid', 'TP1');
  }

  const orderedTargets = positiveTargets
    .slice()
    .sort((left, right) => side === 'buy' ? left - right : right - left);
  const executableValues = uniqueSortedNumbers(orderedTargets).slice(0, 2);
  const minRiskReward = input.minRiskReward ?? AI_APPROVE_MIN_RR;
  const targets: AIApproveExecutableTakeProfit[] = [];
  for (let index = 0; index < executableValues.length; index += 1) {
    const value = executableValues[index];
    const label = labelForTargetIndex(index);
    const reward = side === 'buy' ? value - input.entry : input.entry - value;
    if (!isPositiveFinite(reward)) {
      return rejectTakeProfit('rr.invalid', label);
    }
    const rr = reward / risk;
    if (!Number.isFinite(rr)) {
      return rejectTakeProfit('rr.invalid', label);
    }
    // 盈亏比严格按最远目标（TP2 / primary）计算并卡 1.25；
    // TP1 只要求方向/几何有效，不逐子单卡 R:R。
    const isPrimary = index === executableValues.length - 1;
    if (isPrimary && minRiskReward > 0 && rr + 1e-12 < minRiskReward) {
      return rejectTakeProfit('rr.below_minimum', label);
    }
    targets.push({ label, value, rr });
  }

  const tp1 = targets[0]?.value ?? 0;
  const tp2 = targets.length > 1 ? targets[1].value : 0;
  const tpSplit = tp1 > 0 && tp2 > 0 && tp1 !== tp2;
  return {
    accepted: true,
    tp1,
    tp2: tpSplit ? tp2 : 0,
    legacyTakeProfit: tpSplit ? tp2 : tp1,
    tpSplit,
    targets
  };
}

export function resolveAIApproveOrderIntent(
  tradePlan: EaRecord,
  currentPrice: number,
  entry: number,
  h1Atr: number
): AIApproveOrderIntentResult {
  const side = stringField(tradePlan, 'side').trim().toLowerCase();
  const executionType = stringField(tradePlan, 'execution_type');
  const requestedOrderType = stringField(tradePlan, 'requested_order_type');

  if (executionType === 'stop' || requestedOrderType === 'BUY_STOP' || requestedOrderType === 'SELL_STOP') {
    return { accepted: false, reason: 'stop_order.disabled' };
  }

  if (executionType === '' || requestedOrderType === '') {
    return { accepted: false, reason: 'order_intent.missing' };
  }

  if (executionType !== 'market' && executionType !== 'limit') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (requestedOrderType !== 'market' && requestedOrderType !== 'BUY_LIMIT' && requestedOrderType !== 'SELL_LIMIT') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (executionType === 'market' && requestedOrderType !== 'market') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (executionType === 'limit' && requestedOrderType === 'market') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (requestedOrderType === 'BUY_LIMIT' && side !== 'buy') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }
  if (requestedOrderType === 'SELL_LIMIT' && side !== 'sell') {
    return { accepted: false, reason: 'order_intent.mismatch' };
  }

  if (executionType === 'market' || requestedOrderType === 'market') {
    if (h1Atr > 0) {
      const allowedDistance = h1Atr * 0.3;
      if (Math.abs(currentPrice - entry) > allowedDistance) {
        return { accepted: false, reason: 'market_entry_mismatch' };
      }
    }
    return { accepted: true, orderType: 'market' };
  }

  if (requestedOrderType === 'BUY_LIMIT') {
    if (side !== 'buy') {
      return { accepted: false, reason: 'limit_direction_mismatch' };
    }
    if (entry < currentPrice) {
      return { accepted: true, orderType: 'BUY_LIMIT' };
    }
    if (isTriggeredLimitWithinProtection(tradePlan, currentPrice)) {
      return { accepted: true, orderType: 'market' };
    }
    return { accepted: false, reason: 'limit_direction_mismatch' };
  }

  if (requestedOrderType === 'SELL_LIMIT') {
    if (side !== 'sell') {
      return { accepted: false, reason: 'limit_direction_mismatch' };
    }
    if (entry > currentPrice) {
      return { accepted: true, orderType: 'SELL_LIMIT' };
    }
    if (isTriggeredLimitWithinProtection(tradePlan, currentPrice)) {
      return { accepted: true, orderType: 'market' };
    }
    return { accepted: false, reason: 'limit_direction_mismatch' };
  }

  return { accepted: false, reason: 'order_intent.missing' };
}

export function validateAIApproveProtectionDirection(tradePlan: EaRecord, entry: number): AIApproveProtectionResult {
  const side = stringField(tradePlan, 'side').trim().toUpperCase();
  const stopLoss = numberField(tradePlan, 'stop_loss');
  const resolvedTakeProfits = resolveAIApproveExecutableTakeProfits({
    side,
    entry,
    stopLoss,
    takeProfitValues: arrayNumberField(tradePlan, 'take_profit'),
    minRiskReward: 0
  });
  return resolvedTakeProfits.accepted ? { accepted: true } : { accepted: false, reason: 'protection.invalid_direction' };
}

function isTriggeredLimitWithinProtection(tradePlan: EaRecord, currentPrice: number): boolean {
  const side = stringField(tradePlan, 'side').trim().toUpperCase();
  const stopLoss = numberField(tradePlan, 'stop_loss');
  return resolveAIApproveExecutableTakeProfits({
    side,
    entry: currentPrice,
    stopLoss,
    takeProfitValues: arrayNumberField(tradePlan, 'take_profit'),
    minRiskReward: 0
  }).accepted;
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

function rejectTakeProfit(
  reason: 'rr.invalid' | 'rr.below_minimum',
  label: AIApproveTakeProfitLabel
): AIApproveExecutableTakeProfitsResult {
  return { accepted: false, reason, label };
}

function labelForTargetIndex(index: number): AIApproveTakeProfitLabel {
  return index <= 0 ? 'TP1' : 'TP2';
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return values.filter((value, index, array) => index === 0 || value !== array[index - 1]);
}
