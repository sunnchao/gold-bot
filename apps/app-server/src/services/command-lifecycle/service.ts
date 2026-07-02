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
    return this.store.getCommand(stored.command_id) ?? stored;
  }

  reconcile(accountId: string, commandId: string, result: string, ticket?: number): void {
    this.store.reconcileCommandResult(accountId, commandId, result, ticket);
  }
}
