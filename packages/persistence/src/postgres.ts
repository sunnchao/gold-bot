import pg from 'pg';
import { isRuntimeMode, type RuntimeMode } from '@gold-bot/shared-contracts';
import type { CommandCandidate, StoredCommand } from './commands.js';
import type { DecisionEvent, DecisionEventFilter, DecisionEventInput } from './decisions.js';
import type { RuntimeStateRecord } from './runtime-state.js';
import type { ShadowComparison, ShadowComparisonFilter, ShadowComparisonSummary, ShadowRuntimeSnapshot } from './shadow.js';
import type { StoredApiToken, StoredApiTokenInput } from './tokens.js';
import { runMigrationsPostgres, type PostgresClient } from './migrate.js';
import {
  accountId,
  candidateSignalDecisionEvent,
  cloneCommand,
  cloneRecord,
  commandDecisionEvent,
  commandResultDecisionEvent,
  compareDecisionEventsNewestFirst,
  createStoredCommand,
  currentTimestamp,
  decisionEventFromRow,
  filterShadowComparisons,
  fromJson,
  isActiveAIApprovePendingCommand,
  isAckResult,
  isPendingSignalExpired,
  isRuntimeCommandExpired,
  normalizeApiToken,
  normalizeDecisionEvent,
  normalizePendingSignal,
  normalizePositionState,
  numericField,
  pendingSignalsNewestFirst,
  positionStateFromRow,
  recordFromJson,
  runtimeCommandFromListRow,
  runtimeCommandFromRow,
  stringArrayField,
  stringField,
  symbolOrDefault,
  appendUnique,
  summarizeShadowComparisons,
  toEaCommand,
  toJson,
  type DecisionEventRow,
  type EaCommand,
  type EaRecord,
  type PositionStateRecord,
  type PositionStateRow,
  type RuntimeCommandListRow,
  type RuntimeCommandRow
} from './helpers.js';
import type { EaStore } from './index.js';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

async function queryRows(client: PostgresClient, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await client.query(text, values) as QueryResult;
  return result.rows ?? [];
}

async function queryOne(client: PostgresClient, text: string, values: unknown[]): Promise<Record<string, unknown> | null> {
  const rows = await queryRows(client, text, values);
  return rows[0] ?? null;
}

async function queryRowCount(client: PostgresClient, text: string, values: unknown[]): Promise<number> {
  const result = await client.query(text, values) as QueryResult;
  return result.rowCount ?? 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function shadowComparisonFromRow(row: Record<string, unknown>): ShadowComparison {
  return {
    account_id: asString(row.account_id),
    symbol: asString(row.symbol),
    protocol_ok: asNumber(row.protocol_ok) !== 0,
    signal_drift: asNumber(row.signal_drift) !== 0,
    command_drift: asNumber(row.command_drift) !== 0,
    oracle_compared: asNumber(row.oracle_compared) !== 0,
    source: normalizeShadowSource(asString(row.source)),
    created_at: asString(row.created_at)
  };
}

function normalizeShadowSource(value: string): 'position_review' | 'ai_result' | 'ea_analysis' {
  if (value === 'position_review' || value === 'ai_result' || value === 'ea_analysis') {
    return value;
  }
  return 'ea_analysis';
}

function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return typeof value === 'string' && isRuntimeMode(value) ? value : 'oracle';
}

function rowToStoredCommand(commandId: string, row: Record<string, unknown>): StoredCommand {
  const runtimeRow: RuntimeCommandRow = {
    account_id: asString(row.account_id),
    status: asString(row.status),
    source: asString(row.source),
    payload_json: asString(row.payload_json),
    result: asString(row.result),
    ticket: asNumberOrNull(row.ticket),
    created_at: asString(row.created_at),
    delivered_at: asString(row.delivered_at),
    acked_at: asString(row.acked_at),
    failed_at: asString(row.failed_at),
    error_text: asString(row.error_text)
  };
  return runtimeCommandFromRow(commandId, runtimeRow);
}

function rowToListStoredCommand(row: Record<string, unknown>): StoredCommand {
  const listRow: RuntimeCommandListRow = {
    command_id: asString(row.command_id),
    account_id: asString(row.account_id),
    status: asString(row.status),
    source: asString(row.source),
    payload_json: asString(row.payload_json),
    result: asString(row.result),
    ticket: asNumberOrNull(row.ticket),
    created_at: asString(row.created_at),
    delivered_at: asString(row.delivered_at),
    acked_at: asString(row.acked_at),
    failed_at: asString(row.failed_at),
    error_text: asString(row.error_text)
  };
  return runtimeCommandFromListRow(listRow);
}

function decisionEventFromPgRow(row: Record<string, unknown>): DecisionEvent {
  const typedRow: DecisionEventRow = {
    id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
    decision_id: asString(row.decision_id),
    account_id: asString(row.account_id),
    symbol: asString(row.symbol),
    stage: asString(row.stage) as DecisionEvent['stage'],
    status: asString(row.status) as DecisionEvent['status'],
    reason_codes_json: asString(row.reason_codes_json),
    summary_json: asString(row.summary_json),
    related_command_id: asString(row.related_command_id),
    created_at: asString(row.created_at)
  };
  return decisionEventFromRow(typedRow);
}

async function ensurePostgresSerialColumns(client: PostgresClient): Promise<void> {
  const columns = [
    { table: 'ea_events', indexName: 'idx_ea_events_serial_id' },
    { table: 'ea_snapshots', indexName: 'idx_ea_snapshots_serial_id' },
    { table: 'shadow_comparisons', indexName: 'idx_shadow_comparisons_serial_id' }
  ];
  for (const { table, indexName } of columns) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
    await client.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (id)`);
  }
}

async function insertDecisionEventIfPresent(
  client: PostgresClient,
  event: DecisionEventInput | null
): Promise<void> {
  if (event == null) {
    return;
  }
  await client.query(
    'INSERT INTO decision_events (decision_id, account_id, symbol, stage, status, reason_codes_json, summary_json, related_command_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      event.decision_id,
      event.account_id,
      event.symbol,
      event.stage,
      event.status,
      toJson(event.reason_codes),
      toJson(event.summary),
      event.related_command_id,
      event.created_at
    ]
  );
}

async function selectDecisionEventsPg(
  client: PostgresClient,
  filter: DecisionEventFilter
): Promise<DecisionEvent[]> {
  const clauses: string[] = ['account_id = $1'];
  const params: unknown[] = [filter.account_id];
  let paramIndex = 2;
  if (filter.symbol != null && filter.symbol.length > 0) {
    clauses.push(`symbol = $${paramIndex}`);
    params.push(filter.symbol);
    paramIndex++;
  }
  if (filter.status != null && filter.status.length > 0) {
    clauses.push(`status = $${paramIndex}`);
    params.push(filter.status);
    paramIndex++;
  }
  const limit = filter.limit == null || filter.limit <= 0 || filter.limit > 200 ? 50 : filter.limit;
  const limitPlaceholder = `$${paramIndex}`;
  params.push(limit);
  const rows = await queryRows(
    client,
    `SELECT id, decision_id, account_id, symbol, stage, status, reason_codes_json, summary_json, related_command_id, created_at FROM decision_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${limitPlaceholder}`,
    params
  );
  const events = rows.map(decisionEventFromPgRow);
  events.sort(compareDecisionEventsNewestFirst);
  return events;
}

async function nextPendingSignalIdPg(client: PostgresClient, accountIdValue: string, symbol: string): Promise<number> {
  const rows = await queryRows(
    client,
    "SELECT payload_json FROM ea_events WHERE kind = 'pending_signal' AND account_id = $1 AND symbol = $2",
    [accountIdValue, symbol]
  );
  let maxId = 0;
  for (const row of rows) {
    const payload = fromJson(asString(row.payload_json)) as EaRecord;
    const id = numericField(payload, 'id');
    if (id > maxId) {
      maxId = id;
    }
  }
  return maxId + 1;
}

async function replacePendingSignalPg(
  client: PostgresClient,
  signal: EaRecord
): Promise<void> {
  const account = accountId(signal);
  const symbol = symbolOrDefault(signal);
  const id = numericField(signal, 'id');
  const rows = await queryRows(
    client,
    "SELECT id AS row_id FROM ea_events WHERE kind = 'pending_signal' AND account_id = $1 AND symbol = $2",
    [account, symbol]
  );
  for (const row of rows) {
    const rowId = asNumber(row.row_id);
    const payload = fromJson(asString((await queryOne(client, 'SELECT payload_json FROM ea_events WHERE id = $1', [rowId]))?.payload_json)) as EaRecord;
    if (numericField(payload, 'id') === id) {
      await client.query(
        'UPDATE ea_events SET payload_json = $1 WHERE id = $2',
        [toJson(signal), rowId]
      );
      return;
    }
  }
  await client.query(
    "INSERT INTO ea_events (kind, account_id, symbol, payload_json, delivered) VALUES ('pending_signal', $1, $2, $3, 1)",
    [account, symbol, toJson(signal)]
  );
}

async function updatePendingSignalPg(
  client: PostgresClient,
  id: number,
  result: string,
  reason: string
): Promise<boolean> {
  const rows = await queryRows(
    client,
    "SELECT id AS row_id, payload_json FROM ea_events WHERE kind = 'pending_signal' ORDER BY id ASC",
    []
  );
  for (const row of rows) {
    const payload = fromJson(asString(row.payload_json)) as EaRecord;
    if (numericField(payload, 'id') === id) {
      const updated = cloneRecord(payload);
      updated.status = result === 'rejected' ? 'rejected' : 'approved';
      updated.arbitration_result = result;
      updated.arbitration_reason = reason;
      await client.query('UPDATE ea_events SET payload_json = $1 WHERE id = $2', [
        toJson(updated),
        asNumber(row.row_id)
      ]);
      return true;
    }
  }
  return false;
}

async function expirePendingSignalsPg(client: PostgresClient, nowIso: string): Promise<number> {
  const rows = await queryRows(
    client,
    "SELECT id AS row_id, payload_json FROM ea_events WHERE kind = 'pending_signal' ORDER BY id ASC",
    []
  );
  let expired = 0;
  for (const row of rows) {
    const payload = fromJson(asString(row.payload_json)) as EaRecord;
    if (stringField(payload, 'status') !== 'pending') {
      continue;
    }
    if (isPendingSignalExpired(payload, nowIso)) {
      const updated = cloneRecord(payload);
      updated.status = 'expired';
      await client.query('UPDATE ea_events SET payload_json = $1 WHERE id = $2', [
        toJson(updated),
        asNumber(row.row_id)
      ]);
      expired++;
    }
  }
  return expired;
}

export async function createPostgresEaStore(dsn: string): Promise<EaStore | null> {
  let pool: pg.Pool;
  try {
    pool = new pg.Pool({ connectionString: dsn });
  } catch (error) {
    console.error('✗ Postgres pool creation failed:', error);
    return null;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('✗ Postgres connection test failed:', error);
    await pool.end().catch(() => undefined);
    return null;
  }

  try {
    await runMigrationsPostgres(pool as unknown as PostgresClient);
    await ensurePostgresSerialColumns(pool as unknown as PostgresClient);
  } catch (error) {
    console.error('✗ Postgres migration failed:', error);
    await pool.end().catch(() => undefined);
    return null;
  }

  const q = pool as unknown as PostgresClient;

  const store: EaStore = {
    async saveRegistration(payload: EaRecord): Promise<void> {
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('registration', $1, $2, '', $3, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountId(payload), symbolOrDefault(payload), toJson(payload)]
      );
    },

    async getRegistration(accountIdValue: string): Promise<EaRecord | undefined> {
      const row = await queryOne(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'registration' AND account_id = $1 AND symbol = $2 AND timeframe = ''", [accountIdValue, 'XAUUSD']);
      if (!row) {
        return undefined;
      }
      return recordFromJson(asString(row.payload_json)) as EaRecord;
    },

    async saveHeartbeat(payload: EaRecord): Promise<void> {
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('heartbeat', $1, $2, '', $3, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountId(payload), symbolOrDefault(payload), toJson(payload)]
      );
    },

    async getHeartbeat(accountIdValue: string): Promise<EaRecord | undefined> {
      const row = await queryOne(
        q,
        "SELECT payload_json FROM ea_snapshots WHERE kind = 'heartbeat' AND account_id = $1 AND timeframe = '' ORDER BY updated_at DESC LIMIT 1",
        [accountIdValue]
      );
      if (!row) {
        return undefined;
      }
      return recordFromJson(asString(row.payload_json)) as EaRecord;
    },

    async saveTick(payload: EaRecord): Promise<void> {
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('tick', $1, $2, '', $3, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountId(payload), symbolOrDefault(payload), toJson(payload)]
      );
    },

    async getLatestTick(accountIdValue: string, symbol: string): Promise<EaRecord | undefined> {
      const row = await queryOne(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'tick' AND account_id = $1 AND symbol = $2 AND timeframe = ''", [accountIdValue, symbol]);
      if (!row) {
        return undefined;
      }
      return recordFromJson(asString(row.payload_json)) as EaRecord;
    },

    async saveBars(payload: EaRecord): Promise<void> {
      const symbol = symbolOrDefault(payload);
      const timeframe = stringField(payload, 'timeframe');
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('bars', $1, $2, $3, $4, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountId(payload), symbol, timeframe, toJson(payload)]
      );
    },

    async getBars(accountIdValue: string, symbol: string, timeframe: string): Promise<EaRecord[]> {
      // Persist the full EA bars payload, but return only the inner bar array so
      // Postgres matches the SQLite/in-memory contract used by replay + risk gates.
      const row = await queryOne(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'bars' AND account_id = $1 AND symbol = $2 AND timeframe = $3", [accountIdValue, symbol, timeframe]);
      if (!row) {
        return [];
      }
      const payload = recordFromJson(asString(row.payload_json)) as EaRecord;
      return Array.isArray(payload.bars) ? (payload.bars as EaRecord[]) : [];
    },

    async savePositions(payload: EaRecord): Promise<void> {
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('positions', $1, $2, '', $3, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountId(payload), symbolOrDefault(payload), toJson(payload)]
      );
    },

    async getPositions(accountIdValue: string, symbol?: string): Promise<EaRecord[]> {
      if (symbol != null && symbol.length > 0) {
        const row = await queryOne(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'positions' AND account_id = $1 AND symbol = $2 AND timeframe = ''", [accountIdValue, symbol]);
        if (!row) {
          return [];
        }
        const positions = (recordFromJson(asString(row.payload_json)) as EaRecord).positions;
        return Array.isArray(positions) ? (positions as EaRecord[]) : [];
      }
      const rows = await queryRows(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'positions' AND account_id = $1 ORDER BY id ASC", [accountIdValue]);
      const out: EaRecord[] = [];
      for (const row of rows) {
        const positions = (recordFromJson(asString(row.payload_json)) as EaRecord).positions;
        if (Array.isArray(positions)) {
          out.push(...(positions as EaRecord[]));
        }
      }
      return out;
    },

    async savePositionState(accountIdValue: string, symbol: string, state: PositionStateRecord): Promise<void> {
      const normalized = normalizePositionState(state);
      await q.query(
        `INSERT INTO position_states (account_id, symbol, ticket, tp1_hit, tp2_hit, max_profit_atr, be_moved, be_trigger_atr, best_sl, open_time, last_modify_time, add_on_count, last_add_on_time, last_add_on_price, group_id, group_avg_entry, group_best_sl) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT(account_id, symbol, ticket) DO UPDATE SET tp1_hit = excluded.tp1_hit, tp2_hit = excluded.tp2_hit, max_profit_atr = excluded.max_profit_atr, be_moved = excluded.be_moved, be_trigger_atr = excluded.be_trigger_atr, best_sl = excluded.best_sl, open_time = excluded.open_time, last_modify_time = excluded.last_modify_time, add_on_count = excluded.add_on_count, last_add_on_time = excluded.last_add_on_time, last_add_on_price = excluded.last_add_on_price, group_id = excluded.group_id, group_avg_entry = excluded.group_avg_entry, group_best_sl = excluded.group_best_sl`,
        [
          accountIdValue,
          symbol,
          normalized.ticket,
          boolToInt(normalized.tp1_hit),
          boolToInt(normalized.tp2_hit),
          normalized.max_profit_atr,
          boolToInt(normalized.be_moved),
          normalized.be_trigger_atr,
          normalized.best_sl,
          normalized.open_time,
          normalized.last_modify_time,
          normalized.add_on_count,
          normalized.last_add_on_time,
          normalized.last_add_on_price,
          normalized.group_id,
          normalized.group_avg_entry,
          normalized.group_best_sl
        ]
      );
    },

    async loadPositionStates(accountIdValue: string, symbol: string): Promise<PositionStateRecord[]> {
      const rows = await queryRows(q, 'SELECT ticket, tp1_hit, tp2_hit, max_profit_atr, be_moved, be_trigger_atr, best_sl, open_time, last_modify_time, add_on_count, last_add_on_time, last_add_on_price, group_id, group_avg_entry, group_best_sl FROM position_states WHERE account_id = $1 AND symbol = $2 ORDER BY ticket ASC', [accountIdValue, symbol]);
      return rows.map((row) => positionStateFromRow({
        ticket: asNumber(row.ticket),
        tp1_hit: asNumber(row.tp1_hit),
        tp2_hit: asNumber(row.tp2_hit),
        max_profit_atr: asNumber(row.max_profit_atr),
        be_moved: asNumber(row.be_moved),
        be_trigger_atr: asNumber(row.be_trigger_atr),
        best_sl: asNumber(row.best_sl),
        open_time: asString(row.open_time),
        last_modify_time: asString(row.last_modify_time),
        add_on_count: asNumber(row.add_on_count),
        last_add_on_time: asString(row.last_add_on_time),
        last_add_on_price: asNumber(row.last_add_on_price),
        group_id: asString(row.group_id),
        group_avg_entry: asNumber(row.group_avg_entry),
        group_best_sl: asNumber(row.group_best_sl)
      } as PositionStateRow));
    },

    async deleteStalePositionStates(accountIdValue: string, symbol: string, activeTickets: number[]): Promise<void> {
      if (activeTickets.length === 0) {
        await q.query('DELETE FROM position_states WHERE account_id = $1 AND symbol = $2', [accountIdValue, symbol]);
        return;
      }
      const placeholders = activeTickets.map((_, index) => `$${index + 3}`).join(', ');
      await q.query(
        `DELETE FROM position_states WHERE account_id = $1 AND symbol = $2 AND ticket NOT IN (${placeholders})`,
        [accountIdValue, symbol, ...activeTickets]
      );
    },

    async saveOrderResult(payload: EaRecord): Promise<void> {
      await q.query(
        "INSERT INTO ea_events (kind, account_id, symbol, payload_json, delivered) VALUES ('order_result', $1, '', $2, 1)",
        [accountId(payload), toJson(payload)]
      );
    },

    async getOrderResults(accountIdValue: string): Promise<EaRecord[]> {
      const rows = await queryRows(q, "SELECT payload_json FROM ea_events WHERE kind = 'order_result' AND account_id = $1 ORDER BY id ASC", [accountIdValue]);
      return rows.map((row) => recordFromJson(asString(row.payload_json)) as EaRecord);
    },

    async enqueueCommand(accountIdValue: string, command: EaCommand): Promise<void> {
      const stored = createStoredCommand(accountIdValue, cloneCommand(command), 'queued');
      await q.query(
        `INSERT INTO runtime_commands (command_id, account_id, status, source, symbol, payload_json, result, ticket, created_at, delivered_at, updated_at) VALUES ($1, $2, 'queued', $3, $4, $5, '', $6, $7, '', CURRENT_TIMESTAMP)`,
        [
          stored.command_id,
          accountIdValue,
          stored.source,
          symbolOrDefault(stored),
          toJson(toEaCommand(stored)),
          typeof stored.ticket === 'number' ? stored.ticket : null,
          stored.created_at
        ]
      );
      await insertDecisionEventIfPresent(q, commandDecisionEvent(stored, 'command_enqueued', 'pending', stored.created_at));
    },

    async saveCommandCandidate(accountIdValue: string, candidate: CommandCandidate): Promise<StoredCommand> {
      const commandId = typeof candidate.command_id === 'string' && candidate.command_id.length > 0
        ? candidate.command_id
        : `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const stored = createStoredCommand(accountIdValue, { ...cloneRecord(candidate as EaRecord), command_id: commandId, action: String(candidate.action), source: candidate.source } as CommandCandidate, 'draft');
      await q.query(
        `INSERT INTO runtime_commands (command_id, account_id, status, source, symbol, payload_json, result, ticket, created_at, delivered_at, updated_at) VALUES ($1, $2, 'draft', $3, $4, $5, '', $6, $7, '', CURRENT_TIMESTAMP)`,
        [
          stored.command_id,
          accountIdValue,
          stored.source,
          symbolOrDefault(stored),
          toJson(toEaCommand(stored)),
          typeof stored.ticket === 'number' ? stored.ticket : null,
          stored.created_at
        ]
      );
      return stored;
    },

    async promoteCommand(commandId: string): Promise<void> {
      const row = await queryOne(q, 'SELECT account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE command_id = $1', [commandId]);
      if (!row) {
        return;
      }
      const command = rowToStoredCommand(commandId, row);
      const wasQueued = command.status === 'queued';
      await q.query(
        `UPDATE runtime_commands SET status = 'queued', delivered_at = CASE WHEN '' <> '' THEN '' ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE command_id = $1`,
        [commandId]
      );
      if (!wasQueued) {
        await insertDecisionEventIfPresent(q, commandDecisionEvent(command, 'command_enqueued', 'pending', command.created_at));
      }
    },

    async demoteCommandToShadowOnly(commandId: string): Promise<void> {
      await q.query(
        `UPDATE runtime_commands SET status = 'shadow_only', delivered_at = CASE WHEN '' <> '' THEN '' ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE command_id = $1`,
        [commandId]
      );
    },

    async getCommand(commandId: string): Promise<StoredCommand | undefined> {
      const row = await queryOne(q, 'SELECT account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE command_id = $1', [commandId]);
      if (!row) {
        return undefined;
      }
      return rowToStoredCommand(commandId, row);
    },

    async listCommands(accountIdValue: string): Promise<StoredCommand[]> {
      const rows = await queryRows(q, 'SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE account_id = $1 ORDER BY created_at ASC, command_id ASC', [accountIdValue]);
      return rows.map(rowToListStoredCommand);
    },

    async hasActiveAIApprovePending(accountIdValue: string, symbol: string, side: string, nowIso: string): Promise<boolean> {
      const rows = await queryRows(q, "SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE account_id = $1 AND status = 'queued' ORDER BY created_at ASC, command_id ASC", [accountIdValue]);
      const commands = rows.map(rowToListStoredCommand);
      return commands.some((command) => isActiveAIApprovePendingCommand(command, accountIdValue, symbol, side, nowIso));
    },

    async getRuntimeMode(accountIdValue: string): Promise<RuntimeMode> {
      const row = await queryOne(q, 'SELECT mode, cutover_enabled, updated_at FROM runtime_state WHERE account_id = $1', [accountIdValue]);
      if (!row) {
        return 'oracle';
      }
      return normalizeRuntimeMode(row.mode);
    },

    async setRuntimeMode(accountIdValue: string, mode: RuntimeMode): Promise<void> {
      await q.query(
        `INSERT INTO runtime_state (account_id, mode, cutover_enabled, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT(account_id) DO UPDATE SET mode = excluded.mode, cutover_enabled = excluded.cutover_enabled, updated_at = CURRENT_TIMESTAMP`,
        [accountIdValue, mode, mode === 'cutover' ? 1 : 0]
      );
    },

    async reconcileCommandResult(accountIdValue: string, commandId: string, result: string, ticket?: number, errorText?: string, createdAt?: string): Promise<boolean> {
      const normalizedTicket = ticket ?? 0;
      const ts = createdAt ?? currentTimestamp();
      const isAck = isAckResult(result);
      const updateSql = isAck
        ? `UPDATE runtime_commands SET status = 'acked', result = $1, ticket = $2, error_text = $3, acked_at = $4, updated_at = CURRENT_TIMESTAMP WHERE command_id = $5 AND account_id = $6 AND status = 'delivered'`
        : `UPDATE runtime_commands SET status = 'failed', result = $1, ticket = $2, error_text = $3, failed_at = $4, updated_at = CURRENT_TIMESTAMP WHERE command_id = $5 AND account_id = $6 AND status = 'delivered'`;
      const changes = await queryRowCount(q, updateSql, [result, normalizedTicket, errorText ?? '', ts, commandId, accountIdValue]);
      if (changes === 0) {
        return false;
      }
      await q.query(
        "INSERT INTO ea_events (kind, account_id, symbol, payload_json, delivered) VALUES ('order_result', $1, '', $2, 1)",
        [
          accountIdValue,
          toJson({ account_id: accountIdValue, command_id: commandId, result, ticket: normalizedTicket, error_text: errorText ?? '', created_at: ts })
        ]
      );
      const row = await queryOne(q, 'SELECT account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE command_id = $1', [commandId]);
      if (row) {
        const command = rowToStoredCommand(commandId, row);
        const event = commandResultDecisionEvent(command, result, normalizedTicket, errorText ?? '', ts);
        await insertDecisionEventIfPresent(q, event);
      }
      return true;
    },

    async pollCommands(accountIdValue: string): Promise<EaCommand[]> {
      const rows = await queryRows(q, "SELECT command_id, account_id, status, source, payload_json, result, ticket, created_at, delivered_at, acked_at, failed_at, error_text FROM runtime_commands WHERE account_id = $1 AND status = 'queued' ORDER BY created_at ASC, command_id ASC", [accountIdValue]);
      const deliveredAt = currentTimestamp();
      const delivered: StoredCommand[] = [];
      for (const row of rows) {
        const commandId = asString(row.command_id);
        const queuedCommand = rowToStoredCommand(commandId, row);
        if (isRuntimeCommandExpired(queuedCommand, deliveredAt)) {
          await q.query(
            `UPDATE runtime_commands SET status = 'failed', result = 'expired', ticket = 0, error_text = 'command expired before delivery', failed_at = $1, updated_at = CURRENT_TIMESTAMP WHERE command_id = $2 AND account_id = $3 AND status = 'queued'`,
            [deliveredAt, commandId, accountIdValue]
          );
          const expiredCommand = rowToStoredCommand(commandId, {
            ...row,
            status: 'failed',
            result: 'expired',
            ticket: 0,
            error_text: 'command expired before delivery',
            failed_at: deliveredAt
          });
          await insertDecisionEventIfPresent(q, commandResultDecisionEvent(expiredCommand, 'expired', 0, 'command expired before delivery', deliveredAt));
          continue;
        }
        await q.query(
          `UPDATE runtime_commands SET status = 'delivered', delivered_at = CASE WHEN $1 <> '' THEN $1 ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE command_id = $2`,
          [deliveredAt, commandId]
        );
        const command = rowToStoredCommand(commandId, { ...row, status: 'delivered', delivered_at: deliveredAt });
        await insertDecisionEventIfPresent(q, commandDecisionEvent(command, 'command_delivered', 'delivered', deliveredAt));
        delivered.push(command);
      }
      return delivered.map(toEaCommand);
    },

    async recordShadowComparison(payload: ShadowComparison): Promise<void> {
      await q.query(
        'INSERT INTO shadow_comparisons (account_id, symbol, protocol_ok, signal_drift, command_drift, oracle_compared, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          payload.account_id,
          payload.symbol,
          boolToInt(payload.protocol_ok),
          boolToInt(payload.signal_drift),
          boolToInt(payload.command_drift),
          boolToInt(payload.oracle_compared),
          payload.source,
          payload.created_at
        ]
      );
    },

    async listShadowComparisons(filter?: ShadowComparisonFilter): Promise<ShadowComparison[]> {
      const rows = await queryRows(q, 'SELECT account_id, symbol, protocol_ok, signal_drift, command_drift, oracle_compared, source, created_at FROM shadow_comparisons ORDER BY created_at ASC, id ASC', []);
      const comparisons = rows.map(shadowComparisonFromRow);
      return filterShadowComparisons(comparisons, filter);
    },

    async summarizeShadowComparisons(filter?: ShadowComparisonFilter): Promise<ShadowComparisonSummary> {
      return summarizeShadowComparisons(await this.listShadowComparisons(filter));
    },

    async saveShadowSnapshot(payload: ShadowRuntimeSnapshot): Promise<void> {
      await q.query(
        `INSERT INTO shadow_snapshots (account_id, symbol, source, payload_json, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) ON CONFLICT(account_id, symbol, source) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [payload.account_id, payload.symbol, payload.source, toJson(payload)]
      );
    },

    async getLatestShadowSnapshot(accountIdValue: string, symbol: string, source: string): Promise<ShadowRuntimeSnapshot | undefined> {
      const row = await queryOne(q, 'SELECT payload_json FROM shadow_snapshots WHERE account_id = $1 AND symbol = $2 AND source = $3', [accountIdValue, symbol, source]);
      if (!row) {
        return undefined;
      }
      const value = asString(row.payload_json);
      if (value.length === 0) {
        return undefined;
      }
      return fromJson(value) as ShadowRuntimeSnapshot;
    },

    async recordDecisionEvent(payload: DecisionEventInput): Promise<void> {
      const event = normalizeDecisionEvent(payload, 0);
      await q.query(
        'INSERT INTO decision_events (decision_id, account_id, symbol, stage, status, reason_codes_json, summary_json, related_command_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          event.decision_id,
          event.account_id,
          event.symbol,
          event.stage,
          event.status,
          toJson(event.reason_codes),
          toJson(event.summary),
          event.related_command_id,
          event.created_at
        ]
      );
    },

    async listDecisionEvents(filter: DecisionEventFilter): Promise<DecisionEvent[]> {
      return selectDecisionEventsPg(q, filter);
    },

    async savePendingSignal(payload: EaRecord): Promise<void> {
      const signal = normalizePendingSignal(payload);
      if (numericField(signal, 'id') > 0) {
        await replacePendingSignalPg(q, signal);
        return;
      }
      const account = accountId(signal);
      const symbol = symbolOrDefault(signal);
      signal.id = await nextPendingSignalIdPg(q, account, symbol);
      await q.query(
        "INSERT INTO ea_events (kind, account_id, symbol, payload_json, delivered) VALUES ('pending_signal', $1, $2, $3, 1)",
        [account, symbol, toJson(signal)]
      );
      await insertDecisionEventIfPresent(q, candidateSignalDecisionEvent(signal));
    },

    async getPendingSignals(accountIdValue: string, symbol: string): Promise<EaRecord[]> {
      const rows = await queryRows(q, "SELECT payload_json FROM ea_events WHERE kind = 'pending_signal' AND account_id = $1 AND symbol = $2 ORDER BY id ASC", [accountIdValue, symbol]);
      const signals = rows.map((row) => recordFromJson(asString(row.payload_json)) as EaRecord);
      return pendingSignalsNewestFirst(signals);
    },

    async getPendingSignalById(accountIdValue: string, symbol: string, id: number): Promise<EaRecord | undefined> {
      const rows = await queryRows(q, "SELECT payload_json FROM ea_events WHERE kind = 'pending_signal' AND account_id = $1 AND symbol = $2 ORDER BY id ASC", [accountIdValue, symbol]);
      for (const row of rows) {
        const payload = recordFromJson(asString(row.payload_json)) as EaRecord;
        if (numericField(payload, 'id') === id) {
          return structuredClone(payload);
        }
      }
      return undefined;
    },

    async updatePendingSignalArbitration(id: number, result: string, reason: string): Promise<boolean> {
      return updatePendingSignalPg(q, id, result, reason);
    },

    async expirePendingSignals(nowIso: string): Promise<number> {
      return expirePendingSignalsPg(q, nowIso);
    },

    async saveAIResult(accountIdValue: string, symbol: string, payload: EaRecord): Promise<void> {
      await q.query(
        `INSERT INTO ea_snapshots (kind, account_id, symbol, timeframe, payload_json, updated_at) VALUES ('ai_result', $1, $2, '', $3, CURRENT_TIMESTAMP) ON CONFLICT(kind, account_id, symbol, timeframe) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`,
        [accountIdValue, symbol, toJson({ account_id: accountIdValue, symbol, ...payload })]
      );
    },

    async getAIResults(accountIdValue: string): Promise<EaRecord[]> {
      const rows = await queryRows(q, "SELECT payload_json FROM ea_snapshots WHERE kind = 'ai_result' AND account_id = $1 ORDER BY id ASC", [accountIdValue]);
      return rows.map((row) => recordFromJson(asString(row.payload_json)) as EaRecord);
    },

    async saveApiToken(payload: StoredApiTokenInput): Promise<void> {
      const token = normalizeApiToken(payload);
      await q.query(
        `INSERT INTO tokens (token, name, is_admin, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT(token) DO UPDATE SET name = excluded.name, is_admin = excluded.is_admin`,
        [token.token, token.name, boolToInt(token.is_admin), token.created_at]
      );
      await q.query('DELETE FROM token_accounts WHERE token = $1', [token.token]);
      for (const account of token.accounts) {
        await q.query(
          'INSERT INTO token_accounts (token, account_id) VALUES ($1, $2) ON CONFLICT(token, account_id) DO NOTHING',
          [token.token, account]
        );
      }
    },

    async listApiTokens(): Promise<StoredApiToken[]> {
      const tokenRows = await queryRows(q, 'SELECT token, name, is_admin, created_at FROM tokens ORDER BY created_at ASC, token ASC', []);
      const out: StoredApiToken[] = [];
      for (const row of tokenRows) {
        const accountRows = await queryRows(q, 'SELECT account_id FROM token_accounts WHERE token = $1 ORDER BY account_id ASC', [asString(row.token)]);
        out.push({
          token: asString(row.token),
          name: asString(row.name),
          accounts: accountRows.map((accountRow) => asString(accountRow.account_id)),
          is_admin: asNumber(row.is_admin) !== 0,
          created_at: asString(row.created_at)
        });
      }
      return out;
    },

    async deleteApiToken(token: string): Promise<boolean> {
      await q.query('DELETE FROM token_accounts WHERE token = $1', [token]);
      const changes = await queryRowCount(q, 'DELETE FROM tokens WHERE token = $1', [token]);
      return changes > 0;
    },

    async listAccountIds(): Promise<string[]> {
      const snapshotRows = await queryRows(q, 'SELECT DISTINCT account_id FROM ea_snapshots ORDER BY account_id ASC', []);
      const eventRows = await queryRows(q, 'SELECT DISTINCT account_id FROM ea_events ORDER BY account_id ASC', []);
      const out: string[] = [];
      for (const row of snapshotRows) {
        appendUnique(out, asString(row.account_id));
      }
      for (const row of eventRows) {
        appendUnique(out, asString(row.account_id));
      }
      return out;
    },

    async listSymbols(accountIdValue: string): Promise<string[]> {
      const rows = await queryRows(q, "SELECT DISTINCT symbol FROM ea_snapshots WHERE account_id = $1 AND symbol <> '' AND kind IN ('tick', 'bars', 'positions') ORDER BY symbol ASC", [accountIdValue]);
      const out: string[] = [];
      for (const row of rows) {
        appendUnique(out, asString(row.symbol));
      }
      return out;
    },

    async listAISymbols(accountIdValue: string): Promise<string[]> {
      const registration = await this.getRegistration(accountIdValue);
      const aiSymbols = stringArrayField(registration, 'ai_symbols');
      if (aiSymbols.length > 0) {
        return aiSymbols;
      }
      const heartbeat = await this.getHeartbeat(accountIdValue);
      const heartbeatSymbols = stringArrayField(heartbeat, 'ai_symbols');
      if (heartbeatSymbols.length > 0) {
        return heartbeatSymbols;
      }
      return (await this.listSymbols(accountIdValue)).sort();
    },

    async close(): Promise<void> {
      await pool.end();
    }
  };

  return store;
}
