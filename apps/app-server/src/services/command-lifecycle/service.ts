import type { CommandCandidate, EaStore, ShadowRuntimeSnapshot, StoredCommand } from '@gold-bot/persistence';
import type { RuntimeMode } from '@gold-bot/shared-contracts';
import type { ShadowService } from '../shadow/service.js';

export class CommandLifecycleService {
  constructor(
    private readonly store: EaStore,
    private readonly defaultRuntimeMode: RuntimeMode = 'oracle',
    private readonly shadow?: ShadowService
  ) {}

  async acceptCandidate(accountId: string, candidate: CommandCandidate): Promise<StoredCommand> {
    const stored = await this.store.saveCommandCandidate(accountId, candidate);
    const mode = resolveRuntimeMode(await this.store.getRuntimeMode(accountId), this.defaultRuntimeMode);
    if (mode === 'cutover') {
      await this.store.promoteCommand(stored.command_id);
    } else {
      await this.store.demoteCommandToShadowOnly(stored.command_id);
    }
    const resolved = (await this.store.getCommand(stored.command_id)) ?? stored;
    await this.shadow?.recordRuntimeSnapshot({
      account_id: accountId,
      symbol: typeof resolved.symbol === 'string' && resolved.symbol.length > 0 ? resolved.symbol : 'XAUUSD',
      source: shadowSourceForCommand(resolved.source),
      command: resolved,
      created_at: resolved.created_at
    });
    await this.store.recordShadowComparison({
      account_id: accountId,
      symbol: typeof resolved.symbol === 'string' && resolved.symbol.length > 0 ? resolved.symbol : 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: false,
      oracle_compared: false,
      source: shadowSourceForCommand(resolved.source),
      created_at: resolved.created_at
    });
    return resolved;
  }

  async reconcile(accountId: string, commandId: string, result: string, ticket?: number, errorText?: string, createdAt?: string): Promise<boolean> {
    return await this.store.reconcileCommandResult(accountId, commandId, result, ticket, errorText, createdAt);
  }
}

function shadowSourceForCommand(source: StoredCommand['source']): ShadowRuntimeSnapshot['source'] {
  if (source === 'live_strategy') {
    return 'ea_analysis';
  }
  if (source === 'ai_stop_loss' || source === 'position_manager') {
    return 'position_review';
  }
  return source === 'ai_risk_alert' || source === 'ai_approve' ? 'ai_result' : source;
}

function resolveRuntimeMode(storedMode: RuntimeMode, defaultRuntimeMode: RuntimeMode): RuntimeMode {
  if (storedMode === 'oracle' && (defaultRuntimeMode === 'shadow' || defaultRuntimeMode === 'cutover')) {
    return defaultRuntimeMode;
  }
  return storedMode;
}
