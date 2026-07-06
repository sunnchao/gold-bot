import type { HeaderMap } from '@gold-bot/shared-contracts';
import type { EaRecord, EaStore } from '@gold-bot/persistence';
import { parseJsonObject } from '../http/json.js';
import { error, ok, type JsonResponse } from '../http/response.js';
import { authorizeRouteAccount, extractRouteToken } from '../middleware/auth.js';

export type EaRouteRequest = {
  method: string;
  path: string;
  url: string;
  headers: HeaderMap;
  rawBody: string;
};

export type EaRouteDeps = {
  store: EaStore;
  nowUnix: () => number;
  nowIso: () => string;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
  log?: (message: string) => void;
  onBarsSaved?: (accountId: string, symbol: string, timeframe: string) => void;
  onPositionsSaved?: (accountId: string, symbol: string) => void;
  onOrderResult?: (accountId: string, commandId: string, result: string, ticket?: number, errorText?: string, createdAt?: string) => void;
};

export type EaRouteHelpers = {
  stringFieldOrEmpty: (record: EaRecord, field: string) => string;
  symbolOrDefault: (record: EaRecord) => string;
  validateEaPayload: (path: string, body: EaRecord, store: EaStore) => Promise<string | null>;
};

export async function handleEaRoute(request: EaRouteRequest, deps: EaRouteDeps, helpers: EaRouteHelpers): Promise<JsonResponse> {
  if (deps.validTokens != null) {
    const token = extractRouteToken(request.headers, request.url);
    if (token == null || !deps.validTokens.has(token)) {
      return error(401, 'invalid token');
    }
  }

  const parsed = parseJsonObject(request.rawBody);
  if (!parsed.ok) {
    return error(400, 'invalid JSON');
  }

  const accountId = helpers.stringFieldOrEmpty(parsed.body, 'account_id').trim();
  if (accountId.length === 0) {
    return error(400, 'missing account_id');
  }

  const token = extractRouteToken(request.headers, request.url);
  if (!authorizeRouteAccount(deps.tokenAccounts, token, accountId, deps.adminTokens)) {
    return error(403, 'token not authorized for account');
  }

  const validationError = await helpers.validateEaPayload(request.path, parsed.body, deps.store);
  if (validationError != null) {
    return error(400, validationError);
  }

  switch (request.path) {
    case '/register':
      await deps.store.saveRegistration(parsed.body);
      logEaLifecycle(deps.log, 'register', parsed.body);
      return ok({ status: 'OK', message: 'registered' });
    case '/heartbeat': {
      const heartbeatAt = deps.nowIso();
      parsed.body.mt4_server_time = helpers.stringFieldOrEmpty(parsed.body, 'server_time');
      parsed.body.last_heartbeat_at = heartbeatAt;
      parsed.body.updated_at = heartbeatAt;
      await deps.store.saveHeartbeat(parsed.body);
      logEaLifecycle(deps.log, 'heartbeat', parsed.body);
      return ok({ status: 'OK', server_time: deps.nowUnix() });
    }
    case '/tick':
      await deps.store.saveTick(parsed.body);
      logEaLifecycle(deps.log, 'tick', parsed.body);
      return ok({ status: 'OK' });
    case '/bars':
      await deps.store.saveBars(parsed.body);
      deps.onBarsSaved?.(accountId, helpers.symbolOrDefault(parsed.body), helpers.stringFieldOrEmpty(parsed.body, 'timeframe'));
      return ok({
        status: 'OK',
        received: Array.isArray(parsed.body.bars) ? parsed.body.bars.length : 0
      });
    case '/positions':
      await deps.store.savePositions(parsed.body);
      deps.onPositionsSaved?.(accountId, helpers.symbolOrDefault(parsed.body));
      return ok({
        status: 'OK',
        count: Array.isArray(parsed.body.positions) ? parsed.body.positions.length : 0
      });
    case '/poll': {
      const commands = await deps.store.pollCommands(accountId);
      return ok({
        status: 'OK',
        commands,
        count: commands.length
      });
    }
    case '/order_result':
      deps.onOrderResult?.(
        accountId,
        helpers.stringFieldOrEmpty(parsed.body, 'command_id'),
        helpers.stringFieldOrEmpty(parsed.body, 'result'),
        typeof parsed.body.ticket === 'number' ? parsed.body.ticket : undefined,
        helpers.stringFieldOrEmpty(parsed.body, 'error'),
        deps.nowIso()
      );
      if (deps.onOrderResult == null) {
        await deps.store.saveOrderResult(parsed.body);
      }
      return ok({ status: 'OK' });
    default:
      return error(404, 'not found');
  }
}

type EaLifecycleLogKind = 'register' | 'heartbeat' | 'tick';

const EA_LIFECYCLE_LOG_PREFIX: Record<EaLifecycleLogKind, string> = {
  register: '[EA-REGISTER]',
  heartbeat: '[EA-HEARTBEAT]',
  tick: '[EA-TICK]'
};

const EA_LIFECYCLE_LOG_FIELDS: Record<EaLifecycleLogKind, readonly string[]> = {
  register: ['account_id', 'broker', 'server_name', 'account_name', 'account_type', 'currency', 'leverage', 'strategies', 'ai_symbols'],
  heartbeat: ['account_id', 'balance', 'equity', 'margin', 'free_margin', 'market_open', 'is_trade_allowed', 'server_time', 'ai_symbols'],
  tick: ['account_id', 'symbol', 'bid', 'ask', 'spread', 'time']
};

function logEaLifecycle(log: ((message: string) => void) | undefined, kind: EaLifecycleLogKind, body: EaRecord): void {
  log?.(formatEaLifecycleLog(kind, body));
}

function formatEaLifecycleLog(kind: EaLifecycleLogKind, body: EaRecord): string {
  const fields = EA_LIFECYCLE_LOG_FIELDS[kind].map((field) => `${field}=${formatEaLifecycleField(body, field)}`);
  return `${EA_LIFECYCLE_LOG_PREFIX[kind]} ${fields.join(' ')}`;
}

function formatEaLifecycleField(body: EaRecord, field: string): string {
  if (field === 'strategies') {
    return formatStrategyMapping(body.strategy_mapping);
  }
  return formatLogValue(body[field]);
}

function formatStrategyMapping(value: unknown): string {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return formatLogValue(value);
  }
  return Object.entries(value as EaRecord)
    .map(([key, mapped]) => `${sanitizeLogText(key)}:${sanitizeLogText(mapped)}`)
    .join(',');
}

function formatLogValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeLogText).join(',');
  }
  if (typeof value === 'object') {
    return Object.keys(value as EaRecord).sort().map(sanitizeLogText).join(',');
  }
  return sanitizeLogText(value);
}

function sanitizeLogText(value: unknown): string {
  return String(value).replace(/[\r\n\t]+/g, ' ').trim();
}
