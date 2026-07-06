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
      return ok({ status: 'OK', message: 'registered' });
    case '/heartbeat': {
      const heartbeatAt = deps.nowIso();
      parsed.body.mt4_server_time = helpers.stringFieldOrEmpty(parsed.body, 'server_time');
      parsed.body.last_heartbeat_at = heartbeatAt;
      parsed.body.updated_at = heartbeatAt;
      await deps.store.saveHeartbeat(parsed.body);
      return ok({ status: 'OK', server_time: deps.nowUnix() });
    }
    case '/tick':
      await deps.store.saveTick(parsed.body);
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
