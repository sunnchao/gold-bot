import type { CommandCandidate } from '@gold-bot/persistence';
import { AnalysisService } from '../analysis/service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import type { ShadowService } from '../shadow/service.js';

export class SchedulerService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly commandLifecycle: CommandLifecycleService,
    private readonly shadow?: ShadowService
  ) {}

  enqueueAnalysis(accountId: string, symbol: string): void {
    this.publishReplaySignal(accountId, symbol);
  }

  enqueuePositionReview(accountId: string, symbol: string): void {
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
