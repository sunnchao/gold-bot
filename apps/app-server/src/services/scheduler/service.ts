import { createHash } from 'node:crypto';
import type { CommandCandidate, EaRecord, EaStore } from '@gold-bot/persistence';
import { atr, type ReplayPositionCommand } from '@gold-bot/trading-core';
import { AnalysisService } from '../analysis/service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import type { ShadowService } from '../shadow/service.js';

const AI_STOP_LOSS_MODIFY_COOLDOWN_MS = 5 * 60 * 1000;
const AI_STOP_LOSS_PROFIT_ATR_GATE = 1.5;
const DEFAULT_AI_TRAIL_SYMBOLS = 'GBPJPY';
const MODIFY_DISTANCE_EPSILON = 1e-9;
/** MT4 STOPLEVEL 最小距离比例（0.05%），SL/TP 离当前价比此更近会触发 error 130 */
const STOPLEVEL_MIN_RATIO = 0.0005;
/** 仓位数据超过此时间未更新视为过期（可能已平仓），跳过避免 4108 */
const STALE_POSITION_MS = 5 * 60 * 1000;

type AIStopLossSkipReason =
  | 'suggested_sl_le_zero'
  | 'ai_result_missing'
  | 'atr_le_zero'
  | 'price_le_zero'
  | 'symbol_ai_trail_disabled'
  | 'not_be_or_profit_ready'
  | 'price_magnitude'
  | 'candidate_null'
  | 'command_exists'
  | 'cooldown_active';

export class SchedulerService {
  private readonly aiStopLossQueuedAtMs = new Map<string, number>();

  constructor(
    private readonly analysis: AnalysisService,
    private readonly commandLifecycle: CommandLifecycleService,
    private readonly shadow?: ShadowService,
    private readonly store?: Pick<EaStore, 'getHeartbeat' | 'getLatestTick' | 'getBars' | 'getCommand' | 'getPositions' | 'getAIResults' | 'loadPositionStates'>,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async enqueueAnalysis(accountId: string, symbol: string, timeframe = ''): Promise<void> {
    if (!isLiveStrategyTimeframe(timeframe) || !(await this.canRunLiveAnalysis(accountId))) {
      return;
    }
    await this.publishReplaySignal(accountId, symbol);
  }

  async enqueuePositionReview(accountId: string, symbol: string): Promise<void> {
    if (!(await this.canRunLiveAnalysis(accountId))) {
      return;
    }
    const result = await this.analysis.analyzeAccountSymbol(accountId, symbol);
    if (this.shadow) {
      await this.shadow.recordRuntimeSnapshot({
        account_id: accountId,
        symbol,
        source: 'position_review',
        signal: result.replay.signal,
        command: result.replay.position_commands,
      });
    }
    await this.queueReplaySignal(accountId, symbol, result.replay.signal, 'positions');
    if (result.replay.signal == null) {
      await this.queueAIStopLossAdjust(accountId, symbol);
    }
    await this.queuePositionManagerCommands(accountId, symbol, result.replay.position_commands);
    if (result.replay.position_states != null && result.replay.position_states.length > 0) {
      await this.analysis.persistPositionStates(accountId, symbol, result.replay.position_states);
    }
  }

  private async canRunLiveAnalysis(accountId: string): Promise<boolean> {
    const heartbeat = (await this.store?.getHeartbeat(accountId)) ?? {};
    return explicitBoolean(heartbeat, 'market_open') === true && explicitBoolean(heartbeat, 'is_trade_allowed') === true;
  }

  private async publishReplaySignal(accountId: string, symbol: string): Promise<void> {
    const result = await this.analysis.analyzeAccountSymbol(accountId, symbol);
    if (this.shadow) {
      await this.shadow.recordRuntimeSnapshot({
        account_id: accountId,
        symbol,
        source: 'ea_analysis',
        signal: result.replay.signal,
        command: null,
      });
    }
    await this.queueReplaySignal(accountId, symbol, result.replay.signal, 'bars');
  }

  private async queueReplaySignal(accountId: string, symbol: string, signal: unknown, analysisMode: 'bars' | 'positions'): Promise<void> {
    if (signal == null) {
      return;
    }
    const signalRecord = signal as EaRecord;
    const bars = await this.barsByTimeframe(accountId, symbol);
    const triggerKey = liveDecisionKey(stringField(signalRecord, 'strategy'), bars);
    const commandId = liveCommandId(accountId, symbol, signalRecord, triggerKey);
    if ((await this.store?.getCommand(commandId)) != null) {
      return;
    }
    const currentPrice = liveCurrentPrice((await this.store?.getLatestTick(accountId, symbol)) ?? {}, bars);
    const atr = latestAtr(bars.H1) || numberField(signalRecord, 'atr');
    const orderType = orderTypeForSignal(currentPrice, numberField(signalRecord, 'entry'), atr, stringField(signalRecord, 'side'));
    // Multi-TP split: only enable when signal has a meaningful TP2 (>0 and different from TP1)
    const tp1Value = numberField(signalRecord, 'tp1');
    const tp2Value = numberField(signalRecord, 'tp2');
    const shouldSplitTP = tp2Value > 0 && Math.abs(tp2Value - tp1Value) > 0;
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
      tp1: tp1Value,
      tp2: tp2Value,
      score: numberField(signalRecord, 'score'),
      atr: numberField(signalRecord, 'atr'),
      scale_in_parent_ticket: numberField(signalRecord, 'scale_in_parent_ticket'),
      weighted_avg_entry: numberField(signalRecord, 'weighted_avg_entry'),
      unified_sl: numberField(signalRecord, 'unified_sl'),
      scale_in_count: numberField(signalRecord, 'scale_in_count'),
      trigger_key: triggerKey,
      analysis_mode: analysisMode,
      order_type: orderType,
      // Multi-TP split flag: true when signal has TP2, instructing EA to split into 2 orders
      // (40% lots @ TP1 + 60% lots @ TP2). EA handles lot distribution; ensures total ≤ plan lots.
      tp_split: shouldSplitTP
    };
    if (booleanField(signalRecord, 'fib_enhanced')) {
      candidate.fib_enhanced = true;
    }
    if (orderType !== 'market') {
      candidate.expiration = unixSeconds(this.nowIso()) + 24 * 60 * 60;
    }
    await this.commandLifecycle.acceptCandidate(accountId, candidate);
  }

  private async queueAIStopLossAdjust(accountId: string, symbol: string): Promise<void> {
    if (!isAIStopLossTrailSymbolEnabled(symbol)) {
      this.logAIStopLossSkip(accountId, symbol, 'symbol_ai_trail_disabled');
      return;
    }
    const aiResult = await this.latestAIResult(accountId, symbol);
    if (aiResult == null) {
      this.logAIStopLossSkip(accountId, symbol, 'ai_result_missing');
      return;
    }
    const aiSL = numberField(aiResult, 'suggested_sl') || numberField(aiResult, 'suggestedSL');
    if (aiSL <= 0) {
      this.logAIStopLossSkip(accountId, symbol, 'suggested_sl_le_zero', { suggested_sl: aiSL });
      return;
    }
    const bars = await this.barsByTimeframe(accountId, symbol);
    const atr = latestAtr(bars.H1);
    if (atr <= 0) {
      this.logAIStopLossSkip(accountId, symbol, 'atr_le_zero', { atr });
      return;
    }
    const currentPrice = liveCurrentPrice((await this.store?.getLatestTick(accountId, symbol)) ?? {}, bars);
    if (currentPrice <= 0) {
      this.logAIStopLossSkip(accountId, symbol, 'price_le_zero', { price: currentPrice });
      return;
    }
    if (aiSL < currentPrice * 0.3 || aiSL > currentPrice * 2.0) {
      this.logAIStopLossSkip(accountId, symbol, 'price_magnitude', {
        suggested_sl: aiSL,
        price: currentPrice
      });
      return;
    }
    const decisionId = aiDecisionId(aiResult);
    const statesByTicket = new Map(
      ((await this.store?.loadPositionStates(accountId, symbol)) ?? []).map((state) => [state.ticket, state])
    );
    for (const position of (await this.store?.getPositions?.(accountId, symbol)) ?? []) {
      const ticket = numberField(position, 'ticket');
      const beMoved = statesByTicket.get(ticket)?.be_moved === true;
      const profitAtr = aiStopLossProfitAtr(position, atr, currentPrice);
      if (!beMoved && profitAtr != null && profitAtr < AI_STOP_LOSS_PROFIT_ATR_GATE) {
        this.logAIStopLossSkip(accountId, symbol, 'not_be_or_profit_ready', {
          ticket,
          profit_atr: profitAtr,
          be_moved: beMoved
        });
        continue;
      }
      const candidate = this.aiStopLossCommandCandidate(accountId, symbol, position, aiSL, atr, currentPrice, decisionId);
      if (candidate == null) {
        this.logAIStopLossSkip(accountId, symbol, 'candidate_null', {
          ticket: numberField(position, 'ticket'),
          decision_id: decisionId
        });
        continue;
      }
      if ((await this.store?.getCommand(candidate.command_id ?? '')) != null) {
        this.logAIStopLossSkip(accountId, symbol, 'command_exists', {
          ticket: numberField(candidate, 'ticket'),
          command_id: candidate.command_id ?? ''
        });
        continue;
      }
      if (this.isAIStopLossCooldownActive(accountId, symbol, candidate)) {
        this.logAIStopLossSkip(accountId, symbol, 'cooldown_active', {
          ticket: numberField(candidate, 'ticket'),
          command_id: candidate.command_id ?? ''
        });
        continue;
      }
      await this.commandLifecycle.acceptCandidate(accountId, candidate);
      this.rememberAIStopLossQueued(accountId, symbol, candidate);
    }
  }

  private async queuePositionManagerCommands(
    accountId: string,
    symbol: string,
    commands: ReplayPositionCommand[] | null
  ): Promise<void> {
    if (commands == null || commands.length === 0) {
      return;
    }
    const nowIso = this.nowIso();
    const positions = (await this.store?.getPositions?.(accountId, symbol)) ?? [];
    const bars = await this.barsByTimeframe(accountId, symbol);
    const currentPrice = liveCurrentPrice((await this.store?.getLatestTick(accountId, symbol)) ?? {}, bars);
    for (const command of commands) {
      const candidate = this.positionManagerCommandCandidate(accountId, symbol, command, positions, nowIso, currentPrice);
      if (candidate == null || (await this.store?.getCommand?.(candidate.command_id ?? '')) != null) {
        continue;
      }
      await this.commandLifecycle.acceptCandidate(accountId, candidate);
    }
  }

  private positionManagerCommandCandidate(
    accountId: string,
    symbol: string,
    command: ReplayPositionCommand,
    positions: EaRecord[],
    nowIso: string,
    currentPrice: number
  ): CommandCandidate | undefined {
    const ticket = command.ticket;
    if (!Number.isFinite(ticket) || ticket <= 0) {
      return undefined;
    }
    const commandId = positionManagerCommandId(accountId, symbol, command, nowIso);
    if (command.action === 'MODIFY') {
      const newSL = command.new_sl ?? 0;
      if (newSL <= 0) {
        return undefined;
      }
      const position = positions.find((candidate) => numberField(candidate, 'ticket') === ticket);
      if (position == null) {
        return undefined;
      }
      // 仓位新鲜度检查：超过5分钟未更新的仓位可能已平仓，跳过避免 4108
      if (isStalePosition(position, nowIso)) {
        return undefined;
      }
      const oldSL = numberField(position, 'sl');
      if (oldSL <= 0) {
        return undefined;
      }
      if (Math.abs(newSL - oldSL) < MODIFY_DISTANCE_EPSILON) {
        return undefined;
      }
      // STOPLEVEL 距离检查：newSL 离当前价太近会导致 MT4 error 130
      if (currentPrice > 0 && Math.abs(newSL - currentPrice) < currentPrice * STOPLEVEL_MIN_RATIO) {
        return undefined;
      }
      return {
        command_id: commandId,
        action: 'MODIFY',
        source: 'position_manager',
        symbol,
        ticket,
        new_sl: newSL,
        sl: newSL,
        old_sl: oldSL,
        tp: numberField(position, 'tp'),
        open_price: numberField(position, 'open_price') || numberField(position, 'openPrice'),
        distance: Math.abs(newSL - oldSL),
        reason: command.reason,
        trigger_time: nowIso,
        analysis_mode: 'positions'
      };
    }
    if (command.action === 'CLOSE') {
      // 仅对市价仓入队 CLOSE；挂单应走 CANCEL_PENDING
      const position = positions.find((candidate) => numberField(candidate, 'ticket') === ticket);
      if (position == null) {
        return undefined;
      }
      if (isPendingPositionRecord(position)) {
        return undefined;
      }
      // 仓位新鲜度检查：超过5分钟未更新的仓位可能已平仓，跳过避免 4108
      if (isStalePosition(position, nowIso)) {
        return undefined;
      }
      return {
        command_id: commandId,
        action: 'CLOSE',
        source: 'position_manager',
        symbol,
        ticket,
        lots: command.lots,
        reason: command.reason,
        trigger_time: nowIso,
        analysis_mode: 'positions'
      };
    }
    if (command.action === 'CANCEL_PENDING') {
      return {
        command_id: commandId,
        action: 'CANCEL_PENDING',
        source: 'position_manager',
        symbol,
        ticket,
        reason: command.reason,
        trigger_time: nowIso,
        analysis_mode: 'positions'
      };
    }
    return undefined;
  }

  private isAIStopLossCooldownActive(accountId: string, symbol: string, candidate: CommandCandidate): boolean {
    if (!isAIStopLossModifyCandidate(candidate)) {
      return false;
    }
    const ticket = numberField(candidate, 'ticket');
    if (ticket <= 0) {
      return false;
    }
    const queuedAtMs = candidateTimestampMs(candidate, this.nowIso);
    const lastQueuedAtMs = this.aiStopLossQueuedAtMs.get(aiStopLossCooldownKey(accountId, symbol, ticket));
    return lastQueuedAtMs != null && queuedAtMs - lastQueuedAtMs < AI_STOP_LOSS_MODIFY_COOLDOWN_MS;
  }

  private rememberAIStopLossQueued(accountId: string, symbol: string, candidate: CommandCandidate): void {
    if (!isAIStopLossModifyCandidate(candidate)) {
      return;
    }
    const ticket = numberField(candidate, 'ticket');
    if (ticket <= 0) {
      return;
    }
    this.aiStopLossQueuedAtMs.set(
      aiStopLossCooldownKey(accountId, symbol, ticket),
      candidateTimestampMs(candidate, this.nowIso)
    );
  }

  private async latestAIResult(accountId: string, symbol: string): Promise<EaRecord | undefined> {
    const results = (await this.store?.getAIResults?.(accountId)) ?? [];
    return results.find((result) => stringField(result, 'symbol') === symbol);
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
    if (ticket <= 0 || oldSL <= 0 || tp <= 0 || openPrice <= 0) {
      return undefined;
    }
    if (side === 'BUY') {
      if (newSL < oldSL) {
        return undefined;
      }
      if (newSL >= currentPrice) {
        return undefined;
      }
    } else if (side === 'SELL') {
      if (newSL > oldSL) {
        return undefined;
      }
      if (newSL <= currentPrice) {
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

  private logAIStopLossSkip(
    accountId: string,
    symbol: string,
    reason: AIStopLossSkipReason,
    details: Record<string, unknown> = {}
  ): void {
    console.log(`[AI] stop_loss_skip ${JSON.stringify({ account_id: accountId, symbol, reason, ...details })}`);
  }

  private async barsByTimeframe(accountId: string, symbol: string): Promise<Record<string, EaRecord[]>> {
    return {
      H1: (await this.store?.getBars(accountId, symbol, 'H1')) ?? [],
      H4: (await this.store?.getBars(accountId, symbol, 'H4')) ?? [],
      M30: (await this.store?.getBars(accountId, symbol, 'M30')) ?? [],
      M15: (await this.store?.getBars(accountId, symbol, 'M15')) ?? [],
      M5: (await this.store?.getBars(accountId, symbol, 'M5')) ?? [],
      M1: (await this.store?.getBars(accountId, symbol, 'M1')) ?? []
    };
  }
}

function isLiveStrategyTimeframe(timeframe: string): boolean {
  return ['H4', 'H1', 'M30', 'M15', 'M5', 'M1'].includes(timeframe.trim().toUpperCase());
}

function explicitBoolean(record: EaRecord, field: string): boolean | undefined {
  return typeof record[field] === 'boolean' ? record[field] : undefined;
}

function isAIStopLossModifyCandidate(candidate: CommandCandidate): boolean {
  return candidate.source === 'ai_stop_loss' && candidate.action === 'MODIFY';
}

function aiStopLossCooldownKey(accountId: string, symbol: string, ticket: number): string {
  return [accountId, symbol.toUpperCase(), ticket].join('|');
}

function candidateTimestampMs(candidate: CommandCandidate, fallbackNowIso: () => string): number {
  const triggerTimeMs = Date.parse(stringField(candidate, 'trigger_time'));
  if (Number.isFinite(triggerTimeMs)) {
    return triggerTimeMs;
  }
  const fallbackMs = Date.parse(fallbackNowIso());
  return Number.isFinite(fallbackMs) ? fallbackMs : Date.now();
}

function liveDecisionKey(strategy: string, bars: Record<string, EaRecord[]>): string {
  // NOTE: momentum_scalp disabled, all strategies use full bar set
  return lastLiveBarRef(bars, 'H1', 'M15', 'M5', 'M30', 'H4', 'M1');
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

function aiStopLossCommandId(accountId: string, symbol: string, ticket: number, nowIso: string): string {
  const seed = [accountId, symbol.toUpperCase(), ticket, utcMinuteKey(nowIso)].join('|');
  return `mod_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

function positionManagerCommandId(accountId: string, symbol: string, command: ReplayPositionCommand, nowIso: string): string {
  const timestampKey = utcMinuteKey(nowIso);
  // 归一化 reason：移除动态 dd 值（如 trail_tp1_dd1.2 → trail_tp1）
  // 防止同一仓位因 drawdown 数值变化生成不同 command_id，导致去重失效
  const normalizedReason = (command.reason ?? '').replace(/_dd[\d.]+/, '');
  return [
    'pm',
    commandIdPart(accountId),
    commandIdPart(symbol.toUpperCase()),
    String(command.ticket),
    command.action.toLowerCase(),
    commandIdPart(normalizedReason),
    timestampKey
  ].filter((part) => part.length > 0).join('_');
}

function commandIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

/** 识别挂单记录：order_class=pending 或 type 为 *_LIMIT/*_STOP */
function isPendingPositionRecord(position: EaRecord): boolean {
  const orderClass = stringField(position, 'order_class') || stringField(position, 'orderClass');
  if (orderClass.toLowerCase() === 'pending') {
    return true;
  }
  if (orderClass.toLowerCase() === 'market') {
    return false;
  }
  const type = stringField(position, 'type').toUpperCase();
  return type.includes('LIMIT') || type.includes('STOP');
}

/** 仓位新鲜度检查：超过 STALE_POSITION_MS 未更新的仓位视为过期（可能已平仓） */
function isStalePosition(position: EaRecord, nowIso: string): boolean {
  const timeStr = stringField(position, 'time') || stringField(position, 'updated_at') || stringField(position, 'updatedAt');
  if (!timeStr) {
    return false; // 无时间字段，不阻拦
  }
  const ms = Date.parse(timeStr);
  if (!Number.isFinite(ms)) {
    return false;
  }
  const nowMs = Date.parse(nowIso);
  const ref = Number.isFinite(nowMs) ? nowMs : Date.now();
  return ref - ms > STALE_POSITION_MS;
}

function aiDecisionId(aiResult: EaRecord): string {
  const tradePlan = recordField(aiResult, 'trade_plan') ?? recordField(aiResult, 'tradePlan') ?? {};
  return stringField(tradePlan, 'decision_id') || stringField(aiResult, 'decision_id');
}

function recordField(record: EaRecord, field: string): EaRecord | undefined {
  const value = record[field];
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as EaRecord : undefined;
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
  if (last != null) {
    const lowerAtr = numberField(last, 'atr');
    if (lowerAtr > 0) {
      return lowerAtr;
    }
    const upperAtr = numberField(last, 'ATR');
    if (upperAtr > 0) {
      return upperAtr;
    }
  }

  const ohlcBars = bars.filter((bar) =>
    numberField(bar, 'open') > 0 &&
    numberField(bar, 'high') > 0 &&
    numberField(bar, 'low') > 0 &&
    numberField(bar, 'close') > 0
  );
  if (ohlcBars.length < 14) {
    return 0;
  }
  const atrValues = atr(
    ohlcBars.map((bar) => numberField(bar, 'high')),
    ohlcBars.map((bar) => numberField(bar, 'low')),
    ohlcBars.map((bar) => numberField(bar, 'close')),
    14
  );
  for (let index = atrValues.length - 1; index >= 0; index -= 1) {
    const value = atrValues[index];
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function isAIStopLossTrailSymbolEnabled(symbol: string): boolean {
  return aiTrailSymbols().has(normalizeAIStopLossSymbol(symbol));
}

function aiTrailSymbols(): Set<string> {
  const raw = process.env.GB_AI_TRAIL_SYMBOLS ?? DEFAULT_AI_TRAIL_SYMBOLS;
  return new Set(raw.split(',').map(normalizeAIStopLossSymbol).filter((symbol) => symbol.length > 0));
}

function normalizeAIStopLossSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function aiStopLossProfitAtr(position: EaRecord, atrValue: number, currentPrice: number): number | undefined {
  const openPrice = numberField(position, 'open_price') || numberField(position, 'openPrice');
  if (atrValue <= 0 || currentPrice <= 0 || openPrice <= 0) {
    return undefined;
  }
  const side = stringField(position, 'type').toUpperCase();
  if (side === 'BUY') {
    return (currentPrice - openPrice) / atrValue;
  }
  if (side === 'SELL') {
    return (openPrice - currentPrice) / atrValue;
  }
  return undefined;
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

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function booleanField(record: EaRecord, field: string): boolean {
  return record[field] === true;
}
