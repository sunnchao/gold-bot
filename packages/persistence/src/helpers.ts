import { isCommandSource, isCommandStatus, type CommandSource, type CommandStatus } from '@gold-bot/shared-contracts';
import type { CommandCandidate, StoredCommand } from './commands.js';
import type { DecisionEvent, DecisionEventFilter, DecisionEventInput } from './decisions.js';
import type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary } from './shadow.js';
import type { StoredApiToken, StoredApiTokenInput } from './tokens.js';

export const BE_TRIGGER_ATR_DEFAULT = 1.5;

export type EaRecord = Record<string, unknown>;

export type EaCommand = EaRecord & {
  command_id: string;
  action: string;
};

export type PositionStateRecord = {
  ticket: number;
  tp1_hit: boolean;
  tp2_hit: boolean;
  max_profit_atr: number;
  be_moved: boolean;
  be_trigger_atr: number;
  best_sl: number;
  open_time: string;
  last_modify_time: string;
  add_on_count: number;
  last_add_on_time: string;
  last_add_on_price: number;
  group_id: string;
  group_avg_entry: number;
  group_best_sl: number;
  trailing_closed: boolean;
};

export type PositionStateRow = {
  ticket: number;
  tp1_hit: number;
  tp2_hit: number;
  max_profit_atr: number;
  be_moved: number;
  be_trigger_atr: number;
  best_sl: number;
  open_time: string;
  last_modify_time: string;
  add_on_count: number;
  last_add_on_time: string;
  last_add_on_price: number;
  group_id: string;
  group_avg_entry: number;
  group_best_sl: number;
  trailing_closed: number;
};

export type RuntimeCommandRow = {
  account_id: string;
  status: string;
  source: string;
  payload_json: string;
  result: string;
  ticket: number | null;
  created_at: string;
  delivered_at: string;
  acked_at: string;
  failed_at: string;
  error_text: string;
};

export type RuntimeCommandListRow = RuntimeCommandRow & {
  command_id: string;
};

export type DecisionEventRow = {
  id: string | number;
  decision_id: string;
  account_id: string;
  symbol: string;
  stage: DecisionEvent['stage'];
  status: DecisionEvent['status'];
  reason_codes_json: string;
  summary_json: string;
  related_command_id: string;
  created_at: string;
};

export function accountId(payload: EaRecord): string {
  return stringField(payload, 'account_id');
}

export function symbolOrDefault(payload: EaRecord): string {
  return typeof payload.symbol === 'string' && payload.symbol.length > 0 ? payload.symbol : 'XAUUSD';
}

export function filterShadowComparisons(
  comparisons: ShadowComparison[],
  filter?: ShadowComparisonFilter
): ShadowComparison[] {
  if (filter == null) {
    return comparisons;
  }
  return comparisons.filter((comparison) => {
    if (filter.account_id != null && comparison.account_id !== filter.account_id) {
      return false;
    }
    if (filter.symbol != null && comparison.symbol !== filter.symbol) {
      return false;
    }
    if (filter.source != null && comparison.source !== filter.source) {
      return false;
    }
    if (filter.protocol_ok != null && comparison.protocol_ok !== filter.protocol_ok) {
      return false;
    }
    if (filter.signal_drift != null && comparison.signal_drift !== filter.signal_drift) {
      return false;
    }
    if (filter.command_drift != null && comparison.command_drift !== filter.command_drift) {
      return false;
    }
    if (filter.oracle_compared != null && comparison.oracle_compared !== filter.oracle_compared) {
      return false;
    }
    if (filter.created_at_gte != null && comparison.created_at < filter.created_at_gte) {
      return false;
    }
    if (filter.created_at_lte != null && comparison.created_at > filter.created_at_lte) {
      return false;
    }
    return true;
  });
}

export function summarizeShadowComparisons(comparisons: ShadowComparison[]): ShadowComparisonSummary {
  return {
    comparisons: comparisons.length,
    protocol_errors: comparisons.filter((comparison) => !comparison.protocol_ok).length,
    signal_drifts: comparisons.filter((comparison) => comparison.signal_drift).length,
    command_drifts: comparisons.filter((comparison) => comparison.command_drift).length,
    oracle_compared: comparisons.filter((comparison) => comparison.oracle_compared).length,
    first_created_at: comparisons[0]?.created_at ?? '',
    last_created_at: comparisons.at(-1)?.created_at ?? ''
  };
}

export function normalizeDecisionEvent(payload: DecisionEventInput, id: number): DecisionEvent {
  return {
    id,
    decision_id: payload.decision_id,
    account_id: payload.account_id,
    symbol: payload.symbol,
    stage: payload.stage,
    status: payload.status,
    reason_codes: [...payload.reason_codes],
    summary: structuredClone(payload.summary),
    related_command_id: payload.related_command_id,
    created_at: payload.created_at
  };
}

export function commandResultDecisionEvent(
  command: StoredCommand,
  result: string,
  ticket: number,
  errorText: string,
  createdAt: string
): DecisionEventInput | null {
  return commandDecisionEvent(
    command,
    'order_result',
    command.status === 'acked' ? 'acked' : 'failed',
    createdAt,
    {
      result,
      ticket,
      error_text: errorText
    }
  );
}

export function commandDecisionEvent(
  command: StoredCommand,
  stage: DecisionEventInput['stage'],
  status: DecisionEventInput['status'],
  createdAt: string,
  summary: Record<string, unknown> = {}
): DecisionEventInput | null {
  const decisionId = stringField(command as EaRecord, 'decision_id');
  if (decisionId.length === 0) {
    return null;
  }
  const symbol = typeof command.symbol === 'string' && command.symbol.length > 0 ? command.symbol : 'XAUUSD';
  return {
    decision_id: decisionId,
    account_id: command.account_id,
    symbol,
    stage,
    status,
    reason_codes: commandDecisionReasonCodes(command),
    summary: {
      command_id: command.command_id,
      action: command.action,
      ...summary
    },
    related_command_id: command.command_id,
    created_at: createdAt
  };
}

export function commandDecisionReasonCodes(command: StoredCommand): string[] {
  const codes = [`command.${command.action}`];
  if (isPollSourceVisible(command)) {
    codes.push(`source.${command.source}`);
  }
  return codes;
}

export function candidateSignalDecisionEvent(signal: EaRecord): DecisionEventInput | null {
  const signalId = numericField(signal, 'id');
  if (signalId <= 0) {
    return null;
  }
  const account = accountId(signal);
  const symbol = symbolOrDefault(signal);
  const strategy = stringField(signal, 'strategy');
  const createdAt = stringField(signal, 'created_at') || currentTimestamp();
  const expiresAt = stringField(signal, 'expires_at');
  return {
    decision_id: `candidate_${account}_${symbol}_${signalId}`,
    account_id: account,
    symbol,
    stage: 'candidate_signal',
    status: 'pending',
    reason_codes: strategy.length > 0 ? [`candidate.${strategy}`] : ['candidate.'],
    summary: {
      signal_id: signalId,
      side: stringField(signal, 'side'),
      score: numericField(signal, 'score'),
      strategy,
      expires_at: expiresAt
    },
    related_command_id: '',
    created_at: createdAt
  };
}

export function filterDecisionEvents(events: DecisionEvent[], filter: DecisionEventFilter): DecisionEvent[] {
  const limit = normalizeDecisionLimit(filter.limit);
  return events
    .filter((event) => {
      if (event.account_id !== filter.account_id) {
        return false;
      }
      if (filter.symbol != null && filter.symbol.length > 0 && event.symbol !== filter.symbol) {
        return false;
      }
      if (filter.status != null && filter.status.length > 0 && event.status !== filter.status) {
        return false;
      }
      return true;
    })
    .sort(compareDecisionEventsNewestFirst)
    .slice(0, limit);
}

export function compareDecisionEventsNewestFirst(left: DecisionEvent, right: DecisionEvent): number {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id - left.id : created;
}

export function normalizeDecisionLimit(limit: number | undefined): number {
  return limit == null || limit <= 0 || limit > 200 ? 50 : limit;
}

export function pendingSignalsNewestFirst(signals: EaRecord[]): EaRecord[] {
  return signals
    .filter((signal) => stringField(signal, 'status') === 'pending')
    .sort((left, right) => stringField(right, 'created_at').localeCompare(stringField(left, 'created_at')))
    .map(cloneRecord);
}

export function normalizePendingSignal(payload: EaRecord): EaRecord {
  const out = cloneRecord(payload);
  if (stringField(out, 'status').length === 0) {
    out.status = 'pending';
  }
  return out;
}

export function normalizePositionState(state: PositionStateRecord): PositionStateRecord {
  const now = currentTimestamp();
  return {
    ticket: state.ticket,
    tp1_hit: state.tp1_hit === true,
    tp2_hit: state.tp2_hit === true,
    max_profit_atr: Number.isFinite(state.max_profit_atr) ? state.max_profit_atr : 0,
    be_moved: state.be_moved === true,
    be_trigger_atr: Number.isFinite(state.be_trigger_atr) ? state.be_trigger_atr : BE_TRIGGER_ATR_DEFAULT,
    best_sl: Number.isFinite(state.best_sl) ? state.best_sl : 0,
    open_time: state.open_time.length > 0 ? state.open_time : now,
    last_modify_time: state.last_modify_time.length > 0 ? state.last_modify_time : now,
    add_on_count: Number.isInteger(state.add_on_count) ? state.add_on_count : 0,
    last_add_on_time: typeof state.last_add_on_time === 'string' ? state.last_add_on_time : '',
    last_add_on_price: Number.isFinite(state.last_add_on_price) ? state.last_add_on_price : 0,
    group_id: typeof state.group_id === 'string' ? state.group_id : '',
    group_avg_entry: Number.isFinite(state.group_avg_entry) ? state.group_avg_entry : 0,
    group_best_sl: Number.isFinite(state.group_best_sl) ? state.group_best_sl : 0,
    trailing_closed: state.trailing_closed === true
  };
}

export function positionStateFromRow(row: PositionStateRow): PositionStateRecord {
  return {
    ticket: Number(row.ticket),
    tp1_hit: row.tp1_hit !== 0,
    tp2_hit: row.tp2_hit !== 0,
    max_profit_atr: Number(row.max_profit_atr),
    be_moved: row.be_moved !== 0,
    be_trigger_atr: Number(row.be_trigger_atr),
    best_sl: Number(row.best_sl),
    open_time: row.open_time,
    last_modify_time: row.last_modify_time,
    add_on_count: Number(row.add_on_count) || 0,
    last_add_on_time: typeof row.last_add_on_time === 'string' ? row.last_add_on_time : '',
    last_add_on_price: Number(row.last_add_on_price) || 0,
    group_id: typeof row.group_id === 'string' ? row.group_id : '',
    group_avg_entry: Number(row.group_avg_entry) || 0,
    group_best_sl: Number(row.group_best_sl) || 0,
    trailing_closed: row.trailing_closed !== 0
  };
}

export function normalizeApiToken(payload: StoredApiTokenInput): StoredApiToken {
  return {
    token: payload.token,
    name: payload.name,
    accounts: [...payload.accounts],
    is_admin: payload.is_admin,
    created_at: payload.created_at ?? currentTimestamp()
  };
}

export function updatePendingSignalPayload(signal: EaRecord, result: string, reason: string): void {
  signal.status = result === 'rejected' ? 'rejected' : 'approved';
  signal.arbitration_result = result;
  signal.arbitration_reason = reason;
}

export function currentTimestamp(): string {
  return new Date().toISOString();
}

export function stringField(payload: EaRecord, field: string): string {
  const value = payload[field];
  return typeof value === 'string' ? value : '';
}

export function numericField(payload: EaRecord, field: string): number {
  const value = payload[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function appendUnique(out: string[], value: string): void {
  if (value.length > 0 && !out.includes(value)) {
    out.push(value);
  }
}

export function stringArrayField(payload: EaRecord | undefined, field: string): string[] {
  const value = payload?.[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export function isPendingSignalExpired(signal: EaRecord, nowIso: string): boolean {
  const expiresAt = stringField(signal, 'expires_at');
  const expiresMs = timestampMillis(expiresAt);
  const nowMs = timestampMillis(nowIso);
  if (expiresMs != null && nowMs != null) {
    return expiresMs < nowMs;
  }
  return expiresAt < nowIso;
}

export function timestampMillis(value: string): number | null {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export function cloneRecord<T extends EaRecord>(value: T): T {
  return structuredClone(value);
}

export function cloneCommand(value: EaCommand): EaCommand {
  return cloneRecord(value);
}

export function createStoredCommand(accountId: string, candidate: CommandCandidate | EaCommand, status: CommandStatus): StoredCommand {
  const source = normalizeCommandSource(candidate.source);
  const commandId = typeof candidate.command_id === 'string' && candidate.command_id.length > 0 ? candidate.command_id : `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stored = {
    ...cloneRecord(candidate as EaRecord),
    account_id: accountId,
    command_id: commandId,
    action: String(candidate.action),
    source,
    status,
    created_at: currentTimestamp()
  } as StoredCommand;
  setPollSourceVisible(stored, Object.prototype.hasOwnProperty.call(candidate, 'source'));
  return stored;
}

export function normalizeCommandSource(value: unknown): CommandSource {
  return typeof value === 'string' && isCommandSource(value) ? value : 'ea_analysis';
}

export function isAckResult(result: string): boolean {
  return result === 'OK';
}

export function toEaCommand(command: StoredCommand): EaCommand {
  const out = cloneRecord(command as EaRecord) as EaCommand;
  delete (out as EaRecord).account_id;
  delete (out as EaRecord).status;
  if (!isPollSourceVisible(command)) {
    delete (out as EaRecord).source;
  }
  delete (out as EaRecord).created_at;
  delete (out as EaRecord).delivered_at;
  delete (out as EaRecord).acked_at;
  delete (out as EaRecord).failed_at;
  delete (out as EaRecord).error_text;
  delete (out as EaRecord).result;
  if (out.ticket === undefined) {
    delete (out as EaRecord).ticket;
  }
  return out;
}

export function setPollSourceVisible(command: StoredCommand, visible: boolean): void {
  Object.defineProperty(command, '__poll_source_visible', {
    value: visible,
    enumerable: false,
    configurable: true
  });
}

export function isPollSourceVisible(command: StoredCommand): boolean {
  return (command as EaRecord).__poll_source_visible === true;
}

export function buildRuntimeCommand(commandId: string, row: RuntimeCommandRow): StoredCommand {
  const payload = fromJson(row.payload_json) as EaRecord;
  const status = isCommandStatus(row.status) ? row.status : 'draft';
  const source = isCommandSource(row.source) ? row.source : 'ea_analysis';
  const command = {
    ...(payload as EaCommand),
    account_id: row.account_id,
    command_id: typeof payload.command_id === 'string' && payload.command_id.length > 0 ? payload.command_id : commandId,
    action: typeof payload.action === 'string' ? payload.action : '',
    source,
    status,
    created_at: row.created_at,
    delivered_at: row.delivered_at.length > 0 ? row.delivered_at : undefined,
    acked_at: row.acked_at.length > 0 ? row.acked_at : undefined,
    failed_at: row.failed_at.length > 0 ? row.failed_at : undefined,
    result: row.result.length > 0 ? row.result : undefined,
    ticket: typeof row.ticket === 'number' ? row.ticket : undefined,
    error_text: row.error_text
  };
  setPollSourceVisible(command, Object.prototype.hasOwnProperty.call(payload, 'source'));
  return command;
}

export function runtimeCommandFromRow(commandId: string, row: RuntimeCommandRow): StoredCommand {
  return buildRuntimeCommand(commandId, row);
}

export function runtimeCommandFromListRow(row: RuntimeCommandListRow): StoredCommand {
  return buildRuntimeCommand(row.command_id, row);
}

export function isActiveAIApprovePendingCommand(command: StoredCommand, accountId: string, symbol: string, side: string, nowIso: string): boolean {
  if (command.account_id !== accountId || command.status !== 'queued' || command.source !== 'ai_approve') {
    return false;
  }
  if (!equalsFold(stringField(command as EaRecord, 'symbol'), symbol)) {
    return false;
  }
  if (!equalsFold(stringField(command as EaRecord, 'type'), side)) {
    return false;
  }
  if (isRuntimeCommandExpired(command, nowIso)) {
    return false;
  }
  return true;
}

export function isRuntimeCommandExpired(command: StoredCommand, nowIso: string): boolean {
  const now = unixSeconds(nowIso);
  const expiration = (command as EaRecord).expiration;
  if (typeof expiration === 'number' && Number.isFinite(expiration)) {
    return Math.trunc(expiration) <= now;
  }
  if (command.source === 'ai_approve') {
    const createdAt = timestampMillis(command.created_at);
    if (createdAt != null) {
      return Math.floor(createdAt / 1000) + 4 * 60 * 60 <= now;
    }
  }
  return false;
}

export function equalsFold(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

export function unixSeconds(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : Math.floor(Date.now() / 1000);
}

export function stringArrayFromJson(value: string): string[] {
  const parsed = fromJson(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function recordFromJson(value: string): Record<string, unknown> {
  const parsed = fromJson(value);
  return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export function decisionEventFromRow(row: DecisionEventRow): DecisionEvent {
  return {
    id: Number(row.id),
    decision_id: row.decision_id,
    account_id: row.account_id,
    symbol: row.symbol,
    stage: row.stage,
    status: row.status,
    reason_codes: stringArrayFromJson(row.reason_codes_json),
    summary: recordFromJson(row.summary_json),
    related_command_id: row.related_command_id,
    created_at: row.created_at
  };
}
