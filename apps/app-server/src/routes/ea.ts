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
  validateEaPayload: (path: string, body: EaRecord, store: EaStore) => string | null;
};

export function handleEaRoute(request: EaRouteRequest, deps: EaRouteDeps, helpers: EaRouteHelpers): JsonResponse {
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

  const validationError = helpers.validateEaPayload(request.path, parsed.body, deps.store);
  if (validationError != null) {
    return error(400, validationError);
  }

  switch (request.path) {
    case '/register':
      deps.store.saveRegistration(parsed.body);
      return ok({ status: 'OK', message: 'registered' });
    case '/heartbeat':
      deps.store.saveHeartbeat(parsed.body);
      return ok({ status: 'OK', server_time: deps.nowUnix() });
    case '/tick':
      deps.store.saveTick(parsed.body);
      return ok({ status: 'OK' });
    case '/bars':
      deps.store.saveBars(parsed.body);
      deps.onBarsSaved?.(accountId, helpers.symbolOrDefault(parsed.body), helpers.stringFieldOrEmpty(parsed.body, 'timeframe'));
      return ok({
        status: 'OK',
        received: Array.isArray(parsed.body.bars) ? parsed.body.bars.length : 0
      });
    case '/positions':
      deps.store.savePositions(parsed.body);
      deps.onPositionsSaved?.(accountId, helpers.symbolOrDefault(parsed.body));
      return ok({
        status: 'OK',
        count: Array.isArray(parsed.body.positions) ? parsed.body.positions.length : 0
      });
    case '/poll': {
      const commands = deps.store.pollCommands(accountId);
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
        helpers.stringFieldOrEmpty(parsed.body, 'error') || helpers.stringFieldOrEmpty(parsed.body, 'error_text'),
        deps.nowIso()
      );
      if (deps.onOrderResult == null) {
        deps.store.saveOrderResult(parsed.body);
      }
      return ok({ status: 'OK' });
    default:
      return error(404, 'not found');
  }
}
