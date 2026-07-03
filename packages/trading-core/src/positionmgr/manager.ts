import { ema } from '../indicators/index.js';

export type PositionSide = 'BUY' | 'SELL';
export type NetPositionSide = PositionSide | 'FLAT';

export type PositionManagerPosition = {
  ticket?: number;
  symbol?: string;
  type?: string;
  lots?: number;
  openPrice?: number;
  open_price?: number;
  sl?: number;
  profit?: number;
  comment?: string;
  strategy?: string;
  magic?: number;
};

export type PositionSummaryInput = {
  accountId?: string;
  symbol?: string;
  positions: PositionManagerPosition[];
};

export type PositionStrategySummary = {
  strategy: string;
  positions: number;
  buyLots: number;
  sellLots: number;
  netLots: number;
  floatingProfit: number;
};

export type PositionSummary = {
  accountId?: string;
  symbol: string;
  totalOpenPositions: number;
  buyLots: number;
  sellLots: number;
  netLots: number;
  netSide: NetPositionSide;
  weightedAverageEntry: number;
  floatingProfit: number;
  byStrategy: PositionStrategySummary[];
  canProduceLiveCommands: false;
};

export type PositionManagerState = {
  ticket: number;
  openTime?: string;
  open_time?: string;
  tp1Hit?: boolean;
  tp1_hit?: boolean;
  tp2Hit?: boolean;
  tp2_hit?: boolean;
  rsiTp75Triggered?: boolean;
  rsi_tp75_triggered?: boolean;
  beMoved?: boolean;
  be_moved?: boolean;
  maxProfitAtr?: number;
  max_profit_atr?: number;
  beTriggerAtr?: number;
  be_trigger_atr?: number;
  bestSl?: number;
  best_sl?: number;
};

export type PositionTimeStopInput = {
  now?: string;
  currentPrice: number;
  currentAtr: number;
  avgAtr?: number;
  h1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionTimeStopAdvisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionTimeStopResult = {
  advisories: PositionTimeStopAdvisory[];
  canProduceLiveCommands: false;
};

export type PositionBreakevenInput = {
  currentPrice: number;
  currentAtr: number;
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionBreakevenAdvisory = {
  action: 'MODIFY';
  ticket: number;
  newSL: number;
  reason: string;
};

export type PositionBreakevenResult = {
  advisories: PositionBreakevenAdvisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionTP1Input = {
  currentPrice: number;
  currentAtr: number;
  h1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionTP1Advisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionTP1Result = {
  advisories: PositionTP1Advisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionTP2Input = {
  currentPrice: number;
  currentAtr: number;
  h1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionTP2Advisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionTP2Result = {
  advisories: PositionTP2Advisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionKeyLevelInput = {
  currentPrice: number;
  currentAtr: number;
  h1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionKeyLevelAdvisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionKeyLevelResult = {
  advisories: PositionKeyLevelAdvisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionTrendReversalInput = {
  currentPrice: number;
  currentAtr: number;
  h1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionTrendReversalAdvisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionTrendReversalResult = {
  advisories: PositionTrendReversalAdvisory[];
  canProduceLiveCommands: false;
};

export type PositionDynamicTrailingInput = {
  currentPrice: number;
  currentAtr: number;
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionDynamicTrailingAdvisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionDynamicTrailingResult = {
  advisories: PositionDynamicTrailingAdvisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionMomentumScalpExitInput = {
  now?: string;
  currentPrice: number;
  currentAtr: number;
  m5Bars: unknown[];
  m1Bars: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionMomentumScalpExitAdvisory = {
  action: 'CLOSE';
  ticket: number;
  lots: number;
  reason: string;
};

export type PositionMomentumScalpExitResult = {
  advisories: PositionMomentumScalpExitAdvisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

export type PositionManagerCommandsInput = {
  now?: string;
  currentPrice: number;
  currentAtr: number;
  avgAtr?: number;
  h1Bars: unknown[];
  m5Bars?: unknown[];
  m1Bars?: unknown[];
  positions: PositionManagerPosition[];
  states?: PositionManagerState[];
};

export type PositionManagerCommandAdvisory =
  | PositionTimeStopAdvisory
  | PositionBreakevenAdvisory
  | PositionTP1Advisory
  | PositionTP2Advisory
  | PositionKeyLevelAdvisory
  | PositionTrendReversalAdvisory
  | PositionDynamicTrailingAdvisory
  | PositionMomentumScalpExitAdvisory;

export type PositionManagerCommandsResult = {
  advisories: PositionManagerCommandAdvisory[];
  nextStates: PositionManagerState[];
  canProduceLiveCommands: false;
};

type OpenPosition = {
  ticket: number;
  side: PositionSide;
  lots: number;
  openPrice: number;
  sl: number;
  profit: number;
  comment: string;
  strategy: string;
};

export function summarizePositions(input: PositionSummaryInput): PositionSummary {
  const symbol = baseSymbol(input.symbol ?? '');
  const openPositions = input.positions
    .filter((position) => symbol === '' || baseSymbol(position.symbol ?? input.symbol ?? '') === symbol)
    .map(toOpenPosition)
    .filter((position): position is OpenPosition => position != null);

  let buyLots = 0;
  let sellLots = 0;
  let buyWeightedEntrySum = 0;
  let sellWeightedEntrySum = 0;
  let floatingProfit = 0;
  const byStrategy = new Map<string, PositionStrategySummary>();

  for (const position of openPositions) {
    if (position.side === 'BUY') {
      buyLots += position.lots;
      buyWeightedEntrySum += position.openPrice * position.lots;
    } else {
      sellLots += position.lots;
      sellWeightedEntrySum += position.openPrice * position.lots;
    }
    floatingProfit += position.profit;

    const strategySummary = getStrategySummary(byStrategy, position.strategy);
    strategySummary.positions += 1;
    if (position.side === 'BUY') {
      strategySummary.buyLots += position.lots;
    } else {
      strategySummary.sellLots += position.lots;
    }
    strategySummary.floatingProfit += position.profit;
  }

  const roundedBuyLots = roundLots(buyLots);
  const roundedSellLots = roundLots(sellLots);
  const netLots = roundLots(Math.abs(roundedBuyLots - roundedSellLots));
  const summaryNetSide = netSide(roundedBuyLots, roundedSellLots);

  return {
    accountId: input.accountId,
    symbol,
    totalOpenPositions: openPositions.length,
    buyLots: roundedBuyLots,
    sellLots: roundedSellLots,
    netLots,
    netSide: summaryNetSide,
    weightedAverageEntry: weightedAverageEntry(summaryNetSide, buyWeightedEntrySum, buyLots, sellWeightedEntrySum, sellLots),
    floatingProfit: roundMoney(floatingProfit),
    byStrategy: Array.from(byStrategy.values())
      .map((summary) => ({
        ...summary,
        buyLots: roundLots(summary.buyLots),
        sellLots: roundLots(summary.sellLots),
        netLots: roundLots(summary.buyLots - summary.sellLots),
        floatingProfit: roundMoney(summary.floatingProfit)
      }))
      .sort((left, right) => left.strategy.localeCompare(right.strategy)),
    canProduceLiveCommands: false
  };
}

export function evaluatePositionTimeStops(input: PositionTimeStopInput): PositionTimeStopResult {
  const result: PositionTimeStopResult = { advisories: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 5 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const now = input.now == null ? new Date() : new Date(input.now);
  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));

  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }
    const state = states.get(position.ticket);
    const openTime = new Date(state?.openTime ?? state?.open_time ?? input.now ?? now);
    const hours = (now.getTime() - openTime.getTime()) / (60 * 60 * 1000);
    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);

    const advisory = timeStopAdvisory(position, state, hours, profitAtr, input.currentAtr, input.avgAtr ?? 0);
    if (advisory != null) {
      result.advisories.push(advisory);
    }
  }

  return result;
}

export function evaluatePositionBreakeven(input: PositionBreakevenInput): PositionBreakevenResult {
  const result: PositionBreakevenResult = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }

    const state = breakevenState(position, states.get(position.ticket));
    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    if (state.beMoved !== true && profitAtr >= (state.beTriggerAtr ?? 1.5) && validateNewSL(position.side, position.openPrice, state.bestSl ?? 0)) {
      state.beMoved = true;
      state.bestSl = position.openPrice;
      result.advisories.push({
        action: 'MODIFY',
        ticket: position.ticket,
        newSL: position.openPrice,
        reason: `breakeven_${formatAtr(profitAtr)}ATR`
      });
    }
    result.nextStates.push(state);
  }

  return result;
}

export function evaluatePositionTP1(input: PositionTP1Input): PositionTP1Result {
  const result: PositionTP1Result = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 5 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  const tp1Multi = adaptiveTP1Multi(input.h1Bars);
  const openPositions: OpenPosition[] = [];
  const preTP1Hit = new Map<number, boolean>();
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }
    openPositions.push(position);

    const state = tp1State(position, states.get(position.ticket));
    preTP1Hit.set(position.ticket, state.tp1Hit === true);
    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    if (state.tp1Hit !== true && state.beMoved === true && shouldTakeTP1(position.side, profitAtr, tp1Multi, input.h1Bars)) {
      let closeLots = roundLots(position.lots * 0.4);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state.tp1Hit = true;
      result.advisories.push({
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: `TP1_${formatAtr(profitAtr)}ATR`
      });
    }
    result.nextStates.push(state);
  }

  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP1Hit, 'tp1Hit', 'group_tp1');

  return result;
}

export function evaluatePositionTP2(input: PositionTP2Input): PositionTP2Result {
  const result: PositionTP2Result = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 5 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  const tp2Multi = adaptiveTP2Multi(input.h1Bars);
  const openPositions: OpenPosition[] = [];
  const preTP2Hit = new Map<number, boolean>();
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }
    openPositions.push(position);

    const state = tp2State(position, states.get(position.ticket));
    preTP2Hit.set(position.ticket, state.tp2Hit === true);
    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    if (state.tp1Hit === true && state.tp2Hit !== true && shouldTakeTP2(position.side, profitAtr, tp2Multi, input.h1Bars)) {
      let closeLots = roundLots(position.lots * 0.4);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state.tp2Hit = true;
      result.advisories.push({
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: `TP2_${formatAtr(profitAtr)}ATR`
      });
    }
    result.nextStates.push(state);
  }

  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP2Hit, 'tp2Hit', 'group_tp2');

  return result;
}

export function evaluatePositionKeyLevels(input: PositionKeyLevelInput): PositionKeyLevelResult {
  const result: PositionKeyLevelResult = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 5 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  const openPositions: OpenPosition[] = [];
  const preTP1Hit = new Map<number, boolean>();
  const preTP2Hit = new Map<number, boolean>();
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }
    openPositions.push(position);

    const state = keyLevelState(position, states.get(position.ticket));
    preTP1Hit.set(position.ticket, state.tp1Hit === true);
    preTP2Hit.set(position.ticket, state.tp2Hit === true);
    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    const advisory = keyLevelAdvisory(position, state, input.currentPrice, input.currentAtr, profitAtr, input.h1Bars);
    if (advisory != null) {
      result.advisories.push(advisory);
    }
    result.nextStates.push(state);
  }

  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP1Hit, 'tp1Hit', 'group_tp1');
  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP2Hit, 'tp2Hit', 'group_tp2');

  return result;
}

export function evaluatePositionTrendReversal(input: PositionTrendReversalInput): PositionTrendReversalResult {
  const result: PositionTrendReversalResult = { advisories: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 4 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }

    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    const advisory = trendReversalAdvisory(position, states.get(position.ticket), input.currentPrice, profitAtr, input.h1Bars);
    if (advisory != null) {
      result.advisories.push(advisory);
    }
  }

  return result;
}

export function evaluatePositionDynamicTrailing(input: PositionDynamicTrailingInput): PositionDynamicTrailingResult {
  const result: PositionDynamicTrailingResult = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null) {
      continue;
    }

    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    const state = dynamicTrailingState(position, states.get(position.ticket), profitAtr);
    const advisory = dynamicTrailingAdvisory(position, state, profitAtr);
    if (advisory != null) {
      result.advisories.push(advisory);
    }
    result.nextStates.push(state);
  }

  return result;
}

export function evaluatePositionMomentumScalpExits(input: PositionMomentumScalpExitInput): PositionMomentumScalpExitResult {
  const result: PositionMomentumScalpExitResult = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const now = input.now == null ? new Date() : new Date(input.now);
  const states = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  for (const rawPosition of input.positions) {
    const position = toOpenPosition(rawPosition);
    if (position == null || !isMomentumScalpPosition(position)) {
      continue;
    }

    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    const state = momentumScalpState(position, states.get(position.ticket), now);
    const advisory = momentumScalpExitAdvisory(position, state, now, profitAtr, input.m5Bars, input.m1Bars);
    if (advisory != null) {
      result.advisories.push(advisory);
    }
    result.nextStates.push(state);
  }

  return result;
}

export function evaluatePositionManagerCommands(input: PositionManagerCommandsInput): PositionManagerCommandsResult {
  const result: PositionManagerCommandsResult = { advisories: [], nextStates: [], canProduceLiveCommands: false };
  if (input.positions.length === 0 || input.h1Bars.length < 5 || input.currentAtr <= 0 || input.currentPrice <= 0) {
    return result;
  }

  const now = input.now == null ? new Date() : new Date(input.now);
  const inputStates = new Map((input.states ?? []).map((state) => [state.ticket, state]));
  const openPositions = input.positions.map(toOpenPosition).filter((position): position is OpenPosition => position != null);
  const stateByTicket = new Map<number, PositionManagerState>();
  const preTP1Hit = new Map<number, boolean>();
  const preTP2Hit = new Map<number, boolean>();
  const preBE = new Map<number, boolean>();

  for (const position of openPositions) {
    const existing = inputStates.get(position.ticket);
    preTP1Hit.set(position.ticket, existing?.tp1Hit === true || existing?.tp1_hit === true);
    preTP2Hit.set(position.ticket, existing?.tp2Hit === true || existing?.tp2_hit === true);
    preBE.set(position.ticket, existing?.beMoved === true || existing?.be_moved === true);
  }

  const tp1Multi = adaptiveTP1Multi(input.h1Bars);
  const tp2Multi = adaptiveTP2Multi(input.h1Bars);

  for (const position of openPositions) {
    const state = positionAnalyzeState(position, inputStates.get(position.ticket), now);
    updateBestSLFromPosition(position, state);

    const profitAtr = profitInAtr(position, input.currentPrice, input.currentAtr);
    if (profitAtr > (state.maxProfitAtr ?? 0)) {
      state.maxProfitAtr = profitAtr;
    }

    if (isMomentumScalpPosition(position)) {
      const advisory = momentumScalpExitAdvisory(position, state, now, profitAtr, input.m5Bars ?? [], input.m1Bars ?? []);
      if (advisory != null) {
        result.advisories.push(advisory);
        stateByTicket.set(position.ticket, state);
        continue;
      }
    }

    const openTime = new Date(state.openTime ?? state.open_time ?? now);
    const hours = (now.getTime() - openTime.getTime()) / (60 * 60 * 1000);
    const timeStop = timeStopAdvisory(position, state, hours, profitAtr, input.currentAtr, input.avgAtr ?? 0);
    if (timeStop != null) {
      result.advisories.push(timeStop);
      stateByTicket.set(position.ticket, state);
      continue;
    }

    const beTriggerAtr = state.beTriggerAtr ?? 1.5;
    if (state.beMoved !== true && profitAtr >= beTriggerAtr && validateNewSL(position.side, position.openPrice, state.bestSl ?? 0)) {
      state.beMoved = true;
      state.bestSl = position.openPrice;
      result.advisories.push({
        action: 'MODIFY',
        ticket: position.ticket,
        newSL: position.openPrice,
        reason: `breakeven_${formatAtr(profitAtr)}ATR`
      });
    }

    if (state.tp1Hit !== true && state.beMoved === true && shouldTakeTP1(position.side, profitAtr, tp1Multi, input.h1Bars)) {
      let closeLots = roundLots(position.lots * 0.4);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state.tp1Hit = true;
      result.advisories.push({
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: `TP1_${formatAtr(profitAtr)}ATR`
      });
      stateByTicket.set(position.ticket, state);
      continue;
    }

    const keyLevel = keyLevelAdvisory(position, state, input.currentPrice, input.currentAtr, profitAtr, input.h1Bars);
    if (keyLevel != null) {
      result.advisories.push(keyLevel);
      stateByTicket.set(position.ticket, state);
      continue;
    }

    if (state.tp1Hit === true && state.tp2Hit !== true && shouldTakeTP2(position.side, profitAtr, tp2Multi, input.h1Bars)) {
      let closeLots = roundLots(position.lots * 0.4);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state.tp2Hit = true;
      result.advisories.push({
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: `TP2_${formatAtr(profitAtr)}ATR`
      });
      stateByTicket.set(position.ticket, state);
      continue;
    }

    const trendReversal = trendReversalAdvisory(position, state, input.currentPrice, profitAtr, input.h1Bars);
    if (trendReversal != null) {
      result.advisories.push(trendReversal);
      stateByTicket.set(position.ticket, state);
      continue;
    }

    const dynamicTrailing = dynamicTrailingAdvisory(position, state, profitAtr);
    if (dynamicTrailing != null) {
      result.advisories.push(dynamicTrailing);
    }

    stateByTicket.set(position.ticket, state);
  }

  result.nextStates = openPositions
    .map((position) => stateByTicket.get(position.ticket))
    .filter((state): state is PositionManagerState => state != null);
  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP1Hit, 'tp1Hit', 'group_tp1');
  applySameSideGroupClose(result.advisories, result.nextStates, openPositions, preTP2Hit, 'tp2Hit', 'group_tp2');
  applySameSideBreakeven(result.advisories, result.nextStates, openPositions, preBE);

  return result;
}

function timeStopAdvisory(
  position: OpenPosition,
  state: PositionManagerState | undefined,
  hours: number,
  profitAtr: number,
  currentAtr: number,
  avgAtr: number
): PositionTimeStopAdvisory | null {
  if (hours > 72 && state?.tp2Hit !== true && state?.tp2_hit !== true) {
    let closeLots = roundLots(position.lots * 0.5);
    if (closeLots <= 0.02) {
      closeLots = position.lots;
    }
    return { action: 'CLOSE', ticket: position.ticket, lots: closeLots, reason: `time_72h_${formatAtr(profitAtr)}ATR` };
  }
  if (hours > 48 && profitAtr < 0.5) {
    return { action: 'CLOSE', ticket: position.ticket, lots: position.lots, reason: `time_48h_${formatAtr(profitAtr)}ATR` };
  }
  if (hours > 24 && profitAtr < 0.1 && avgAtr > 0 && currentAtr < avgAtr * 0.7) {
    return { action: 'CLOSE', ticket: position.ticket, lots: position.lots, reason: `time_24h_${formatAtr(profitAtr)}ATR_lowvol` };
  }
  return null;
}

function trendReversalAdvisory(
  position: OpenPosition,
  state: PositionManagerState | undefined,
  currentPrice: number,
  profitAtr: number,
  h1Bars: unknown[]
): PositionTrendReversalAdvisory | null {
  if ((state?.beMoved ?? state?.be_moved ?? false) !== true || profitAtr < 0.3 || h1Bars.length < 4) {
    return null;
  }

  const last = h1Bars[h1Bars.length - 1];
  const previous = h1Bars[h1Bars.length - 2];
  const lastMacdHist = numericBarField(last, 'macdHist', 'MACDHist') ?? 0;
  const previousMacdHist = numericBarField(previous, 'macdHist', 'MACDHist') ?? 0;
  const lastRsi = numericBarField(last, 'rsi', 'RSI') ?? 0;
  const lastAdx = numericBarField(last, 'adx', 'ADX') ?? 0;
  const lastEma20 = numericBarField(last, 'ema20', 'EMA20') ?? 0;
  const previousEma20 = numericBarField(previous, 'ema20', 'EMA20') ?? 0;
  const lastEma50 = numericBarField(last, 'ema50', 'EMA50') ?? 0;
  const previousEma50 = numericBarField(previous, 'ema50', 'EMA50') ?? 0;
  const ema20 = lastEma20 === 0 ? currentPrice : lastEma20;

  let score = 0;
  const reasons: string[] = [];

  if (position.side === 'BUY') {
    if (lastMacdHist < -0.5 && currentPrice < ema20) {
      score += 3;
      reasons.push(`MACD=${formatMacd(lastMacdHist)}<-0.5且价格<EMA20`);
    }
    if (lastRsi < 40) {
      score += 2;
      reasons.push(`RSI=${formatWhole(lastRsi)}<40`);
    }
    if (lastMacdHist < 0 && previousMacdHist > 0) {
      score += 1;
      reasons.push('MACD翻负');
    }
    if (lastAdx < 20) {
      score += 1;
      reasons.push(`ADX=${formatWhole(lastAdx)}<20`);
    }
    if (lastEma20 < lastEma50 && previousEma20 < previousEma50) {
      score += 2;
      reasons.push('EMA死叉确认(2根)');
    }
  } else {
    if (lastMacdHist > 0.5 && currentPrice > ema20) {
      score += 3;
      reasons.push(`MACD=${formatMacd(lastMacdHist)}>0.5且价格>EMA20`);
    }
    if (lastRsi > 60) {
      score += 2;
      reasons.push(`RSI=${formatWhole(lastRsi)}>60`);
    }
    if (lastMacdHist > 0 && previousMacdHist < 0) {
      score += 1;
      reasons.push('MACD翻正');
    }
    if (lastAdx < 20) {
      score += 1;
      reasons.push(`ADX=${formatWhole(lastAdx)}<20`);
    }
    if (lastEma20 > lastEma50 && previousEma20 > previousEma50) {
      score += 2;
      reasons.push('EMA金叉确认(2根)');
    }
  }

  if (score < 4) {
    return null;
  }

  return {
    action: 'CLOSE',
    ticket: position.ticket,
    lots: position.lots,
    reason: `reversal_s${score}_${reasons.join(' ')}`
  };
}

function dynamicTrailingState(position: OpenPosition, existing: PositionManagerState | undefined, profitAtr: number): PositionManagerState {
  const state: PositionManagerState = {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    tp1Hit: existing?.tp1Hit ?? existing?.tp1_hit ?? false,
    tp2Hit: existing?.tp2Hit ?? existing?.tp2_hit ?? false,
    maxProfitAtr: existing?.maxProfitAtr ?? existing?.max_profit_atr ?? 0
  };

  if (profitAtr > (state.maxProfitAtr ?? 0)) {
    state.maxProfitAtr = profitAtr;
  }

  return state;
}

function dynamicTrailingAdvisory(
  position: OpenPosition,
  state: PositionManagerState,
  profitAtr: number
): PositionDynamicTrailingAdvisory | null {
  const maxProfitAtr = state.maxProfitAtr ?? state.max_profit_atr ?? 0;
  if (state.tp1Hit !== true || maxProfitAtr <= 0) {
    return null;
  }

  const drawdown = maxProfitAtr - profitAtr;
  if (state.tp2Hit === true) {
    if (drawdown > maxProfitAtr * 0.55) {
      return { action: 'CLOSE', ticket: position.ticket, lots: position.lots, reason: `trail_tp2_dd${formatAtr(drawdown)}` };
    }
    return null;
  }

  if (drawdown > maxProfitAtr * 0.6 && profitAtr < maxProfitAtr - 0.8) {
    return { action: 'CLOSE', ticket: position.ticket, lots: position.lots, reason: `trail_tp1_dd${formatAtr(drawdown)}` };
  }
  return null;
}

function momentumScalpState(position: OpenPosition, existing: PositionManagerState | undefined, now: Date): PositionManagerState {
  return {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    openTime: existing?.openTime ?? existing?.open_time ?? now.toISOString(),
    rsiTp75Triggered: existing?.rsiTp75Triggered ?? existing?.rsi_tp75_triggered ?? false
  };
}

function momentumScalpExitAdvisory(
  position: OpenPosition,
  state: PositionManagerState,
  now: Date,
  profitAtr: number,
  m5Bars: unknown[],
  m1Bars: unknown[]
): PositionMomentumScalpExitAdvisory | null {
  const openTime = new Date(state.openTime ?? state.open_time ?? now);
  const holdingMinutes = (now.getTime() - openTime.getTime()) / (60 * 1000);
  const maxHoldingMinutes = 20;
  if (holdingMinutes > maxHoldingMinutes && profitAtr < 0.2) {
    return {
      action: 'CLOSE',
      ticket: position.ticket,
      lots: position.lots,
      reason: 'momentum_scalp_time_stop_0.2ATR'
    };
  }

  if (m5Bars.length > 0) {
    const closes = m5Bars.map((bar) => numericBarField(bar, 'close', 'Close') ?? 0);
    const ema5 = ema(closes, 5);
    const ema8 = ema(closes, 8);
    const lastIndex = closes.length - 1;
    if ((position.side === 'BUY' && ema5[lastIndex] < ema8[lastIndex]) || (position.side === 'SELL' && ema5[lastIndex] > ema8[lastIndex])) {
      return {
        action: 'CLOSE',
        ticket: position.ticket,
        lots: position.lots,
        reason: 'momentum_scalp_m5_structure_break'
      };
    }
  }

  if (m1Bars.length > 0) {
    const latestRsi = numericBarField(m1Bars[m1Bars.length - 1], 'rsi', 'RSI') ?? 0;
    if ((position.side === 'BUY' && latestRsi > 80) || (position.side === 'SELL' && latestRsi < 20)) {
      return {
        action: 'CLOSE',
        ticket: position.ticket,
        lots: position.lots,
        reason: 'momentum_scalp_rsi_extreme'
      };
    }
    if (
      state.rsiTp75Triggered !== true &&
      ((position.side === 'BUY' && latestRsi > 75) || (position.side === 'SELL' && latestRsi < 25))
    ) {
      let closeLots = roundLots(position.lots * 0.5);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state.rsiTp75Triggered = true;
      return {
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: 'momentum_scalp_rsi_tp75'
      };
    }
  }

  return null;
}

function tp1State(position: OpenPosition, existing: PositionManagerState | undefined): PositionManagerState {
  return {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    beMoved: existing?.beMoved ?? existing?.be_moved ?? false,
    tp1Hit: existing?.tp1Hit ?? existing?.tp1_hit ?? false
  };
}

function tp2State(position: OpenPosition, existing: PositionManagerState | undefined): PositionManagerState {
  return {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    tp1Hit: existing?.tp1Hit ?? existing?.tp1_hit ?? false,
    tp2Hit: existing?.tp2Hit ?? existing?.tp2_hit ?? false
  };
}

function keyLevelState(position: OpenPosition, existing: PositionManagerState | undefined): PositionManagerState {
  return {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    tp1Hit: existing?.tp1Hit ?? existing?.tp1_hit ?? false,
    tp2Hit: existing?.tp2Hit ?? existing?.tp2_hit ?? false
  };
}

function keyLevelAdvisory(
  position: OpenPosition,
  state: PositionManagerState,
  currentPrice: number,
  currentAtr: number,
  profitAtr: number,
  h1Bars: unknown[]
): PositionKeyLevelAdvisory | null {
  if (profitAtr < 1.0) {
    return null;
  }

  const keyLevel = nearestKeyLevel(currentPrice, position.side, h1Bars);
  if (Math.abs(currentPrice - keyLevel) >= currentAtr * 0.2) {
    return null;
  }

  let closeLots = roundLots(position.lots * 0.4);
  if (closeLots < 0.01) {
    closeLots = position.lots;
  }

  if (state.tp1Hit !== true) {
    state.tp1Hit = true;
    return { action: 'CLOSE', ticket: position.ticket, lots: closeLots, reason: `key_level_${formatLevel(keyLevel)}` };
  }
  if (state.tp1Hit === true && state.tp2Hit !== true && profitAtr > 2.0) {
    state.tp2Hit = true;
    return { action: 'CLOSE', ticket: position.ticket, lots: closeLots, reason: `key_level2_${formatLevel(keyLevel)}` };
  }
  return null;
}

function applySameSideGroupClose(
  advisories: PositionManagerCommandAdvisory[],
  nextStates: PositionManagerState[],
  positions: OpenPosition[],
  preHit: Map<number, boolean>,
  hitField: 'tp1Hit' | 'tp2Hit',
  reasonPrefix: 'group_tp1' | 'group_tp2'
): void {
  const statesByTicket = new Map(nextStates.map((state) => [state.ticket, state]));
  const groups = new Map<PositionSide, OpenPosition[]>();
  for (const position of positions) {
    const group = groups.get(position.side);
    if (group == null) {
      groups.set(position.side, [position]);
    } else {
      group.push(position);
    }
  }

  for (const [side, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    const anyNewHit = group.some((position) => {
      const state = statesByTicket.get(position.ticket);
      return state?.[hitField] === true && preHit.get(position.ticket) !== true;
    });
    if (!anyNewHit) {
      continue;
    }

    for (const position of group) {
      const state = statesByTicket.get(position.ticket);
      if (state == null || state[hitField] === true) {
        continue;
      }
      let closeLots = roundLots(position.lots * 0.4);
      if (closeLots < 0.01) {
        closeLots = position.lots;
      }
      state[hitField] = true;
      advisories.push({
        action: 'CLOSE',
        ticket: position.ticket,
        lots: closeLots,
        reason: `${reasonPrefix}_${side}`
      });
    }
  }
}

function applySameSideBreakeven(
  advisories: PositionManagerCommandAdvisory[],
  nextStates: PositionManagerState[],
  positions: OpenPosition[],
  preBE: Map<number, boolean>
): void {
  const statesByTicket = new Map(nextStates.map((state) => [state.ticket, state]));
  const groups = new Map<PositionSide, OpenPosition[]>();
  for (const position of positions) {
    const group = groups.get(position.side);
    if (group == null) {
      groups.set(position.side, [position]);
    } else {
      group.push(position);
    }
  }

  for (const [side, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    const anyNewBE = group.some((position) => {
      const state = statesByTicket.get(position.ticket);
      return state?.beMoved === true && preBE.get(position.ticket) !== true;
    });
    if (!anyNewBE) {
      continue;
    }

    let bestSL = 0;
    for (const position of group) {
      if (side === 'BUY' && position.openPrice > bestSL) {
        bestSL = position.openPrice;
      } else if (side === 'SELL' && (bestSL === 0 || position.openPrice < bestSL)) {
        bestSL = position.openPrice;
      }
    }

    for (const position of group) {
      const state = statesByTicket.get(position.ticket);
      if (state == null) {
        continue;
      }
      const currentBestSL = state.bestSl ?? 0;
      if (validateNewSL(side, bestSL, currentBestSL) && bestSL !== currentBestSL) {
        state.bestSl = bestSL;
        advisories.push({
          action: 'MODIFY',
          ticket: position.ticket,
          newSL: bestSL,
          reason: `group_be_${side}`
        });
      }
    }
  }
}

function shouldTakeTP1(side: PositionSide, profitAtr: number, tp1Multi: number, h1Bars: unknown[]): boolean {
  if (profitAtr >= tp1Multi) {
    return true;
  }
  if (profitAtr < tp1Multi * 0.6 || h1Bars.length < 3) {
    return false;
  }

  const latestRsi = numericBarField(h1Bars[h1Bars.length - 1], 'rsi', 'RSI');
  const previousRsi = numericBarField(h1Bars[h1Bars.length - 2], 'rsi', 'RSI');
  if (latestRsi == null || previousRsi == null) {
    return false;
  }

  let reversalCount = 0;
  if (side === 'BUY') {
    if (previousRsi > 65 && latestRsi < 55) {
      reversalCount += 1;
    }
    if (latestRsi < previousRsi) {
      reversalCount += 1;
    }
  } else {
    if (previousRsi < 35 && latestRsi > 45) {
      reversalCount += 1;
    }
    if (latestRsi > previousRsi) {
      reversalCount += 1;
    }
  }
  return reversalCount >= 2;
}

function shouldTakeTP2(side: PositionSide, profitAtr: number, tp2Multi: number, h1Bars: unknown[]): boolean {
  if (profitAtr >= tp2Multi) {
    return true;
  }
  if (profitAtr < tp2Multi * 0.7 || h1Bars.length < 3) {
    return false;
  }

  const latestMacdHist = numericBarField(h1Bars[h1Bars.length - 1], 'macdHist', 'MACDHist');
  const previousMacdHist = numericBarField(h1Bars[h1Bars.length - 2], 'macdHist', 'MACDHist');
  const latestRsi = numericBarField(h1Bars[h1Bars.length - 1], 'rsi', 'RSI');
  const previousRsi = numericBarField(h1Bars[h1Bars.length - 2], 'rsi', 'RSI');
  const latestAdx = numericBarField(h1Bars[h1Bars.length - 1], 'adx', 'ADX');
  const previousAdx = numericBarField(h1Bars[h1Bars.length - 2], 'adx', 'ADX');

  let weakness = 0;
  if (side === 'BUY') {
    if (latestMacdHist != null && previousMacdHist != null && latestMacdHist < previousMacdHist) {
      weakness += 1;
    }
    if (latestRsi != null && previousRsi != null && latestRsi < previousRsi && latestRsi < 60) {
      weakness += 1;
    }
    if (latestAdx != null && previousAdx != null && latestAdx < previousAdx) {
      weakness += 1;
    }
  } else {
    if (latestMacdHist != null && previousMacdHist != null && latestMacdHist > previousMacdHist) {
      weakness += 1;
    }
    if (latestRsi != null && previousRsi != null && latestRsi > previousRsi && latestRsi > 40) {
      weakness += 1;
    }
    if (latestAdx != null && previousAdx != null && latestAdx < previousAdx) {
      weakness += 1;
    }
  }
  return weakness >= 2;
}

function adaptiveTP1Multi(h1Bars: unknown[]): number {
  return adaptiveATRMultis(h1Bars).tp1Multi;
}

function adaptiveTP2Multi(h1Bars: unknown[]): number {
  return adaptiveATRMultis(h1Bars).tp2Multi;
}

function adaptiveATRMultis(h1Bars: unknown[]): { tp1Multi: number; tp2Multi: number } {
  if (h1Bars.length < 25) {
    return { tp1Multi: 1.5, tp2Multi: 3.0 };
  }

  const currentAtr = numericBarField(h1Bars[h1Bars.length - 1], 'atr', 'ATR');
  if (currentAtr == null || currentAtr <= 0) {
    return { tp1Multi: 1.5, tp2Multi: 3.0 };
  }

  const recentAtrValues = h1Bars
    .slice(-20)
    .map((bar) => numericBarField(bar, 'atr', 'ATR'))
    .filter((value): value is number => value != null && value > 0);
  if (recentAtrValues.length === 0) {
    return { tp1Multi: 1.5, tp2Multi: 3.0 };
  }

  const avgAtr = recentAtrValues.reduce((sum, value) => sum + value, 0) / recentAtrValues.length;
  if (avgAtr <= 0) {
    return { tp1Multi: 1.5, tp2Multi: 3.0 };
  }

  const ratio = currentAtr / avgAtr;
  if (ratio > 1.3) {
    return { tp1Multi: 2.0, tp2Multi: 4.0 };
  }
  if (ratio < 0.7) {
    return { tp1Multi: 1.0, tp2Multi: 2.0 };
  }
  return { tp1Multi: 1.5, tp2Multi: 3.0 };
}

function numericBarField(bar: unknown, camelName: string, goName: string): number | null {
  if (bar == null || typeof bar !== 'object') {
    return null;
  }
  const record = bar as Record<string, unknown>;
  const value = record[camelName] ?? record[goName] ?? record[toSnakeCase(camelName)];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function nearestKeyLevel(price: number, side: PositionSide, h1Bars: unknown[]): number {
  let levelBelow = Math.floor(price / 50) * 50;
  let levelAbove = (Math.floor(price / 50) + 1) * 50;

  if (h1Bars.length >= 20) {
    let recentHigh = 0;
    let recentLow = Infinity;
    for (const bar of h1Bars.slice(-20)) {
      const high = numericBarField(bar, 'high', 'High');
      const low = numericBarField(bar, 'low', 'Low');
      if (high != null && high > recentHigh) {
        recentHigh = high;
      }
      if (low != null && low < recentLow) {
        recentLow = low;
      }
    }

    const roundedHigh = roundToNearest(recentHigh, 50);
    const roundedLow = roundToNearest(recentLow, 50);
    if (side === 'BUY' && roundedHigh > levelAbove && Math.abs(price - roundedHigh) < Math.abs(price - levelAbove)) {
      levelAbove = roundedHigh;
    }
    if (side === 'SELL' && roundedLow < levelBelow && Math.abs(price - roundedLow) < Math.abs(price - levelBelow)) {
      levelBelow = roundedLow;
    }
  }

  return side === 'BUY' ? levelAbove : levelBelow;
}

function formatLevel(value: number): string {
  return value.toFixed(0);
}

function breakevenState(position: OpenPosition, existing: PositionManagerState | undefined): PositionManagerState {
  const beTriggerAtr = normalizeBETriggerAtr(existing?.beTriggerAtr ?? existing?.be_trigger_atr);
  const state: PositionManagerState = {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    beMoved: existing?.beMoved ?? existing?.be_moved ?? false,
    beTriggerAtr,
    bestSl: existing?.bestSl ?? existing?.best_sl ?? 0
  };

  if (position.sl !== 0) {
    if ((state.bestSl ?? 0) === 0) {
      state.bestSl = position.sl;
    } else if (position.side === 'BUY' && position.sl > (state.bestSl ?? 0)) {
      state.bestSl = position.sl;
    } else if (position.side === 'SELL' && position.sl < (state.bestSl ?? 0)) {
      state.bestSl = position.sl;
    }
  }

  return state;
}

function positionAnalyzeState(position: OpenPosition, existing: PositionManagerState | undefined, now: Date): PositionManagerState {
  const beTriggerAtr = normalizeBETriggerAtr(existing?.beTriggerAtr ?? existing?.be_trigger_atr);
  return {
    ...(existing ?? { ticket: position.ticket }),
    ticket: position.ticket,
    openTime: existing?.openTime ?? existing?.open_time ?? now.toISOString(),
    tp1Hit: existing?.tp1Hit ?? existing?.tp1_hit ?? false,
    tp2Hit: existing?.tp2Hit ?? existing?.tp2_hit ?? false,
    rsiTp75Triggered: existing?.rsiTp75Triggered ?? existing?.rsi_tp75_triggered ?? false,
    beMoved: existing?.beMoved ?? existing?.be_moved ?? false,
    maxProfitAtr: existing?.maxProfitAtr ?? existing?.max_profit_atr ?? 0,
    beTriggerAtr,
    bestSl: existing?.bestSl ?? existing?.best_sl ?? position.sl
  };
}

function normalizeBETriggerAtr(value: number | undefined): number {
  return value == null || value === 0 ? 1.5 : value;
}

function updateBestSLFromPosition(position: OpenPosition, state: PositionManagerState): void {
  if (position.sl === 0) {
    return;
  }
  const bestSL = state.bestSl ?? 0;
  if (bestSL === 0) {
    state.bestSl = position.sl;
  } else if (position.side === 'BUY' && position.sl > bestSL) {
    state.bestSl = position.sl;
  } else if (position.side === 'SELL' && position.sl < bestSL) {
    state.bestSl = position.sl;
  }
}

function validateNewSL(side: PositionSide, newSL: number, bestSL: number): boolean {
  if (bestSL === 0) {
    return true;
  }
  if (side === 'BUY') {
    return newSL >= bestSL;
  }
  return newSL <= bestSL;
}

function profitInAtr(position: OpenPosition, currentPrice: number, currentAtr: number): number {
  const profit = position.side === 'BUY' ? currentPrice - position.openPrice : position.openPrice - currentPrice;
  return profit / currentAtr;
}

function formatAtr(value: number): string {
  return value.toFixed(1);
}

function formatMacd(value: number): string {
  return value.toFixed(2);
}

function formatWhole(value: number): string {
  return value.toFixed(0);
}

function weightedAverageEntry(side: NetPositionSide, buyWeightedEntrySum: number, buyLots: number, sellWeightedEntrySum: number, sellLots: number): number {
  if (side === 'BUY' && buyLots > 0) {
    return buyWeightedEntrySum / buyLots;
  }
  if (side === 'SELL' && sellLots > 0) {
    return sellWeightedEntrySum / sellLots;
  }
  return 0;
}

function toOpenPosition(position: PositionManagerPosition): OpenPosition | null {
  const side = positionSide(position.type ?? '');
  const lots = position.lots ?? 0;
  const openPrice = position.openPrice ?? position.open_price ?? 0;
  if ((position.ticket ?? 0) <= 0 || side == null || lots <= 0 || openPrice <= 0) {
    return null;
  }
  return {
    ticket: position.ticket ?? 0,
    side,
    lots,
    openPrice,
    sl: position.sl ?? 0,
    profit: position.profit ?? 0,
    comment: position.comment ?? '',
    strategy: position.strategy == null || position.strategy.length === 0 ? 'unknown' : position.strategy
  };
}

function isMomentumScalpPosition(position: OpenPosition): boolean {
  return position.comment.toLowerCase().includes('momentum_scalp');
}

function getStrategySummary(summaries: Map<string, PositionStrategySummary>, strategy: string): PositionStrategySummary {
  const existing = summaries.get(strategy);
  if (existing != null) {
    return existing;
  }
  const created: PositionStrategySummary = {
    strategy,
    positions: 0,
    buyLots: 0,
    sellLots: 0,
    netLots: 0,
    floatingProfit: 0
  };
  summaries.set(strategy, created);
  return created;
}

function positionSide(value: string): PositionSide | null {
  switch (value.trim().toUpperCase()) {
    case 'BUY':
      return 'BUY';
    case 'SELL':
      return 'SELL';
    default:
      return null;
  }
}

function netSide(buyLots: number, sellLots: number): NetPositionSide {
  if (buyLots > sellLots) {
    return 'BUY';
  }
  if (sellLots > buyLots) {
    return 'SELL';
  }
  return 'FLAT';
}

function baseSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase().replace(/M#$/, '').replace(/#$/, '');
  switch (symbol) {
    case 'GOLD':
    case 'XAUUSD':
      return 'XAUUSD';
    case 'GBPJPY':
    case 'GBPUSD':
    case 'USDCAD':
    case 'EURJPY':
    case 'USDJPY':
    case 'US100CASH':
    case 'USOILCASH':
    case 'UKOILCASH':
      return symbol;
    default:
      return symbol;
  }
}

function roundLots(value: number): number {
  return roundToEven(value, 2);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

function roundToEven(value: number, precision: number): number {
  const factor = 10 ** precision;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const epsilon = 1e-9;

  if (Math.abs(fraction - 0.5) <= epsilon) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(scaled) / factor;
}
