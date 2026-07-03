import type { CommandCandidate, EaRecord, EaStore } from '@gold-bot/persistence';
import { AnalysisService } from '../analysis/service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import type { ShadowService } from '../shadow/service.js';

export class SchedulerService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly commandLifecycle: CommandLifecycleService,
    private readonly shadow?: ShadowService,
    private readonly store?: Pick<EaStore, 'getHeartbeat'>
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
      signal: null,
      command: result.replay.position_commands,
    });
    for (const [index, command] of (result.replay.position_commands ?? []).entries()) {
      const candidate: CommandCandidate = {
        command_id: `pos_${accountId}_${command.ticket}_${command.action}_${index}_${Date.now()}`,
        action: command.action,
        source: 'position_review',
        symbol,
        ticket: command.ticket,
        ...(command.lots == null ? {} : { lots: command.lots }),
        ...(command.new_sl == null ? {} : { new_sl: command.new_sl }),
        reason: command.reason
      };
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
    const signal = result.replay.signal;
    if (signal == null) {
      return;
    }
    const candidate: CommandCandidate = {
      command_id: `sig_${accountId}_${symbol}_${Date.now()}`,
      action: 'SIGNAL',
      source: 'ea_analysis',
      strategy: signal.strategy,
      symbol,
      type: signal.side,
      entry: signal.entry,
      sl: signal.stop_loss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      score: signal.score
    };
    this.commandLifecycle.acceptCandidate(accountId, candidate);
  }
}

function isLiveStrategyTimeframe(timeframe: string): boolean {
  return ['H4', 'H1', 'M30', 'M15', 'M5', 'M1'].includes(timeframe.trim().toUpperCase());
}

function explicitBoolean(record: EaRecord, field: string): boolean | undefined {
  return typeof record[field] === 'boolean' ? record[field] : undefined;
}
