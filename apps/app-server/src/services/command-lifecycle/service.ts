import type { CommandCandidate, EaStore, StoredCommand } from '@gold-bot/persistence';

export class CommandLifecycleService {
  constructor(private readonly store: EaStore) {}

  acceptCandidate(accountId: string, candidate: CommandCandidate): StoredCommand {
    const stored = this.store.saveCommandCandidate(accountId, candidate);
    const mode = this.store.getRuntimeMode(accountId);
    if (mode === 'cutover') {
      this.store.promoteCommand(stored.command_id);
    } else {
      this.store.demoteCommandToShadowOnly(stored.command_id);
    }
    const resolved = this.store.getCommand(stored.command_id) ?? stored;
    this.store.recordShadowComparison({
      account_id: accountId,
      symbol: typeof resolved.symbol === 'string' && resolved.symbol.length > 0 ? resolved.symbol : 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: false,
      oracle_compared: false,
      source: resolved.source,
      created_at: resolved.created_at
    });
    return resolved;
  }

  reconcile(accountId: string, commandId: string, result: string, ticket?: number): void {
    this.store.reconcileCommandResult(accountId, commandId, result, ticket);
  }
}
