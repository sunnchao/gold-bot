import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isCommandSource, isCommandStatus, isRuntimeMode, type CommandSource, type CommandStatus, type RuntimeMode } from '@gold-bot/shared-contracts';
import type { CommandCandidate, StoredCommand } from './commands.js';
import type { DecisionEvent, DecisionEventFilter, DecisionEventInput } from './decisions.js';
import type { RuntimeStateRecord } from './runtime-state.js';
import type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary, ShadowRuntimeSnapshot } from './shadow.js';
export type { CommandCandidate, StoredCommand } from './commands.js';
export type { DecisionEvent, DecisionEventFilter, DecisionEventInput, DecisionStage, DecisionStatus } from './decisions.js';
export type { RuntimeStateRecord } from './runtime-state.js';
export type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary, ShadowRuntimeSnapshot } from './shadow.js';

export const persistenceStatus = {
  writesLiveCommands: false
} as const;

export type EaRecord = Record<string, unknown>;

export type EaCommand = EaRecord & {
  command_id: string;
  action: string;
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
  getPositions(accountId: string): EaRecord[];
  saveOrderResult(payload: EaRecord): void;
  getOrderResults(accountId: string): EaRecord[];
  enqueueCommand(accountId: string, command: EaCommand): void;
  saveCommandCandidate(accountId: string, candidate: CommandCandidate): StoredCommand;
  promoteCommand(commandId: string): void;
  demoteCommandToShadowOnly(commandId: string): void;
  getCommand(commandId: string): StoredCommand | undefined;
  listCommands(accountId: string): StoredCommand[];
  getRuntimeMode(accountId: string): RuntimeMode;
  setRuntimeMode(accountId: string, mode: RuntimeMode): void;
  reconcileCommandResult(accountId: string, commandId: string, result: string, ticket?: number): void;
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
  updatePendingSignalArbitration(id: number, result: string, reason: string): boolean;
  expirePendingSignals(nowIso: string): number;
  saveAIResult(accountId: string, symbol: string, payload: EaRecord): void;
  getAIResults(accountId: string): EaRecord[];
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
  orderResults: Map<string, EaRecord[]>;
  runtimeModes: Map<string, RuntimeMode>;
  commands: Map<string, StoredCommand>;
  shadowComparisons: ShadowComparison[];
  shadowSnapshots: Map<string, ShadowRuntimeSnapshot>;
  decisionEvents: DecisionEvent[];
  pendingSignals: Map<string, EaRecord[]>;
  aiResults: Map<string, EaRecord[]>;
  nextCommandId: number;
  nextDecisionEventId: number;
};

export function createInMemoryEaStore(): EaStore {
  const state: StoreState = {
    registrations: new Map(),
    heartbeats: new Map(),
    ticks: new Map(),
    bars: new Map(),
    positions: new Map(),
    orderResults: new Map(),
    runtimeModes: new Map(),
    commands: new Map(),
    shadowComparisons: [],
    shadowSnapshots: new Map(),
    decisionEvents: [],
    pendingSignals: new Map(),
    aiResults: new Map(),
    nextCommandId: 1,
    nextDecisionEventId: 1
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
      state.positions.set(accountId(payload), cloneArray(positions));
    },
    getPositions(accountId) {
      return cloneArray(state.positions.get(accountId) ?? []);
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
      state.commands.set(command.command_id, createStoredCommand(accountId, {
        source: 'ea_analysis',
        ...cloneCommand(command)
      }, 'queued'));
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
        command.status = 'queued';
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
    getRuntimeMode(accountId) {
      return state.runtimeModes.get(accountId) ?? 'oracle';
    },
    setRuntimeMode(accountId, mode) {
      state.runtimeModes.set(accountId, mode);
    },
    reconcileCommandResult(accountId, commandId, result, ticket) {
      const command = state.commands.get(commandId);
      if (command != null && command.account_id === accountId) {
        command.result = result;
        if (ticket != null) {
          command.ticket = ticket;
        }
        command.status = isAckResult(result) ? 'acked' : 'failed';
      }
      this.saveOrderResult({
        account_id: accountId,
        command_id: commandId,
        result,
        ...(ticket == null ? {} : { ticket })
      });
    },
    pollCommands(accountId) {
      const pending = Array.from(state.commands.values()).filter((command) => command.account_id === accountId && command.status === 'queued');
      for (const command of pending) {
        command.status = 'delivered';
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
      const current = state.pendingSignals.get(key) ?? [];
      state.pendingSignals.set(key, [...current, normalizePendingSignal(payload)]);
    },
    getPendingSignals(accountId, symbol) {
      return pendingSignalsNewestFirst(state.pendingSignals.get(symbolKey(accountId, symbol)) ?? []);
    },
    updatePendingSignalArbitration(id, result, reason) {
      return updatePendingSignalInMemory(state.pendingSignals, id, result, reason);
    },
    expirePendingSignals(nowIso) {
      return expirePendingSignalsInMemory(state.pendingSignals, nowIso);
    },
    saveAIResult(accountId, symbol, payload) {
      const current = state.aiResults.get(accountId) ?? [];
      state.aiResults.set(accountId, [...current, { account_id: accountId, symbol, ...cloneRecord(payload) }]);
    },
    getAIResults(accountId) {
      return cloneArray(state.aiResults.get(accountId) ?? []);
    },
    listAccountIds() {
      const out: string[] = [];
      for (const key of [
        ...state.registrations.keys(),
        ...state.heartbeats.keys(),
        ...Array.from(state.ticks.keys(), accountFromCompoundKey),
        ...Array.from(state.bars.keys(), accountFromCompoundKey),
        ...state.positions.keys(),
        ...state.orderResults.keys(),
        ...state.decisionEvents.map((event) => event.account_id),
        ...Array.from(state.pendingSignals.keys(), accountFromCompoundKey),
        ...state.aiResults.keys()
      ]) {
        appendUnique(out, key);
      }
      return out;
    },
    listSymbols(accountId) {
      const out: string[] = [];
      appendMany(out, stringArrayField(state.registrations.get(accountId), 'ai_symbols'));
      appendMany(out, stringArrayField(state.heartbeats.get(accountId), 'ai_symbols'));
      for (const key of state.ticks.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      for (const key of state.bars.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      for (const position of state.positions.get(accountId) ?? []) {
        const symbol = position.symbol;
        if (typeof symbol === 'string') {
          appendUnique(out, symbol);
        }
      }
      for (const event of state.decisionEvents) {
        if (event.account_id === accountId) {
          appendUnique(out, event.symbol);
        }
      }
      for (const key of state.pendingSignals.keys()) {
        appendSymbolFromKey(out, key, accountId);
      }
      for (const aiResult of state.aiResults.get(accountId) ?? []) {
        const symbol = aiResult.symbol;
        if (typeof symbol === 'string') {
          appendUnique(out, symbol);
        }
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
      return this.listSymbols(accountId);
    }
  };
}

export function createSqliteEaStore(path: string): EaStore {
  const db = new DatabaseSync(path);
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  `);

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
  const selectSnapshotAccounts = db.prepare(`SELECT DISTINCT account_id FROM ea_snapshots ORDER BY account_id ASC`);
  const selectEventAccounts = db.prepare(`SELECT DISTINCT account_id FROM ea_events ORDER BY account_id ASC`);
  const selectSnapshotSymbols = db.prepare(`
    SELECT DISTINCT symbol FROM ea_snapshots
    WHERE account_id = ? AND symbol <> ''
    ORDER BY rowid ASC
  `);
  const selectEventSymbols = db.prepare(`
    SELECT DISTINCT symbol FROM ea_events
    WHERE account_id = ? AND symbol <> ''
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP)
  `);
  const updateRuntimeCommandStatus = db.prepare(`
    UPDATE runtime_commands
    SET status = ?, delivered_at = CASE WHEN ? <> '' THEN ? ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP
    WHERE command_id = ?
  `);
  const updateRuntimeCommandResult = db.prepare(`
    UPDATE runtime_commands
    SET status = ?, result = ?, ticket = ?, updated_at = CURRENT_TIMESTAMP
    WHERE command_id = ? AND account_id = ?
  `);
  const selectRuntimeCommand = db.prepare(`
    SELECT account_id, status, source, payload_json, result, ticket, created_at, delivered_at
    FROM runtime_commands
    WHERE command_id = ?
  `);
  const selectRuntimeCommandsByAccount = db.prepare(`
    SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at
    FROM runtime_commands
    WHERE account_id = ?
    ORDER BY created_at ASC, command_id ASC
  `);
  const selectQueuedRuntimeCommands = db.prepare(`
    SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at
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
    getPositions(accountId) {
      const rows = snapshotRows(db, 'positions', accountId);
      return rows.flatMap((row) => (Array.isArray(row.positions) ? (row.positions as EaRecord[]) : []));
    },
    saveOrderResult(payload) {
      insertEvent.run('order_result', accountId(payload), '', toJson(payload), 1);
    },
    getOrderResults(accountId) {
      return eventPayloads(selectEventsAnyDelivery, 'order_result', accountId);
    },
    enqueueCommand(accountId, command) {
      insertRuntimeCommand.run(
        command.command_id,
        accountId,
        'queued',
        'ea_analysis',
        symbolOrDefault(command),
        toJson(command),
        '',
        null
      );
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
        null
      );
      return stored;
    },
    promoteCommand(commandId) {
      updateRuntimeCommandStatus.run('queued', '', '', commandId);
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
    getRuntimeMode(accountId) {
      const row = selectRuntimeState.get(accountId) as { mode?: string } | undefined;
      return row != null && typeof row.mode === 'string' && isRuntimeMode(row.mode) ? row.mode : 'oracle';
    },
    setRuntimeMode(accountId, mode) {
      upsertRuntimeState.run(accountId, mode, mode === 'cutover' ? 1 : 0);
    },
    reconcileCommandResult(accountId, commandId, result, ticket) {
      updateRuntimeCommandResult.run(isAckResult(result) ? 'acked' : 'failed', result, ticket ?? null, commandId, accountId);
      insertEvent.run('order_result', accountId, '', toJson({
        account_id: accountId,
        command_id: commandId,
        result,
        ...(ticket == null ? {} : { ticket })
      }), 1);
    },
    pollCommands(accountId) {
      const rows = selectQueuedRuntimeCommands.all(accountId) as RuntimeCommandListRow[];
      for (const row of rows) {
        updateRuntimeCommandStatus.run('delivered', currentTimestamp(), currentTimestamp(), row.command_id);
      }
      return rows.map((row) => toEaCommand(runtimeCommandFromListRow(row)));
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
      insertEvent.run('pending_signal', accountId(payload), symbolOrDefault(payload), toJson(normalizePendingSignal(payload)), 1);
    },
    getPendingSignals(accountId, symbol) {
      return pendingSignalsNewestFirst(eventPayloads(selectEventsBySymbol, 'pending_signal', accountId, symbol));
    },
    updatePendingSignalArbitration(id, result, reason) {
      return updatePendingSignalInSqlite(db, id, result, reason);
    },
    expirePendingSignals(nowIso) {
      return expirePendingSignalsInSqlite(db, nowIso);
    },
    saveAIResult(accountId, symbol, payload) {
      insertEvent.run('ai_result', accountId, symbol, toJson({ account_id: accountId, symbol, ...payload }), 1);
    },
    getAIResults(accountId) {
      return eventPayloads(selectEventsAnyDelivery, 'ai_result', accountId);
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
      appendMany(out, stringArrayField(this.getRegistration(accountId), 'ai_symbols'));
      appendMany(out, stringArrayField(this.getHeartbeat(accountId), 'ai_symbols'));
      for (const row of selectSnapshotSymbols.all(accountId) as Array<{ symbol: string }>) {
        appendUnique(out, row.symbol);
      }
      for (const row of selectEventSymbols.all(accountId) as Array<{ symbol: string }>) {
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
      return heartbeatSymbols.length > 0 ? heartbeatSymbols : this.listSymbols(accountId);
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
      if (stringField(signal, 'status') === 'pending' && stringField(signal, 'expires_at') < nowIso) {
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

function appendMany(out: string[], values: readonly string[]): void {
  for (const value of values) {
    appendUnique(out, value);
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

function eventPayloads(statement: { all(...params: unknown[]): unknown[] }, ...params: unknown[]): EaRecord[] {
  return (statement.all(...params) as Array<{ payload_json: string }>).map((row) => fromJson(row.payload_json) as EaRecord);
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
    if (stringField(payload, 'status') === 'pending' && stringField(payload, 'expires_at') < nowIso) {
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
  return {
    ...cloneRecord(candidate as EaRecord),
    account_id: accountId,
    command_id: commandId,
    action: String(candidate.action),
    source,
    status,
    created_at: currentTimestamp()
  } as StoredCommand;
}

function cloneStoredCommand(value: StoredCommand | undefined): StoredCommand | undefined {
  return value == null ? undefined : structuredClone(value);
}

function normalizeCommandSource(value: unknown): CommandSource {
  return typeof value === 'string' && isCommandSource(value) ? value : 'ea_analysis';
}

function isAckResult(result: string): boolean {
  const normalized = result.trim().toLowerCase();
  return normalized === 'filled' || normalized === 'ok' || normalized === 'success' || normalized === 'accepted';
}

function toEaCommand(command: StoredCommand): EaCommand {
  const out = cloneRecord(command as EaRecord) as EaCommand;
  delete (out as EaRecord).account_id;
  delete (out as EaRecord).status;
  delete (out as EaRecord).source;
  delete (out as EaRecord).created_at;
  delete (out as EaRecord).delivered_at;
  delete (out as EaRecord).result;
  return out;
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
  return {
    ...(payload as EaCommand),
    account_id: row.account_id,
    command_id: typeof payload.command_id === 'string' && payload.command_id.length > 0 ? payload.command_id : commandId,
    action: typeof payload.action === 'string' ? payload.action : '',
    source,
    status,
    created_at: row.created_at,
    delivered_at: row.delivered_at.length > 0 ? row.delivered_at : undefined,
    result: row.result.length > 0 ? row.result : undefined,
    ticket: typeof row.ticket === 'number' ? row.ticket : undefined
  };
}
