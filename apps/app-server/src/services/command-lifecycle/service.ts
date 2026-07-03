import type { CommandCandidate, EaStore, ShadowRuntimeSnapshot, StoredCommand } from '@gold-bot/persistence';
import type { RuntimeMode } from '@gold-bot/shared-contracts';
import type { ShadowService } from '../shadow/service.js';

export class CommandLifecycleService {
  constructor(
    private readonly store: EaStore,
    private readonly defaultRuntimeMode: RuntimeMode = 'oracle',
    private readonly shadow?: ShadowService
  ) {}

  acceptCandidate(accountId: string, candidate: CommandCandidate): StoredCommand {
    const stored = this.store.saveCommandCandidate(accountId, candidate);
    const mode = resolveRuntimeMode(this.store.getRuntimeMode(accountId), this.defaultRuntimeMode);
    if (mode === 'cutover') {
      this.store.promoteCommand(stored.command_id);
    } else {
      this.store.demoteCommandToShadowOnly(stored.command_id);
    }
    const resolved = this.store.getCommand(stored.command_id) ?? stored;
    this.shadow?.recordRuntimeSnapshot({
      account_id: accountId,
      symbol: typeof resolved.symbol === 'string' && resolved.symbol.length > 0 ? resolved.symbol : 'XAUUSD',
      source: shadowSourceForCommand(resolved.source),
      command: resolved,
      created_at: resolved.created_at
    });
    this.store.recordShadowComparison({
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

  reconcile(accountId: string, commandId: string, result: string, ticket?: number, errorText?: string, createdAt?: string): boolean {
    return this.store.reconcileCommandResult(accountId, commandId, result, ticket, errorText, createdAt);
  }
}

function shadowSourceForCommand(source: StoredCommand['source']): ShadowRuntimeSnapshot['source'] {
  return source === 'ai_risk_alert' ? 'ai_result' : source;
}

function resolveRuntimeMode(storedMode: RuntimeMode, defaultRuntimeMode: RuntimeMode): RuntimeMode {
  if (storedMode === 'oracle' && defaultRuntimeMode === 'shadow') {
    return 'shadow';
  }
  return storedMode;
}
