import type { HeaderMap } from '@gold-bot/shared-contracts';
import type { EaRecord, EaStore } from '@gold-bot/persistence';
import { eventStreamHeaders } from '@gold-bot/observability';
import { authorizeRouteAccount, requireAdminRoute, requireRouteToken } from '../middleware/auth.js';
import { error, type JsonResponse } from '../http/response.js';

export type AdminRouteRequest = {
  method: string;
  path: string;
  headers: HeaderMap;
  url: string;
};

export type AdminRouteDeps = {
  store: EaStore;
  nowIso: () => string;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
};

export type AdminRouteHelpers = {
  tradingCoreAnalysis: (store: EaStore, accountId: string, symbol: string, timestamp: string) => EaRecord;
  accountDetail: (store: EaStore, accountId: string, timestamp: string) => EaRecord;
  accountSummaries: (store: EaStore) => EaRecord[];
  overviewCards: (accounts: EaRecord[]) => EaRecord[];
  buildAuditBody: (store: EaStore, timestamp: string) => EaRecord;
  eventStreamSnapshot: (store: EaStore, timestamp: string) => string;
};

export function handleAdminRoute(request: AdminRouteRequest, deps: AdminRouteDeps, helpers: AdminRouteHelpers): JsonResponse {
  const parts = request.path.split('/').filter(Boolean);

  const isAccountBoundRead =
    (parts[0] === 'api' && parts[1] === 'symbols' && parts[2] != null && parts.length === 3) ||
    (parts[0] === 'api' && parts[1] === 'ai_symbols' && parts[2] != null && parts.length === 3) ||
    (parts[0] === 'api' && parts[1] === 'pending_signal' && parts[2] != null && parts[3] != null && parts.length === 4);

  const isAdminRead =
    (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'accounts') ||
    (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'overview') ||
    (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'audit') ||
    (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'events' && parts[3] === 'stream');

  if (parts[0] === 'api' && parts[1] === 'trigger_ai' && parts.length === 2) {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        message: 'AI analysis is now handled by Gateway Cron tasks. This endpoint is deprecated.',
        deprecated: true
      }
    };
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'v1' &&
    parts[2] === 'analysis' &&
    parts[3] != null &&
    parts[4] != null &&
    parts[5] === 'trading-core' &&
    parts.length === 6
  ) {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeRouteAccount(deps.tokenAccounts, tokenResult.token, parts[3], deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return {
      statusCode: 200,
      body: helpers.tradingCoreAnalysis(deps.store, parts[3], parts[4], deps.nowIso())
    };
  }
  if (request.method !== 'GET') {
    return error(405, 'method not allowed');
  }
  if (isAccountBoundRead) {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    const accountId = parts[2]!;
    if (!authorizeRouteAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
      return error(403, 'forbidden');
    }
  }
  if (isAdminRead) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
  }

  if (parts[0] === 'api' && parts[1] === 'symbols' && parts[2] != null && parts.length === 3) {
    return {
      statusCode: 200,
      body: deps.store.listSymbols(parts[2])
    };
  }
  if (parts[0] === 'api' && parts[1] === 'ai_symbols' && parts[2] != null && parts.length === 3) {
    return {
      statusCode: 200,
      body: deps.store.listAISymbols(parts[2])
    };
  }
  if (parts[0] === 'api' && parts[1] === 'pending_signal' && parts[2] != null && parts[3] != null && parts.length === 4) {
    return {
      statusCode: 200,
      body: deps.store.getPendingSignals(parts[2], parts[3])
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'accounts' && parts.length === 3) {
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        accounts: helpers.accountSummaries(deps.store)
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'accounts' && parts[3] != null && parts.length === 4) {
    return {
      statusCode: 200,
      body: helpers.accountDetail(deps.store, parts[3], deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'overview' && parts.length === 3) {
    const accounts = helpers.accountSummaries(deps.store);
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        generated_at: deps.nowIso(),
        cards: helpers.overviewCards(accounts),
        accounts
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'audit' && parts.length === 3) {
    return {
      statusCode: 200,
      body: helpers.buildAuditBody(deps.store, deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'events' && parts[3] === 'stream' && parts.length === 4) {
    return {
      statusCode: 200,
      headers: eventStreamHeaders(),
      body: null,
      rawBody: helpers.eventStreamSnapshot(deps.store, deps.nowIso())
    };
  }

  return error(404, 'not found');
}
