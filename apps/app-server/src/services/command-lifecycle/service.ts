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
    const ok = await this.store.reconcileCommandResult(accountId, commandId, result, ticket, errorText, createdAt);

    // error 4108 = "order not found" — 仓位已被 EA 内置 TP/SL 平仓，服务端尚未感知。
    // 立即清理 position_states 里的幽灵行，防止 PM 持续对死 ticket 发命令。
    if (errorText?.trim() === '4108') {
      const targetTicket = extractTicketFromCommandId(commandId);
      const symbol = extractSymbolFromCommandId(commandId);
      if (targetTicket > 0 && symbol.length > 0) {
        try {
          const states = await this.store.loadPositionStates(accountId, symbol);
          const keepTickets = states
            .map((s) => Number(s.ticket))
            .filter((t) => t > 0 && t !== targetTicket);
          await this.store.deleteStalePositionStates(accountId, symbol, keepTickets);
        } catch {
          // 清理失败不影响主流程
        }
      }
    }

    return ok;
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

/**
 * PM 命令 ID 格式：pm_{accountId}_{symbol}_{ticket}_{action}_{reason}_{timestamp}
 * 从中提取目标 ticket，用于 4108 幽灵仓位清理。
 */
function extractTicketFromCommandId(commandId: string): number {
  const parts = commandId.split('_');
  if (parts[0] === 'pm' && parts.length >= 4) {
    const n = parseInt(parts[3], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function extractSymbolFromCommandId(commandId: string): string {
  const parts = commandId.split('_');
  if (parts[0] === 'pm' && parts.length >= 3) {
    return parts[2];
  }
  return '';
}
