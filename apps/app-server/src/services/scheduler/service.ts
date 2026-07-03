import { createHash } from 'node:crypto';
import type { CommandCandidate, EaRecord, EaStore } from '@gold-bot/persistence';
import { AnalysisService } from '../analysis/service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import type { ShadowService } from '../shadow/service.js';

export class SchedulerService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly commandLifecycle: CommandLifecycleService,
    private readonly shadow?: ShadowService,
    private readonly store?: Pick<EaStore, 'getHeartbeat' | 'getLatestTick' | 'getBars' | 'getCommand' | 'getPositions' | 'getAIResults'>,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  enqueueAnalysis(accountId: string, symbol: string, timeframe = ''): void {
    if (!isLiveStrategyTimeframe(timeframe) || !this.canRunLiveAnalysis(accountId)) {
      return;
    }
    this.publishReplaySignal(accountId, symbol);
  }

  enqueuePositionReview(accountId: string, symbol: string): void {
    if (!this.canRunLiveAnalysis(accountId)) {
      return;
    }
    const result = this.analysis.analyzeAccountSymbol(accountId, symbol);
    this.analysis.persistPositionStates?.(accountId, symbol, result.replay.position_states ?? null);
    this.shadow?.recordRuntimeSnapshot({
      account_id: accountId,
      symbol,
      source: 'position_review',
      signal: result.replay.signal,
      command: result.replay.position_commands,
    });
    this.queueReplaySignal(accountId, symbol, result.replay.signal, 'positions');
    if (result.replay.signal == null) {
      this.queueAIStopLossAdjust(accountId, symbol);
    }
    for (const command of (result.replay.position_commands ?? [])) {
      const candidate = this.positionCommandCandidate(accountId, symbol, command as unknown as EaRecord);
      if (this.store?.getCommand(candidate.command_id ?? '') != null) {
        continue;
      }
      this.commandLifecycle.acceptCandidate(accountId, candidate);
    }
  }

  private canRunLiveAnalysis(accountId: string): boolean {
    const heartbeat = this.store?.getHeartbeat(accountId);
    if (heartbeat == null) {
      return true;
    }
    return explicitBoolean(heartbeat, 'market_open') !== false && explicitBoolean(heartbeat, 'is_trade_allowed') !== false;
  }

  private publishReplaySignal(accountId: string, symbol: string): void {
    const result = this.analysis.analyzeAccountSymbol(accountId, symbol);
    this.shadow?.recordRuntimeSnapshot({
      account_id: accountId,
      symbol,
      source: 'ea_analysis',
      signal: result.replay.signal,
      command: null,
    });
    this.queueReplaySignal(accountId, symbol, result.replay.signal, 'bars');
  }

  private queueReplaySignal(accountId: string, symbol: string, signal: unknown, analysisMode: 'bars' | 'positions'): void {
    if (signal == null) {
      return;
    }
    const signalRecord = signal as EaRecord;
    const bars = this.barsByTimeframe(accountId, symbol);
    const triggerKey = liveDecisionKey(stringField(signalRecord, 'strategy'), bars);
    const commandId = liveCommandId(accountId, symbol, signalRecord, triggerKey);
    if (this.store?.getCommand(commandId) != null) {
      return;
    }
    const currentPrice = liveCurrentPrice(this.store?.getLatestTick(accountId, symbol) ?? {}, bars);
    const atr = latestAtr(bars.H1) || numberField(signalRecord, 'atr');
    const orderType = orderTypeForSignal(currentPrice, numberField(signalRecord, 'entry'), atr, stringField(signalRecord, 'side'));
    const candidate: CommandCandidate = {
      command_id: commandId,
      decision_id: commandId,
      action: 'SIGNAL',
      source: 'live_strategy',
      strategy: stringField(signalRecord, 'strategy') as CommandCandidate['strategy'],
      symbol,
      type: stringField(signalRecord, 'side'),
      entry: numberField(signalRecord, 'entry'),
      sl: numberField(signalRecord, 'stop_loss'),
      tp1: numberField(signalRecord, 'tp1'),
      tp2: numberField(signalRecord, 'tp2'),
      score: numberField(signalRecord, 'score'),
      atr: numberField(signalRecord, 'atr'),
      scale_in_parent_ticket: numberField(signalRecord, 'scale_in_parent_ticket'),
      weighted_avg_entry: numberField(signalRecord, 'weighted_avg_entry'),
      unified_sl: numberField(signalRecord, 'unified_sl'),
      scale_in_count: numberField(signalRecord, 'scale_in_count'),
      trigger_key: triggerKey,
      analysis_mode: analysisMode,
      order_type: orderType
    };
    if (booleanField(signalRecord, 'fib_enhanced')) {
      candidate.fib_enhanced = true;
    }
    if (orderType !== 'market') {
      candidate.expiration = unixSeconds(this.nowIso()) + 24 * 60 * 60;
    }
    this.commandLifecycle.acceptCandidate(accountId, candidate);
  }

  private queueAIStopLossAdjust(accountId: string, symbol: string): void {
    const aiResult = this.latestAIResult(accountId, symbol);
    const aiSL = numberField(aiResult ?? {}, 'suggested_sl') || numberField(aiResult ?? {}, 'suggestedSL');
    if (aiResult == null || aiSL <= 0) {
      return;
    }
    const bars = this.barsByTimeframe(accountId, symbol);
    const atr = latestAtr(bars.H1);
    if (atr <= 0) {
      return;
    }
    const currentPrice = liveCurrentPrice(this.store?.getLatestTick(accountId, symbol) ?? {}, bars);
    if (currentPrice <= 0) {
      return;
    }
    const decisionId = aiDecisionId(aiResult);
    for (const position of this.store?.getPositions?.(accountId, symbol) ?? []) {
      const candidate = this.aiStopLossCommandCandidate(accountId, symbol, position, aiSL, atr, currentPrice, decisionId);
      if (candidate == null || this.store?.getCommand(candidate.command_id ?? '') != null) {
        continue;
      }
      this.commandLifecycle.acceptCandidate(accountId, candidate);
    }
  }

  private latestAIResult(accountId: string, symbol: string): EaRecord | undefined {
    return this.store?.getAIResults?.(accountId).find((result) => stringField(result, 'symbol') === symbol);
  }

  private aiStopLossCommandCandidate(
    accountId: string,
    symbol: string,
    position: EaRecord,
    newSL: number,
    atr: number,
    currentPrice: number,
    decisionId: string
  ): CommandCandidate | undefined {
    const ticket = numberField(position, 'ticket');
    const oldSL = numberField(position, 'sl');
    const tp = numberField(position, 'tp');
    const openPrice = numberField(position, 'open_price') || numberField(position, 'openPrice');
    const side = stringField(position, 'type').toUpperCase();
    if (ticket <= 0 || oldSL === 0 || tp === 0 || openPrice <= 0) {
      return undefined;
    }
    if (side === 'BUY') {
      if (currentPrice > openPrice && newSL < oldSL) {
        return undefined;
      }
      if (newSL >= openPrice) {
        return undefined;
      }
    } else if (side === 'SELL') {
      if (currentPrice < openPrice && newSL > oldSL) {
        return undefined;
      }
      if (newSL <= openPrice) {
        return undefined;
      }
    } else {
      return undefined;
    }
    const distance = Math.abs(newSL - oldSL);
    if (distance < atr * 0.3) {
      return undefined;
    }
    const triggerTime = this.nowIso();
    const candidate: CommandCandidate = {
      command_id: aiStopLossCommandId(accountId, symbol, ticket, triggerTime),
      action: 'MODIFY',
      source: 'ai_stop_loss',
      symbol,
      ticket,
      new_sl: newSL,
      sl: newSL,
      tp,
      old_sl: oldSL,
      distance,
      atr,
      trigger_time: triggerTime,
      analysis_mode: 'positions'
    };
    if (decisionId.length > 0) {
      candidate.decision_id = decisionId;
    }
    return candidate;
  }

  private positionCommandCandidate(accountId: string, symbol: string, command: EaRecord): CommandCandidate {
    const action = stringField(command, 'action');
    const ticket = numberField(command, 'ticket');
    const reason = stringField(command, 'reason');
    const aiStopLoss = isAIStopLossModify(command);
    const commandId = positionCommandId(accountId, symbol, command, this.nowIso());
    const candidate: CommandCandidate = {
      command_id: commandId,
      action,
      source: aiStopLoss ? 'ai_stop_loss' : 'position_review',
      symbol,
      ticket,
      reason,
      analysis_mode: 'positions'
    };
    const lots = numberField(command, 'lots');
    if (lots > 0) {
      candidate.lots = lots;
    }
    const newSl = numberField(command, 'new_sl');
    if (newSl > 0) {
      candidate.new_sl = newSl;
    }
    if (aiStopLoss) {
      candidate.sl = numberField(command, 'sl') || newSl;
      candidate.tp = numberField(command, 'tp');
      candidate.old_sl = numberField(command, 'old_sl');
      candidate.distance = numberField(command, 'distance');
      candidate.atr = numberField(command, 'atr');
      candidate.trigger_time = stringField(command, 'trigger_time') || this.nowIso();
      const decisionId = stringField(command, 'decision_id');
      if (decisionId.length > 0) {
        candidate.decision_id = decisionId;
      }
    }
    return candidate;
  }

  private barsByTimeframe(accountId: string, symbol: string): Record<string, EaRecord[]> {
    return {
      H1: this.store?.getBars(accountId, symbol, 'H1') ?? [],
      H4: this.store?.getBars(accountId, symbol, 'H4') ?? [],
      M30: this.store?.getBars(accountId, symbol, 'M30') ?? [],
      M15: this.store?.getBars(accountId, symbol, 'M15') ?? [],
      M5: this.store?.getBars(accountId, symbol, 'M5') ?? [],
      M1: this.store?.getBars(accountId, symbol, 'M1') ?? []
    };
  }
}

function isLiveStrategyTimeframe(timeframe: string): boolean {
  return ['H4', 'H1', 'M30', 'M15', 'M5', 'M1'].includes(timeframe.trim().toUpperCase());
}

function explicitBoolean(record: EaRecord, field: string): boolean | undefined {
  return typeof record[field] === 'boolean' ? record[field] : undefined;
}

function liveDecisionKey(strategy: string, bars: Record<string, EaRecord[]>): string {
  return strategy === 'momentum_scalp'
    ? lastLiveBarRef(bars, 'M1', 'M5', 'M15', 'H1')
    : lastLiveBarRef(bars, 'H1', 'M15', 'M5', 'M30', 'H4', 'M1');
}

function lastLiveBarRef(bars: Record<string, EaRecord[]>, ...order: string[]): string {
  for (const timeframe of order) {
    const last = bars[timeframe]?.at(-1);
    const time = last == null ? '' : stringField(last, 'time').trim();
    if (time.length > 0) {
      return `${timeframe}:${time}`;
    }
  }
  return 'no-bars';
}

function liveCommandId(accountId: string, symbol: string, signal: EaRecord, decisionKey: string): string {
  const seed = [
    accountId,
    symbol.toUpperCase(),
    stringField(signal, 'strategy'),
    stringField(signal, 'side'),
    decisionKey
  ].join('|');
  return `live_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function positionCommandId(accountId: string, symbol: string, command: EaRecord, nowIso: string): string {
  const ticket = numberField(command, 'ticket');
  if (isAIStopLossModify(command)) {
    return aiStopLossCommandId(accountId, symbol, ticket, nowIso);
  }
  const seed = [
    accountId,
    symbol.toUpperCase(),
    ticket,
    stringField(command, 'action'),
    stringField(command, 'reason'),
    numberField(command, 'lots'),
    numberField(command, 'new_sl'),
    utcMinuteKey(nowIso)
  ].join('|');
  return `pos_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function aiStopLossCommandId(accountId: string, symbol: string, ticket: number, nowIso: string): string {
  const seed = [accountId, symbol.toUpperCase(), ticket, utcMinuteKey(nowIso)].join('|');
  return `mod_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function aiDecisionId(aiResult: EaRecord): string {
  const tradePlan = recordField(aiResult, 'trade_plan') ?? recordField(aiResult, 'tradePlan') ?? {};
  return stringField(tradePlan, 'decision_id') || stringField(aiResult, 'decision_id');
}

function recordField(record: EaRecord, field: string): EaRecord | undefined {
  const value = record[field];
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as EaRecord : undefined;
}

function isAIStopLossModify(command: EaRecord): boolean {
  return stringField(command, 'action') === 'MODIFY' && (
    hasFiniteNumber(command, 'sl') ||
    hasFiniteNumber(command, 'tp') ||
    hasFiniteNumber(command, 'old_sl') ||
    hasFiniteNumber(command, 'distance') ||
    hasFiniteNumber(command, 'atr') ||
    stringField(command, 'decision_id').length > 0
  );
}

function utcMinuteKey(value: string): string {
  const millis = Date.parse(value);
  const date = new Date(Number.isFinite(millis) ? millis : Date.now());
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0')
  ].join('');
}

function liveCurrentPrice(tick: EaRecord, bars: Record<string, EaRecord[]>): number {
  const bid = numberField(tick, 'bid');
  const ask = numberField(tick, 'ask');
  if (bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  if (ask > 0) {
    return ask;
  }
  if (bid > 0) {
    return bid;
  }
  for (const timeframe of ['H1', 'M15', 'M5', 'M1', 'M30', 'H4']) {
    const close = numberField(bars[timeframe]?.at(-1) ?? {}, 'close');
    if (close > 0) {
      return close;
    }
  }
  return 0;
}

function latestAtr(bars: EaRecord[]): number {
  const last = bars.at(-1);
  return last == null ? 0 : numberField(last, 'atr') || numberField(last, 'ATR');
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

function unixSeconds(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : Math.floor(Date.now() / 1000);
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasFiniteNumber(record: EaRecord, field: string): boolean {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value);
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function booleanField(record: EaRecord, field: string): boolean {
  return record[field] === true;
}
