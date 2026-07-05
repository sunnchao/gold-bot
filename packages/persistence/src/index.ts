import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isCommandSource, isCommandStatus, isRuntimeMode, type CommandSource, type CommandStatus, type RuntimeMode } from '@gold-bot/shared-contracts';
import type { CommandCandidate, StoredCommand } from './commands.js';
import type { DecisionEvent, DecisionEventFilter, DecisionEventInput } from './decisions.js';
import type { RuntimeStateRecord } from './runtime-state.js';
import type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary, ShadowRuntimeSnapshot } from './shadow.js';
import type { StoredApiToken, StoredApiTokenInput } from './tokens.js';
import { runMigrations } from './migrate.js';
export type { CommandCandidate, StoredCommand } from './commands.js';
export type { DecisionEvent, DecisionEventFilter, DecisionEventInput, DecisionStage, DecisionStatus } from './decisions.js';
export type { RuntimeStateRecord } from './runtime-state.js';
export type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary, ShadowRuntimeSnapshot } from './shadow.js';
export type { StoredApiToken, StoredApiTokenInput } from './tokens.js';
export { runMigrations, loadMigrations, type Migration } from './migrate.js';

export const persistenceStatus = {
  writesLiveCommands: false
} as const;

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
  open_time: string;
  last_modify_time: string;
};

export type EaStore = {
  saveRegistration(payload: EaRecord): void;
  getRegistration(accountId: string): EaRecord | undefined;
  saveHeartbeat(payload: EaRecord): void;
  getHeartbeat(accountId: string): EaRecord | undefined;
  saveTick(payload: EaRecord): void;
  getLatestTick(accountId: string, symbol: string): EaRecord | undefined;
  saveBars(payload: EaRecord): void;
  getBars(accountId: string, symbol: string, timeframe: string): EaRecord[];
  savePositions(payload: EaRecord): void;
  getPositions(accountId: string, symbol?: string): EaRecord[];
  savePositionState(accountId: string, symbol: string, state: PositionStateRecord): void;
  loadPositionStates(accountId: string, symbol: string): PositionStateRecord[];
  deleteStalePositionStates(accountId: string, symbol: string, activeTickets: number[]): void;
  saveOrderResult(payload: EaRecord): void;
  getOrderResults(accountId: string): EaRecord[];
  enqueueCommand(accountId: string, command: EaCommand): void;
  saveCommandCandidate(accountId: string, candidate: CommandCandidate): StoredCommand;
  promoteCommand(commandId: string): void;
  demoteCommandToShadowOnly(commandId: string): void;
  getCommand(commandId: string): StoredCommand | undefined;
  listCommands(accountId: string): StoredCommand[];
  hasActiveAIApprovePending(accountId: string, symbol: string, side: string, nowIso: string): boolean;
  getRuntimeMode(accountId: string): RuntimeMode;
  setRuntimeMode(accountId: string, mode: RuntimeMode): void;
  reconcileCommandResult(accountId: string, commandId: string, result: string, ticket?: number, errorText?: string, createdAt?: string): boolean;
  pollCommands(accountId: string): EaCommand[];
  recordShadowComparison(payload: ShadowComparison): void;
  listShadowComparisons(filter?: ShadowComparisonFilter): ShadowComparison[];
  summarizeShadowComparisons(filter?: ShadowComparisonFilter): ShadowComparisonSummary;
  saveShadowSnapshot(payload: ShadowRuntimeSnapshot): void;
  getLatestShadowSnapshot(accountId: string, symbol: string, source: CommandSource): ShadowRuntimeSnapshot | undefined;
  recordDecisionEvent(payload: DecisionEventInput): void;
  listDecisionEvents(filter: DecisionEventFilter): DecisionEvent[];
  savePendingSignal(payload: EaRecord): void;
  getPendingSignals(accountId: string, symbol: string): EaRecord[];
  getPendingSignalById(accountId: string, symbol: string, id: number): EaRecord | undefined;
  updatePendingSignalArbitration(id: number, result: string, reason: string): boolean;
  expirePendingSignals(nowIso: string): number;
  saveAIResult(accountId: string, symbol: string, payload: EaRecord): void;
  getAIResults(accountId: string): EaRecord[];
  saveApiToken(payload: StoredApiTokenInput): void;
  listApiTokens(): StoredApiToken[];
  deleteApiToken(token: string): boolean;
  listAccountIds(): string[];
  listSymbols(accountId: string): string[];
  listAISymbols(accountId: string): string[];
  close?(): void;
};

type StoreState = {
  registrations: Map<string, EaRecord>;
  heartbeats: Map<string, EaRecord>;
  ticks: Map<string, EaRecord>;
  bars: Map<string, EaRecord[]>;
  positions: Map<string, EaRecord[]>;
  positionStates: Map<string, PositionStateRecord>;
  orderResults: Map<string, EaRecord[]>;
  runtimeModes: Map<string, RuntimeMode>;
  commands: Map<string, StoredCommand>;
  shadowComparisons: ShadowComparison[];
  shadowSnapshots: Map<string, ShadowRuntimeSnapshot>;
  decisionEvents: DecisionEvent[];
  pendingSignals: Map<string, EaRecord[]>;
  aiResults: Map<string, EaRecord>;
  apiTokens: Map<string, StoredApiToken>;
  nextCommandId: number;
  nextDecisionEventId: number;
  nextPendingSignalId: number;
};

export function createInMemoryEaStore(): EaStore {
  const state: StoreState = {
    registrations: new Map(),
    heartbeats: new Map(),
    ticks: new Map(),
    bars: new Map(),
    positions: new Map(),
    positionStates: new Map(),
    orderResults: new Map(),
    runtimeModes: new Map(),
    commands: new Map(),
    shadowComparisons: [],
    shadowSnapshots: new Map(),
    decisionEvents: [],
    pendingSignals: new Map(),
    aiResults: new Map(),
    apiTokens: new Map(),
    nextCommandId: 1,
    nextDecisionEventId: 1,
    nextPendingSignalId: 1
  };

  return {
    saveRegistration(payload) {
      state.registrations.set(accountId(payload), cloneRecord(payload));
    },
    getRegistration(accountId) {
      return cloneOptionalRecord(state.registrations.get(accountId));
    },
    saveHeartbeat(payload) {
      state.heartbeats.set(accountId(payload), cloneRecord(payload));
    },
    getHeartbeat(accountId) {
      return cloneOptionalRecord(state.heartbeats.get(accountId));
    },
    saveTick(payload) {
      state.ticks.set(symbolKey(accountId(payload), symbolOrDefault(payload)), cloneRecord(payload));
    },
    getLatestTick(accountId, symbol) {
      return cloneOptionalRecord(state.ticks.get(symbolKey(accountId, symbol)));
    },
    saveBars(payload) {
      const bars = Array.isArray(payload.bars) ? payload.bars : [];
      state.bars.set(barKey(accountId(payload), symbolOrDefault(payload), stringField(payload, 'timeframe')), cloneArray(bars));
    },
    getBars(accountId, symbol, timeframe) {
      return cloneArray(state.bars.get(barKey(accountId, symbol, timeframe)) ?? []);
    },
    savePositions(payload) {
      const positions = Array.isArray(payload.positions) ? payload.positions : [];
      state.positions.set(symbolKey(accountId(payload), symbolOrDefault(payload)), cloneArray(positions));
    },
    getPositions(accountId, symbol) {
      if (symbol != null && symbol.length > 0) {
        return cloneArray(state.positions.get(symbolKey(accountId, symbol)) ?? []);
      }
      return Array.from(state.positions.entries())
        .filter(([key]) => key.startsWith(`${accountId}:`))
        .flatMap(([, positions]) => cloneArray(positions));
    },
    savePositionState(accountId, symbol, positionState) {
      state.positionStates.set(positionStateKey(accountId, symbol, positionState.ticket), normalizePositionState(positionState));
    },
    loadPositionStates(accountId, symbol) {
      return Array.from(state.positionStates.entries())
        .filter(([key]) => key.startsWith(`${accountId}:${symbol}:`))
        .map(([, positionState]) => structuredClone(positionState))
        .sort((left, right) => left.ticket - right.ticket);
    },
    deleteStalePositionStates(accountId, symbol, activeTickets) {
      const active = new Set(activeTickets);
      for (const key of state.positionStates.keys()) {
        const [stateAccount, stateSymbol, ticket] = key.split(':');
        if (stateAccount === accountId && stateSymbol === symbol && !active.has(Number(ticket))) {
          state.positionStates.delete(key);
        }
      }
    },
    saveOrderResult(payload) {
      const key = accountId(payload);
      const current = state.orderResults.get(key) ?? [];
      state.orderResults.set(key, [...current, cloneRecord(payload)]);
    },
    getOrderResults(accountId) {
      return cloneArray(state.orderResults.get(accountId) ?? []);
    },
    enqueueCommand(accountId, command) {
      const stored = createStoredCommand(accountId, cloneCommand(command), 'queued');
      state.commands.set(stored.command_id, stored);
      recordCommandDecisionInMemory(state, stored, 'command_enqueued', 'pending', stored.created_at);
    },
    saveCommandCandidate(accountId, candidate) {
      const commandId = typeof candidate.command_id === 'string' && candidate.command_id.length > 0
        ? candidate.command_id
        : `cmd_${state.nextCommandId++}`;
      const stored = createStoredCommand(accountId, {
        ...cloneRecord(candidate),
        command_id: commandId,
        action: String(candidate.action),
        source: candidate.source
      }, 'draft');
      state.commands.set(commandId, stored);
      return structuredClone(stored);
    },
    promoteCommand(commandId) {
      const command = state.commands.get(commandId);
      if (command != null) {
        const wasQueued = command.status === 'queued';
        command.status = 'queued';
        if (!wasQueued) {
          recordCommandDecisionInMemory(state, command, 'command_enqueued', 'pending', command.created_at);
        }
      }
    },
    demoteCommandToShadowOnly(commandId) {
      const command = state.commands.get(commandId);
      if (command != null) {
        command.status = 'shadow_only';
      }
    },
    getCommand(commandId) {
      return cloneStoredCommand(state.commands.get(commandId));
    },
    listCommands(accountId) {
      return Array.from(state.commands.values())
        .filter((command) => command.account_id === accountId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map(cloneStoredCommand)
        .filter((command): command is StoredCommand => command != null);
    },
    hasActiveAIApprovePending(accountId, symbol, side, nowIso) {
      return Array.from(state.commands.values()).some((command) => isActiveAIApprovePendingCommand(command, accountId, symbol, side, nowIso));
    },
    getRuntimeMode(accountId) {
      return state.runtimeModes.get(accountId) ?? 'oracle';
    },
    setRuntimeMode(accountId, mode) {
      state.runtimeModes.set(accountId, mode);
    },
    reconcileCommandResult(accountId, commandId, result, ticket, errorText = '', createdAt = currentTimestamp()) {
      const command = state.commands.get(commandId);
      if (command == null || command.account_id !== accountId || command.status !== 'delivered') {
        return false;
      }
      const normalizedTicket = ticket ?? 0;
      const status = isAckResult(result) ? 'acked' : 'failed';
      command.result = result;
      command.ticket = normalizedTicket;
      command.error_text = errorText;
      command.status = status;
      if (status === 'acked') {
        command.acked_at = createdAt;
      } else {
        command.failed_at = createdAt;
      }
      this.saveOrderResult({
        account_id: accountId,
        command_id: commandId,
        result,
        ticket: normalizedTicket,
        error_text: errorText,
        created_at: createdAt
      });
      const event = commandResultDecisionEvent(command, result, normalizedTicket, errorText, createdAt);
      if (event != null) {
        state.decisionEvents.push(normalizeDecisionEvent(event, state.nextDecisionEventId++));
      }
      return true;
    },
    pollCommands(accountId) {
      const pending = Array.from(state.commands.values()).filter((command) => command.account_id === accountId && command.status === 'queued');
      const deliveredAt = currentTimestamp();
      for (const command of pending) {
        command.status = 'delivered';
        command.delivered_at = deliveredAt;
        recordCommandDecisionInMemory(state, command, 'command_delivered', 'delivered', deliveredAt);
      }
      return pending.map(toEaCommand);
    },
    recordShadowComparison(payload) {
      state.shadowComparisons.push(structuredClone(payload));
    },
    listShadowComparisons(filter) {
      return structuredClone(filterShadowComparisons(state.shadowComparisons, filter));
    },
    summarizeShadowComparisons(filter) {
      return summarizeShadowComparisons(filterShadowComparisons(state.shadowComparisons, filter));
    },
    saveShadowSnapshot(payload) {
      state.shadowSnapshots.set(shadowSnapshotKey(payload.account_id, payload.symbol, payload.source), structuredClone(payload));
    },
    getLatestShadowSnapshot(accountId, symbol, source) {
      const snapshot = state.shadowSnapshots.get(shadowSnapshotKey(accountId, symbol, source));
      return snapshot == null ? undefined : structuredClone(snapshot);
    },
    recordDecisionEvent(payload) {
      state.decisionEvents.push(normalizeDecisionEvent(payload, state.nextDecisionEventId++));
    },
    listDecisionEvents(filter) {
      return structuredClone(filterDecisionEvents(state.decisionEvents, filter));
    },
    savePendingSignal(payload) {
      const key = symbolKey(accountId(payload), symbolOrDefault(payload));
      const signal = normalizePendingSignal(payload);
      const explicitId = numericField(signal, 'id');
      if (explicitId > 0) {
        if (replacePendingSignalInMemory(state.pendingSignals, signal)) {
          state.nextPendingSignalId = Math.max(state.nextPendingSignalId, explicitId + 1);
        }
        return;
      }
      signal.id = state.nextPendingSignalId++;
      const current = state.pendingSignals.get(key) ?? [];
      state.pendingSignals.set(key, [...current, signal]);
      const event = candidateSignalDecisionEvent(signal);
      if (event != null) {
        state.decisionEvents.push(normalizeDecisionEvent(event, state.nextDecisionEventId++));
      }
    },
    getPendingSignals(accountId, symbol) {
      return pendingSignalsNewestFirst(state.pendingSignals.get(symbolKey(accountId, symbol)) ?? []);
    },
    getPendingSignalById(accountId, symbol, id) {
      const entries = state.pendingSignals.get(symbolKey(accountId, symbol)) ?? [];
      const found = entries.find((entry) => numericField(entry, 'id') === id);
      return found == null ? undefined : structuredClone(found);
    },
    updatePendingSignalArbitration(id, result, reason) {
      return updatePendingSignalInMemory(state.pendingSignals, id, result, reason);
    },
    expirePendingSignals(nowIso) {
      return expirePendingSignalsInMemory(state.pendingSignals, nowIso);
    },
    saveAIResult(accountId, symbol, payload) {
      state.aiResults.set(symbolKey(accountId, symbol), { account_id: accountId, symbol, ...cloneRecord(payload) });
    },
    getAIResults(accountId) {
      return Array.from(state.aiResults.entries())
        .filter(([key]) => key.startsWith(`${accountId}:`))
        .map(([, result]) => cloneRecord(result));
    },
    saveApiToken(payload) {
      const token = normalizeApiToken(payload);
      state.apiTokens.set(token.token, token);
    },
    listApiTokens() {
      return Array.from(state.apiTokens.values()).map((token) => structuredClone(token));
    },
    deleteApiToken(token) {
      return state.apiTokens.delete(token);
    },
    listAccountIds() {
      const out: string[] = [];
      for (const key of [
        ...state.registrations.keys(),
        ...state.heartbeats.keys(),
        ...Array.from(state.ticks.keys(), accountFromCompoundKey),
        ...Array.from(state.bars.keys(), accountFromCompoundKey),
        ...Array.from(state.positions.keys(), accountFromCompoundKey),
        ...state.orderResults.keys(),
        ...state.decisionEvents.map((event) => event.account_id),
        ...Array.from(state.pendingSignals.keys(), accountFromCompoundKey),
        ...Array.from(state.aiResults.keys(), accountFromCompoundKey)
      ]) {
        appendUnique(out, key);
      }
      return out;
    },
    listSymbols(accountId) {
      const out: string[] = [];
      for (const key of state.ticks.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      for (const key of state.bars.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      for (const key of state.positions.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      return out;
    },
    listAISymbols(accountId) {
      const registrationSymbols = stringArrayField(state.registrations.get(accountId), 'ai_symbols');
      if (registrationSymbols.length > 0) {
        return registrationSymbols;
      }
      const heartbeatSymbols = stringArrayField(state.heartbeats.get(accountId), 'ai_symbols');
      if (heartbeatSymbols.length > 0) {
        return heartbeatSymbols;
      }
      const fallback = this.listSymbols(accountId).sort();
      return fallback;
    }
  };
}

export function createSqliteEaStore(path: string): EaStore {
  const db = new DatabaseSync(path);

  // Run migrations first
  runMigrations(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ea_snapshots (
      kind TEXT NOT NULL,
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT '',
      timeframe TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (kind, account_id, symbol, timeframe)
    );
    CREATE TABLE IF NOT EXISTS ea_events (
      kind TEXT NOT NULL,
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS runtime_state (
      account_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      cutover_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS runtime_commands (
      command_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      ticket INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT NOT NULL DEFAULT '',
      acked_at TEXT NOT NULL DEFAULT '',
      failed_at TEXT NOT NULL DEFAULT '',
      error_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS position_states (
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      ticket INTEGER NOT NULL,
      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      max_profit_atr REAL NOT NULL DEFAULT 0,
      be_moved INTEGER NOT NULL DEFAULT 0,
      be_trigger_atr REAL NOT NULL DEFAULT 1.0,
      open_time TEXT NOT NULL DEFAULT '',
      last_modify_time TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (account_id, symbol, ticket)
    );
    CREATE INDEX IF NOT EXISTS idx_ea_events_kind_account_delivered
      ON ea_events(kind, account_id, delivered, created_at);
    CREATE INDEX IF NOT EXISTS idx_runtime_commands_account_status_created
      ON runtime_commands(account_id, status, created_at);
    CREATE TABLE IF NOT EXISTS shadow_comparisons (
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      protocol_ok INTEGER NOT NULL,
      signal_drift INTEGER NOT NULL,
      command_drift INTEGER NOT NULL,
      oracle_compared INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_comparisons_created
      ON shadow_comparisons(created_at);
    CREATE TABLE IF NOT EXISTS shadow_snapshots (
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, symbol, source)
    );
    CREATE TABLE IF NOT EXISTS decision_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '{}',
      related_command_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_events_account_symbol_created
      ON decision_events(account_id, symbol, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_decision_events_account_status_created
      ON decision_events(account_id, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS token_accounts (
      token TEXT NOT NULL,
      account_id TEXT NOT NULL,
      PRIMARY KEY (token, account_id)
    );
  `);
  ensureSqliteColumn(db, 'runtime_commands', 'acked_at', "acked_at TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'runtime_commands', 'failed_at', "failed_at TEXT NOT NULL DEFAULT ''");
  ensureSqliteColumn(db, 'runtime_commands', 'error_text', "error_text TEXT NOT NULL DEFAULT ''");

  const saveSnapshot = db.prepare(`
    INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kind, account_id, symbol, timeframe)
    DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
  `);
  const getSnapshot = db.prepare(`
    SELECT payload_json FROM ea_snapshots
    WHERE kind = ? AND account_id = ? AND symbol = ? AND timeframe = ?
  `);
  const selectSnapshotsByKindAccount = db.prepare(`
    SELECT payload_json FROM ea_snapshots
    WHERE kind = ? AND account_id = ?
    ORDER BY rowid ASC
  `);
  const insertEvent = db.prepare(`
    INSERT INTO ea_events (kind, account_id, symbol, payload_json, delivered)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectEvents = db.prepare(`
    SELECT rowid AS row_id, payload_json FROM ea_events
    WHERE kind = ? AND account_id = ? AND delivered = ?
    ORDER BY rowid ASC
  `);
  const selectEventsAnyDelivery = db.prepare(`
    SELECT payload_json FROM ea_events
    WHERE kind = ? AND account_id = ?
    ORDER BY rowid ASC
  `);
  const selectEventsBySymbol = db.prepare(`
    SELECT payload_json FROM ea_events
    WHERE kind = ? AND account_id = ? AND symbol = ?
    ORDER BY rowid ASC
  `);
  const markDelivered = db.prepare(`UPDATE ea_events SET delivered = 1 WHERE rowid = ?`);
  const upsertPositionState = db.prepare(`
    INSERT INTO position_states (
      account_id,
      symbol,
      ticket,
      tp1_hit,
      tp2_hit,
      max_profit_atr,
      be_moved,
      be_trigger_atr,
      open_time,
      last_modify_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, symbol, ticket)
    DO UPDATE SET
      tp1_hit = excluded.tp1_hit,
      tp2_hit = excluded.tp2_hit,
      max_profit_atr = excluded.max_profit_atr,
      be_moved = excluded.be_moved,
      be_trigger_atr = excluded.be_trigger_atr,
      open_time = excluded.open_time,
      last_modify_time = excluded.last_modify_time
  `);
  const selectPositionStates = db.prepare(`
    SELECT ticket, tp1_hit, tp2_hit, max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
    FROM position_states
    WHERE account_id = ? AND symbol = ?
    ORDER BY ticket ASC
  `);
  const deletePositionStatesForSymbol = db.prepare(`
    DELETE FROM position_states
    WHERE account_id = ? AND symbol = ?
  `);
  const selectSnapshotAccounts = db.prepare(`SELECT DISTINCT account_id FROM ea_snapshots ORDER BY account_id ASC`);
  const selectEventAccounts = db.prepare(`SELECT DISTINCT account_id FROM ea_events ORDER BY account_id ASC`);
  const selectSnapshotSymbols = db.prepare(`
    SELECT DISTINCT symbol FROM ea_snapshots
    WHERE account_id = ? AND symbol <> '' AND kind IN ('tick', 'bars', 'positions')
    ORDER BY rowid ASC
  `);
  const upsertRuntimeState = db.prepare(`
    INSERT INTO runtime_state (account_id, mode, cutover_enabled, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id)
    DO UPDATE SET mode = excluded.mode, cutover_enabled = excluded.cutover_enabled, updated_at = CURRENT_TIMESTAMP
  `);
  const selectRuntimeState = db.prepare(`
    SELECT mode, cutover_enabled, updated_at FROM runtime_state
    WHERE account_id = ?
  `);
  const insertRuntimeCommand = db.prepare(`
    INSERT INTO runtime_commands (
      command_id, account_id, status, source, symbol, payload_json, result, ticket, created_at, delivered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', CURRENT_TIMESTAMP)
  `);
  const updateRuntimeCommandStatus = db.prepare(`
    UPDATE runtime_commands
    SET status = ?, delivered_at = CASE WHEN ? <> '' THEN ? ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP
    WHERE command_id = ?
  `);
  const ackRuntimeCommandResult = db.prepare(`
    UPDATE runtime_commands
    SET status = 'acked', result = ?, ticket = ?, error_text = ?, acked_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE command_id = ? AND account_id = ? AND status = 'delivered'
  `);
  const failRuntimeCommandResult = db.prepare(`
    UPDATE runtime_commands
    SET status = 'failed', result = ?, ticket = ?, error_text = ?, failed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE command_id = ? AND account_id = ? AND status = 'delivered'
  `);
  const selectRuntimeCommand = db.prepare(`
    SELECT account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text
    FROM runtime_commands
    WHERE command_id = ?
  `);
  const selectRuntimeCommandsByAccount = db.prepare(`
    SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text
    FROM runtime_commands
    WHERE account_id = ?
    ORDER BY created_at ASC, command_id ASC
  `);
  const selectQueuedRuntimeCommands = db.prepare(`
    SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text
    FROM runtime_commands
    WHERE account_id = ? AND status = 'queued'
    ORDER BY created_at ASC, command_id ASC
  `);
  const insertShadowComparison = db.prepare(`
    INSERT INTO shadow_comparisons (account_id, symbol, protocol_ok, signal_drift, command_drift, oracle_compared, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectShadowComparisons = db.prepare(`
    SELECT account_id, symbol, protocol_ok, signal_drift, command_drift, oracle_compared, source, created_at
    FROM shadow_comparisons
    ORDER BY created_at ASC
  `);
  const upsertShadowSnapshot = db.prepare(`
    INSERT INTO shadow_snapshots (account_id, symbol, source, payload_json, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id, symbol, source)
    DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
  `);
  const selectShadowSnapshot = db.prepare(`
    SELECT payload_json FROM shadow_snapshots
    WHERE account_id = ? AND symbol = ? AND source = ?
  `);
  const insertDecisionEvent = db.prepare(`
    INSERT INTO decision_events (
      decision_id,
      account_id,
      symbol,
      stage,
      status,
      reason_codes_json,
      summary_json,
      related_command_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertApiToken = db.prepare(`
    INSERT INTO tokens (token, name, is_admin, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(token)
    DO UPDATE SET name = excluded.name, is_admin = excluded.is_admin
  `);
  const deleteApiTokenAccounts = db.prepare(`DELETE FROM token_accounts WHERE token = ?`);
  const insertApiTokenAccount = db.prepare(`
    INSERT INTO token_accounts (token, account_id)
    VALUES (?, ?)
    ON CONFLICT(token, account_id) DO NOTHING
  `);
  const selectApiTokens = db.prepare(`
    SELECT token, name, is_admin, created_at
    FROM tokens
    ORDER BY created_at ASC, token ASC
  `);
  const selectApiTokenAccounts = db.prepare(`
    SELECT account_id FROM token_accounts
    WHERE token = ?
    ORDER BY account_id ASC
  `);
  const deleteApiToken = db.prepare(`DELETE FROM tokens WHERE token = ?`);

  return {
    saveRegistration(payload) {
      saveSnapshot.run('registration', accountId(payload), '', '', toJson(payload));
    },
    getRegistration(accountId) {
      return snapshotRecord(getSnapshot, 'registration', accountId, '', '');
    },
    saveHeartbeat(payload) {
      saveSnapshot.run('heartbeat', accountId(payload), '', '', toJson(payload));
    },
    getHeartbeat(accountId) {
      return snapshotRecord(getSnapshot, 'heartbeat', accountId, '', '');
    },
    saveTick(payload) {
      saveSnapshot.run('tick', accountId(payload), symbolOrDefault(payload), '', toJson(payload));
    },
    getLatestTick(accountId, symbol) {
      return snapshotRecord(getSnapshot, 'tick', accountId, symbol, '');
    },
    saveBars(payload) {
      saveSnapshot.run('bars', accountId(payload), symbolOrDefault(payload), stringField(payload, 'timeframe'), toJson(payload));
    },
    getBars(accountId, symbol, timeframe) {
      return (snapshotRecord(getSnapshot, 'bars', accountId, symbol, timeframe)?.bars as EaRecord[] | undefined) ?? [];
    },
    savePositions(payload) {
      saveSnapshot.run('positions', accountId(payload), symbolOrDefault(payload), '', toJson(payload));
    },
    getPositions(accountId, symbol) {
      if (symbol != null && symbol.length > 0) {
        return (snapshotRecord(getSnapshot, 'positions', accountId, symbol, '')?.positions as EaRecord[] | undefined) ?? [];
      }
      const rows = snapshotRows(db, 'positions', accountId);
      return rows.flatMap((row) => (Array.isArray(row.positions) ? (row.positions as EaRecord[]) : []));
    },
    savePositionState(accountId, symbol, state) {
      const normalized = normalizePositionState(state);
      upsertPositionState.run(
        accountId,
        symbol,
        normalized.ticket,
        normalized.tp1_hit ? 1 : 0,
        normalized.tp2_hit ? 1 : 0,
        normalized.max_profit_atr,
        normalized.be_moved ? 1 : 0,
        normalized.be_trigger_atr,
        normalized.open_time,
        normalized.last_modify_time
      );
    },
    loadPositionStates(accountId, symbol) {
      return (selectPositionStates.all(accountId, symbol) as PositionStateRow[]).map(positionStateFromRow);
    },
    deleteStalePositionStates(accountId, symbol, activeTickets) {
      if (activeTickets.length === 0) {
        deletePositionStatesForSymbol.run(accountId, symbol);
        return;
      }
      const placeholders = activeTickets.map(() => '?').join(', ');
      db.prepare(`
        DELETE FROM position_states
        WHERE account_id = ? AND symbol = ? AND ticket NOT IN (${placeholders})
      `).run(accountId, symbol, ...activeTickets);
    },
    saveOrderResult(payload) {
      insertEvent.run('order_result', accountId(payload), '', toJson(payload), 1);
    },
    getOrderResults(accountId) {
      return eventPayloads(selectEventsAnyDelivery, 'order_result', accountId);
    },
    enqueueCommand(accountId, command) {
      const stored = createStoredCommand(accountId, cloneCommand(command), 'queued');
      insertRuntimeCommand.run(
        stored.command_id,
        accountId,
        'queued',
        stored.source,
        symbolOrDefault(stored),
        toJson(toEaCommand(stored)),
        '',
        null,
        stored.created_at
      );
      recordCommandDecisionInSqlite(insertDecisionEvent, stored, 'command_enqueued', 'pending', stored.created_at);
    },
    saveCommandCandidate(accountId, candidate) {
      const commandId = typeof candidate.command_id === 'string' && candidate.command_id.length > 0 ? candidate.command_id : `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const stored = createStoredCommand(accountId, {
        ...cloneRecord(candidate),
        command_id: commandId,
        action: String(candidate.action),
        source: candidate.source
      }, 'draft');
      insertRuntimeCommand.run(
        stored.command_id,
        stored.account_id,
        stored.status,
        stored.source,
        symbolOrDefault(stored),
        toJson(toEaCommand(stored)),
        '',
        null,
        stored.created_at
      );
      return stored;
    },
    promoteCommand(commandId) {
      const row = selectRuntimeCommand.get(commandId) as RuntimeCommandRow | undefined;
      const command = row == null ? undefined : runtimeCommandFromRow(commandId, row);
      updateRuntimeCommandStatus.run('queued', '', '', commandId);
      if (command != null && command.status !== 'queued') {
        recordCommandDecisionInSqlite(insertDecisionEvent, command, 'command_enqueued', 'pending', command.created_at);
      }
    },
    demoteCommandToShadowOnly(commandId) {
      updateRuntimeCommandStatus.run('shadow_only', '', '', commandId);
    },
    getCommand(commandId) {
      const row = selectRuntimeCommand.get(commandId) as RuntimeCommandRow | undefined;
      return row == null ? undefined : runtimeCommandFromRow(commandId, row);
    },
    listCommands(accountId) {
      return (selectRuntimeCommandsByAccount.all(accountId) as RuntimeCommandListRow[]).map((row) => runtimeCommandFromListRow(row));
    },
    hasActiveAIApprovePending(accountId, symbol, side, nowIso) {
      return (selectQueuedRuntimeCommands.all(accountId) as RuntimeCommandListRow[])
        .map((row) => runtimeCommandFromListRow(row))
        .some((command) => isActiveAIApprovePendingCommand(command, accountId, symbol, side, nowIso));
    },
    getRuntimeMode(accountId) {
      const row = selectRuntimeState.get(accountId) as { mode?: string } | undefined;
      return row != null && typeof row.mode === 'string' && isRuntimeMode(row.mode) ? row.mode : 'oracle';
    },
    setRuntimeMode(accountId, mode) {
      upsertRuntimeState.run(accountId, mode, mode === 'cutover' ? 1 : 0);
    },
    reconcileCommandResult(accountId, commandId, result, ticket, errorText = '', createdAt = currentTimestamp()) {
      const normalizedTicket = ticket ?? 0;
      const update = isAckResult(result) ? ackRuntimeCommandResult : failRuntimeCommandResult;
      const updateResult = update.run(result, normalizedTicket, errorText, createdAt, commandId, accountId);
      if (updateResult.changes === 0) {
        return false;
      }
      insertEvent.run('order_result', accountId, '', toJson({
        account_id: accountId,
        command_id: commandId,
        result,
        ticket: normalizedTicket,
        error_text: errorText,
        created_at: createdAt
      }), 1);
      const row = selectRuntimeCommand.get(commandId) as RuntimeCommandRow | undefined;
      if (row != null) {
        const command = runtimeCommandFromRow(commandId, row);
        const event = commandResultDecisionEvent(command, result, normalizedTicket, errorText, createdAt);
        if (event != null) {
          insertDecisionEvent.run(
            event.decision_id,
            event.account_id,
            event.symbol,
            event.stage,
            event.status,
            toJson(event.reason_codes),
            toJson(event.summary),
            event.related_command_id,
            event.created_at
          );
        }
      }
      return true;
    },
    pollCommands(accountId) {
      const rows = selectQueuedRuntimeCommands.all(accountId) as RuntimeCommandListRow[];
      const delivered: StoredCommand[] = [];
      const deliveredAt = currentTimestamp();
      for (const row of rows) {
        updateRuntimeCommandStatus.run('delivered', deliveredAt, deliveredAt, row.command_id);
        const command = runtimeCommandFromListRow({ ...row, status: 'delivered', delivered_at: deliveredAt });
        recordCommandDecisionInSqlite(insertDecisionEvent, command, 'command_delivered', 'delivered', deliveredAt);
        delivered.push(command);
      }
      return delivered.map(toEaCommand);
    },
    recordShadowComparison(payload) {
      insertShadowComparison.run(
        payload.account_id,
        payload.symbol,
        payload.protocol_ok ? 1 : 0,
        payload.signal_drift ? 1 : 0,
        payload.command_drift ? 1 : 0,
        payload.oracle_compared ? 1 : 0,
        payload.source,
        payload.created_at
      );
    },
    listShadowComparisons(filter) {
      const comparisons: ShadowComparison[] = (selectShadowComparisons.all() as Array<{
        account_id: string;
        symbol: string;
        protocol_ok: number;
        signal_drift: number;
        command_drift: number;
        oracle_compared: number;
        source: string;
        created_at: string;
      }>).map((row) => ({
        account_id: row.account_id,
        symbol: row.symbol,
        protocol_ok: row.protocol_ok === 1,
        signal_drift: row.signal_drift === 1,
        command_drift: row.command_drift === 1,
        oracle_compared: row.oracle_compared === 1,
        source: row.source === 'position_review' || row.source === 'ai_result' ? row.source : 'ea_analysis',
        created_at: row.created_at
      }));
      return filterShadowComparisons(comparisons, filter);
    },
    summarizeShadowComparisons(filter) {
      return summarizeShadowComparisons(this.listShadowComparisons(filter));
    },
    saveShadowSnapshot(payload) {
      upsertShadowSnapshot.run(payload.account_id, payload.symbol, payload.source, toJson(payload));
    },
    getLatestShadowSnapshot(accountId, symbol, source) {
      const row = selectShadowSnapshot.get(accountId, symbol, source) as { payload_json?: string } | undefined;
      return typeof row?.payload_json === 'string' ? (fromJson(row.payload_json) as ShadowRuntimeSnapshot) : undefined;
    },
    recordDecisionEvent(payload) {
      const event = normalizeDecisionEvent(payload, 0);
      insertDecisionEvent.run(
        event.decision_id,
        event.account_id,
        event.symbol,
        event.stage,
        event.status,
        toJson(event.reason_codes),
        toJson(event.summary),
        event.related_command_id,
        event.created_at
      );
    },
    listDecisionEvents(filter) {
      return selectDecisionEvents(db, filter);
    },
    savePendingSignal(payload) {
      const signal = normalizePendingSignal(payload);
      if (numericField(signal, 'id') > 0) {
        replacePendingSignalInSqlite(db, signal);
        return;
      }
      signal.id = nextPendingSignalIdInSqlite(db);
      insertEvent.run('pending_signal', accountId(payload), symbolOrDefault(payload), toJson(signal), 1);
      const event = candidateSignalDecisionEvent(signal);
      if (event != null) {
        insertDecisionEventRecord(insertDecisionEvent, event);
      }
    },
    getPendingSignals(accountId, symbol) {
      return pendingSignalsNewestFirst(eventPayloads(selectEventsBySymbol, 'pending_signal', accountId, symbol));
    },
    getPendingSignalById(accountId, symbol, id) {
      const payloads = eventPayloads(selectEventsBySymbol, 'pending_signal', accountId, symbol);
      const found = payloads.find((entry) => numericField(entry, 'id') === id);
      return found == null ? undefined : structuredClone(found);
    },
    updatePendingSignalArbitration(id, result, reason) {
      return updatePendingSignalInSqlite(db, id, result, reason);
    },
    expirePendingSignals(nowIso) {
      return expirePendingSignalsInSqlite(db, nowIso);
    },
    saveAIResult(accountId, symbol, payload) {
      saveSnapshot.run('ai_result', accountId, symbol, '', toJson({ account_id: accountId, symbol, ...payload }));
    },
    getAIResults(accountId) {
      return eventPayloads(selectSnapshotsByKindAccount, 'ai_result', accountId);
    },
    saveApiToken(payload) {
      const token = normalizeApiToken(payload);
      upsertApiToken.run(token.token, token.name, token.is_admin ? 1 : 0, token.created_at);
      deleteApiTokenAccounts.run(token.token);
      for (const account of token.accounts) {
        insertApiTokenAccount.run(token.token, account);
      }
    },
    listApiTokens() {
      return (selectApiTokens.all() as Array<{ token: string; name: string; is_admin: number; created_at: string }>).map((row) => ({
        token: row.token,
        name: row.name,
        accounts: (selectApiTokenAccounts.all(row.token) as Array<{ account_id: string }>).map((account) => account.account_id),
        is_admin: row.is_admin === 1,
        created_at: row.created_at
      }));
    },
    deleteApiToken(token) {
      deleteApiTokenAccounts.run(token);
      const result = deleteApiToken.run(token);
      return result.changes > 0;
    },
    listAccountIds() {
      const out: string[] = [];
      for (const row of selectSnapshotAccounts.all() as Array<{ account_id: string }>) {
        appendUnique(out, row.account_id);
      }
      for (const row of selectEventAccounts.all() as Array<{ account_id: string }>) {
        appendUnique(out, row.account_id);
      }
      return out;
    },
    listSymbols(accountId) {
      const out: string[] = [];
      for (const row of selectSnapshotSymbols.all(accountId) as Array<{ symbol: string }>) {
        appendUnique(out, row.symbol);
      }
      return out;
    },
    listAISymbols(accountId) {
      const registrationSymbols = stringArrayField(this.getRegistration(accountId), 'ai_symbols');
      if (registrationSymbols.length > 0) {
        return registrationSymbols;
      }
      const heartbeatSymbols = stringArrayField(this.getHeartbeat(accountId), 'ai_symbols');
      return heartbeatSymbols.length > 0 ? heartbeatSymbols : this.listSymbols(accountId).sort();
    },
    close() {
      db.close();
    }
  };
}

function accountId(payload: EaRecord): string {
  return stringField(payload, 'account_id');
}

function symbolOrDefault(payload: EaRecord): string {
  return typeof payload.symbol === 'string' && payload.symbol.length > 0 ? payload.symbol : 'XAUUSD';
}

function shadowSnapshotKey(accountId: string, symbol: string, source: CommandSource): string {
  return `${accountId}:${symbol}:${source}`;
}

function filterShadowComparisons(
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

function summarizeShadowComparisons(comparisons: ShadowComparison[]): ShadowComparisonSummary {
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

function normalizeDecisionEvent(payload: DecisionEventInput, id: number): DecisionEvent {
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

function commandResultDecisionEvent(
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

function commandDecisionEvent(
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

function recordCommandDecisionInMemory(
  state: StoreState,
  command: StoredCommand,
  stage: DecisionEventInput['stage'],
  status: DecisionEventInput['status'],
  createdAt: string
): void {
  const event = commandDecisionEvent(command, stage, status, createdAt);
  if (event != null) {
    state.decisionEvents.push(normalizeDecisionEvent(event, state.nextDecisionEventId++));
  }
}

function recordCommandDecisionInSqlite(
  statement: { run(...params: SQLInputValue[]): unknown },
  command: StoredCommand,
  stage: DecisionEventInput['stage'],
  status: DecisionEventInput['status'],
  createdAt: string
): void {
  const event = commandDecisionEvent(command, stage, status, createdAt);
  if (event != null) {
    insertDecisionEventRecord(statement, event);
  }
}

function insertDecisionEventRecord(statement: { run(...params: SQLInputValue[]): unknown }, event: DecisionEventInput): void {
  statement.run(
    event.decision_id,
    event.account_id,
    event.symbol,
    event.stage,
    event.status,
    toJson(event.reason_codes),
    toJson(event.summary),
    event.related_command_id,
    event.created_at
  );
}

function commandDecisionReasonCodes(command: StoredCommand): string[] {
  const codes = [`command.${command.action}`];
  if (isPollSourceVisible(command)) {
    codes.push(`source.${command.source}`);
  }
  return codes;
}

function candidateSignalDecisionEvent(signal: EaRecord): DecisionEventInput | null {
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

function filterDecisionEvents(events: DecisionEvent[], filter: DecisionEventFilter): DecisionEvent[] {
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

function compareDecisionEventsNewestFirst(left: DecisionEvent, right: DecisionEvent): number {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id - left.id : created;
}

function normalizeDecisionLimit(limit: number | undefined): number {
  return limit == null || limit <= 0 || limit > 200 ? 50 : limit;
}

function pendingSignalsNewestFirst(signals: EaRecord[]): EaRecord[] {
  return signals
    .filter((signal) => stringField(signal, 'status') === 'pending')
    .sort((left, right) => stringField(right, 'created_at').localeCompare(stringField(left, 'created_at')))
    .map(cloneRecord);
}

function normalizePendingSignal(payload: EaRecord): EaRecord {
  const out = cloneRecord(payload);
  if (stringField(out, 'status').length === 0) {
    out.status = 'pending';
  }
  return out;
}

function normalizePositionState(state: PositionStateRecord): PositionStateRecord {
  const now = currentTimestamp();
  return {
    ticket: state.ticket,
    tp1_hit: state.tp1_hit === true,
    tp2_hit: state.tp2_hit === true,
    max_profit_atr: Number.isFinite(state.max_profit_atr) ? state.max_profit_atr : 0,
    be_moved: state.be_moved === true,
    be_trigger_atr: Number.isFinite(state.be_trigger_atr) ? state.be_trigger_atr : 1.0,
    open_time: state.open_time.length > 0 ? state.open_time : now,
    last_modify_time: state.last_modify_time.length > 0 ? state.last_modify_time : now
  };
}

type PositionStateRow = {
  ticket: number;
  tp1_hit: number;
  tp2_hit: number;
  max_profit_atr: number;
  be_moved: number;
  be_trigger_atr: number;
  open_time: string;
  last_modify_time: string;
};

function positionStateFromRow(row: PositionStateRow): PositionStateRecord {
  return {
    ticket: Number(row.ticket),
    tp1_hit: row.tp1_hit !== 0,
    tp2_hit: row.tp2_hit !== 0,
    max_profit_atr: Number(row.max_profit_atr),
    be_moved: row.be_moved !== 0,
    be_trigger_atr: Number(row.be_trigger_atr),
    open_time: row.open_time,
    last_modify_time: row.last_modify_time
  };
}

function normalizeApiToken(payload: StoredApiTokenInput): StoredApiToken {
  return {
    token: payload.token,
    name: payload.name,
    accounts: [...payload.accounts],
    is_admin: payload.is_admin,
    created_at: payload.created_at ?? currentTimestamp()
  };
}

function replacePendingSignalInMemory(signals: Map<string, EaRecord[]>, signal: EaRecord): boolean {
  const id = numericField(signal, 'id');
  const nextKey = symbolKey(accountId(signal), symbolOrDefault(signal));
  for (const [currentKey, entries] of signals.entries()) {
    const index = entries.findIndex((entry) => numericField(entry, 'id') === id);
    if (index < 0) {
      continue;
    }
    if (currentKey === nextKey) {
      entries[index] = signal;
      return true;
    }
    const remaining = [...entries.slice(0, index), ...entries.slice(index + 1)];
    if (remaining.length > 0) {
      signals.set(currentKey, remaining);
    } else {
      signals.delete(currentKey);
    }
    signals.set(nextKey, [...(signals.get(nextKey) ?? []), signal]);
    return true;
  }
  return false;
}

function updatePendingSignalInMemory(signals: Map<string, EaRecord[]>, id: number, result: string, reason: string): boolean {
  for (const entries of signals.values()) {
    const signal = entries.find((entry) => numericField(entry, 'id') === id);
    if (signal != null) {
      updatePendingSignalPayload(signal, result, reason);
      return true;
    }
  }
  return false;
}

function expirePendingSignalsInMemory(signals: Map<string, EaRecord[]>, nowIso: string): number {
  let expired = 0;
  for (const entries of signals.values()) {
    for (const signal of entries) {
      if (stringField(signal, 'status') === 'pending' && isPendingSignalExpired(signal, nowIso)) {
        signal.status = 'timeout';
        signal.arbitration_result = 'timeout';
        signal.arbitration_reason = 'expired';
        expired += 1;
      }
    }
  }
  return expired;
}

function updatePendingSignalPayload(signal: EaRecord, result: string, reason: string): void {
  signal.status = result === 'rejected' ? 'rejected' : 'approved';
  signal.arbitration_result = result;
  signal.arbitration_reason = reason;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function stringField(payload: EaRecord, field: string): string {
  const value = payload[field];
  return typeof value === 'string' ? value : '';
}

function numericField(payload: EaRecord, field: string): number {
  const value = payload[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function symbolKey(accountId: string, symbol: string): string {
  return `${accountId}:${symbol}`;
}

function positionStateKey(accountId: string, symbol: string, ticket: number): string {
  return `${accountId}:${symbol}:${ticket}`;
}

function barKey(accountId: string, symbol: string, timeframe: string): string {
  return `${accountId}:${symbol}:${timeframe}`;
}

function accountFromCompoundKey(key: string): string {
  return key.split(':', 1)[0] ?? '';
}

function appendSymbolFromKey(out: string[], key: string, accountId: string): void {
  const parts = key.split(':');
  if (parts[0] === accountId && parts[1] != null) {
    appendUnique(out, parts[1]);
  }
}

function appendUnique(out: string[], value: string): void {
  if (value.length > 0 && !out.includes(value)) {
    out.push(value);
  }
}

function stringArrayField(payload: EaRecord | undefined, field: string): string[] {
  const value = payload?.[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function snapshotRecord(
  statement: { get(...params: unknown[]): unknown },
  kind: string,
  accountId: string,
  symbol: string,
  timeframe: string
): EaRecord | undefined {
  const row = statement.get(kind, accountId, symbol, timeframe) as { payload_json?: string } | undefined;
  return typeof row?.payload_json === 'string' ? (fromJson(row.payload_json) as EaRecord) : undefined;
}

function snapshotRows(db: DatabaseSync, kind: string, accountId: string): EaRecord[] {
  const statement = db.prepare(`
    SELECT payload_json FROM ea_snapshots
    WHERE kind = ? AND account_id = ?
    ORDER BY rowid ASC
  `);
  return (statement.all(kind, accountId) as Array<{ payload_json: string }>).map((row) => fromJson(row.payload_json) as EaRecord);
}

function ensureSqliteColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function eventPayloads(statement: { all(...params: unknown[]): unknown[] }, ...params: unknown[]): EaRecord[] {
  return (statement.all(...params) as Array<{ payload_json: string }>).map((row) => fromJson(row.payload_json) as EaRecord);
}

function nextPendingSignalIdInSqlite(db: DatabaseSync): number {
  const rows = db.prepare(`
    SELECT payload_json FROM ea_events
    WHERE kind = 'pending_signal'
    ORDER BY rowid ASC
  `).all() as Array<{ payload_json: string }>;
  const maxId = rows.reduce((max, row) => {
    const payload = fromJson(row.payload_json) as EaRecord;
    return Math.max(max, numericField(payload, 'id'));
  }, 0);
  return maxId + 1;
}

function replacePendingSignalInSqlite(db: DatabaseSync, signal: EaRecord): boolean {
  const id = numericField(signal, 'id');
  const select = db.prepare(`
    SELECT rowid AS row_id, payload_json FROM ea_events
    WHERE kind = 'pending_signal'
    ORDER BY rowid ASC
  `);
  const update = db.prepare(`
    UPDATE ea_events
    SET account_id = ?, symbol = ?, payload_json = ?
    WHERE rowid = ?
  `);
  for (const row of select.all() as Array<{ row_id: number; payload_json: string }>) {
    const payload = fromJson(row.payload_json) as EaRecord;
    if (numericField(payload, 'id') === id) {
      update.run(accountId(signal), symbolOrDefault(signal), toJson(signal), row.row_id);
      return true;
    }
  }
  return false;
}

function updatePendingSignalInSqlite(db: DatabaseSync, id: number, result: string, reason: string): boolean {
  const select = db.prepare(`
    SELECT rowid AS row_id, payload_json FROM ea_events
    WHERE kind = 'pending_signal'
    ORDER BY rowid ASC
  `);
  const update = db.prepare(`UPDATE ea_events SET payload_json = ? WHERE rowid = ?`);
  for (const row of select.all() as Array<{ row_id: number; payload_json: string }>) {
    const payload = fromJson(row.payload_json) as EaRecord;
    if (numericField(payload, 'id') === id) {
      updatePendingSignalPayload(payload, result, reason);
      update.run(toJson(payload), row.row_id);
      return true;
    }
  }
  return false;
}

function isPendingSignalExpired(signal: EaRecord, nowIso: string): boolean {
  const expiresAt = stringField(signal, 'expires_at');
  const expiresMs = timestampMillis(expiresAt);
  const nowMs = timestampMillis(nowIso);
  if (expiresMs != null && nowMs != null) {
    return expiresMs < nowMs;
  }
  return expiresAt < nowIso;
}

function timestampMillis(value: string): number | null {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

function expirePendingSignalsInSqlite(db: DatabaseSync, nowIso: string): number {
  const select = db.prepare(`
    SELECT rowid AS row_id, payload_json FROM ea_events
    WHERE kind = 'pending_signal'
    ORDER BY rowid ASC
  `);
  const update = db.prepare(`UPDATE ea_events SET payload_json = ? WHERE rowid = ?`);
  let expired = 0;
  for (const row of select.all() as Array<{ row_id: number; payload_json: string }>) {
    const payload = fromJson(row.payload_json) as EaRecord;
    if (stringField(payload, 'status') === 'pending' && isPendingSignalExpired(payload, nowIso)) {
      payload.status = 'timeout';
      payload.arbitration_result = 'timeout';
      payload.arbitration_reason = 'expired';
      update.run(toJson(payload), row.row_id);
      expired += 1;
    }
  }
  return expired;
}

function selectDecisionEvents(db: DatabaseSync, filter: DecisionEventFilter): DecisionEvent[] {
  const clauses = ['account_id = ?'];
  const params: SQLInputValue[] = [filter.account_id];
  if (filter.symbol != null && filter.symbol.length > 0) {
    clauses.push('symbol = ?');
    params.push(filter.symbol);
  }
  if (filter.status != null && filter.status.length > 0) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  params.push(normalizeDecisionLimit(filter.limit));
  const rows = db.prepare(`
    SELECT
      id,
      decision_id,
      account_id,
      symbol,
      stage,
      status,
      reason_codes_json,
      summary_json,
      related_command_id,
      created_at
    FROM decision_events
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params) as DecisionEventRow[];
  return rows.map(decisionEventFromRow);
}

type DecisionEventRow = {
  id: number;
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

function decisionEventFromRow(row: DecisionEventRow): DecisionEvent {
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

function stringArrayFromJson(value: string): string[] {
  const parsed = fromJson(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

function recordFromJson(value: string): Record<string, unknown> {
  const parsed = fromJson(value);
  return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function cloneOptionalRecord(value: EaRecord | undefined): EaRecord | undefined {
  return value == null ? undefined : cloneRecord(value);
}

function cloneRecord<T extends EaRecord>(value: T): T {
  return structuredClone(value);
}

function cloneCommand(value: EaCommand): EaCommand {
  return cloneRecord(value);
}

function cloneArray(value: unknown[]): EaRecord[] {
  return structuredClone(value) as EaRecord[];
}

function createStoredCommand(accountId: string, candidate: CommandCandidate | EaCommand, status: CommandStatus): StoredCommand {
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

function cloneStoredCommand(value: StoredCommand | undefined): StoredCommand | undefined {
  return value == null ? undefined : structuredClone(value);
}

function normalizeCommandSource(value: unknown): CommandSource {
  return typeof value === 'string' && isCommandSource(value) ? value : 'ea_analysis';
}

function isAckResult(result: string): boolean {
  return result === 'OK';
}

function toEaCommand(command: StoredCommand): EaCommand {
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

function setPollSourceVisible(command: StoredCommand, visible: boolean): void {
  Object.defineProperty(command, '__poll_source_visible', {
    value: visible,
    enumerable: false,
    configurable: true
  });
}

function isPollSourceVisible(command: StoredCommand): boolean {
  return (command as EaRecord).__poll_source_visible === true;
}

type RuntimeCommandRow = {
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

type RuntimeCommandListRow = RuntimeCommandRow & {
  command_id: string;
};

function runtimeCommandFromRow(commandId: string, row: RuntimeCommandRow): StoredCommand {
  return buildRuntimeCommand(commandId, row);
}

function runtimeCommandFromListRow(row: RuntimeCommandListRow): StoredCommand {
  return buildRuntimeCommand(row.command_id, row);
}

function buildRuntimeCommand(commandId: string, row: RuntimeCommandRow): StoredCommand {
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

function isActiveAIApprovePendingCommand(command: StoredCommand, accountId: string, symbol: string, side: string, nowIso: string): boolean {
  if (command.account_id !== accountId || command.status !== 'queued' || command.source !== 'ai_approve') {
    return false;
  }
  if (!equalsFold(stringField(command as EaRecord, 'symbol'), symbol)) {
    return false;
  }
  if (!equalsFold(stringField(command as EaRecord, 'type'), side)) {
    return false;
  }
  const expiration = (command as EaRecord).expiration;
  if (typeof expiration === 'number' && Number.isFinite(expiration) && Math.trunc(expiration) <= unixSeconds(nowIso)) {
    return false;
  }
  return true;
}

function equalsFold(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function unixSeconds(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : Math.floor(Date.now() / 1000);
}
