import type { CommandCandidate } from '@gold-bot/persistence';
import { AnalysisService } from '../analysis/service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';

export class SchedulerService {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly commandLifecycle: CommandLifecycleService
  ) {}

  enqueueAnalysis(accountId: string, symbol: string): void {
    this.publishReplaySignal(accountId, symbol);
  }

  enqueuePositionReview(accountId: string, symbol: string): void {
    this.publishReplaySignal(accountId, symbol);
  }

  private publishReplaySignal(accountId: string, symbol: string): void {
    const result = this.analysis.analyzeAccountSymbol(accountId, symbol);
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
