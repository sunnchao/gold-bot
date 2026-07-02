import type { EaRecord, EaStore } from '@gold-bot/persistence';
import { error, type JsonResponse } from '../http/response.js';

export type AdminRouteRequest = {
  method: string;
  path: string;
};

export type AdminRouteDeps = {
  store: EaStore;
  nowIso: () => string;
};

export type AdminRouteHelpers = {
  tradingCoreAnalysis: (store: EaStore, accountId: string, symbol: string, timestamp: string) => EaRecord;
  accountSummaries: (store: EaStore) => EaRecord[];
  overviewCards: (accounts: EaRecord[]) => EaRecord[];
  auditChecks: () => EaRecord[];
  eventStreamSnapshot: (store: EaStore, timestamp: string) => string;
};

export function handleAdminRoute(request: AdminRouteRequest, deps: AdminRouteDeps, helpers: AdminRouteHelpers): JsonResponse {
  const parts = request.path.split('/').filter(Boolean);
  if (request.method !== 'GET') {
    return error(405, 'method not allowed');
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
    return {
      statusCode: 200,
      body: helpers.tradingCoreAnalysis(deps.store, parts[3], parts[4], deps.nowIso())
    };
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
    const summary = helpers.auditChecks();
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        generated_at: deps.nowIso(),
        summary,
        report: {
          ready: false,
          protocol_error_rate: 0,
          signal_drift_rate: 0,
          command_drift_rate: 0,
          last_shadow_event_at: '0001-01-01T00:00:00Z',
          missing_capabilities: ['shadow_traffic'],
          checks: summary
        },
        events: []
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'events' && parts[3] === 'stream' && parts.length === 4) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      },
      body: null,
      rawBody: helpers.eventStreamSnapshot(deps.store, deps.nowIso())
    };
  }

  return error(404, 'not found');
}
