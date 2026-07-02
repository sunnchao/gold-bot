import type { EaRecord, EaStore } from '@gold-bot/persistence';
import { error, type JsonResponse } from '../http/response.js';

export type AIRouteRequest = {
  method: string;
  path: string;
  rawBody: string;
};

export type AIRouteDeps = {
  store: EaStore;
  nowIso: () => string;
};

export type AIRouteHelpers = {
  analysisPayload: (store: EaStore, accountId: string, symbol: string, timestamp: string) => EaRecord;
  handleAIResultRoute: (method: string, accountId: string, symbol: string, rawBody: string, deps: AIRouteDeps) => JsonResponse;
};

export function handleAIRoute(request: AIRouteRequest, deps: AIRouteDeps, helpers: AIRouteHelpers): JsonResponse {
  const parts = request.path.split('/').filter(Boolean);

  if (parts[0] === 'api' && parts[1] === 'analysis_payload' && parts[2] != null && parts.length === 3 && request.method === 'GET') {
    return {
      statusCode: 200,
      body: helpers.analysisPayload(deps.store, parts[2], 'XAUUSD', deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'analysis_payload' && parts[3] != null && parts[4] != null && parts.length === 5 && request.method === 'GET') {
    return {
      statusCode: 200,
      body: helpers.analysisPayload(deps.store, parts[3], parts[4], deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'ai_result' && parts[2] != null && parts.length === 3) {
    return helpers.handleAIResultRoute(request.method, parts[2], 'XAUUSD', request.rawBody, deps);
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'ai_result' && parts[3] != null && parts[4] != null && parts.length === 5) {
    return helpers.handleAIResultRoute(request.method, parts[3], parts[4], request.rawBody, deps);
  }

  return error(404, 'not found');
}
