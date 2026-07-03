import type { EaRecord, EaStore } from '@gold-bot/persistence';
import type { AIApproveCooldown } from '../services/ai-approve/gate.js';
import type { CommandLifecycleService } from '../services/command-lifecycle/service.js';
import type { ShadowService } from '../services/shadow/service.js';
import type { HeaderMap } from '@gold-bot/shared-contracts';
import type { SseEvent, SseHub } from '@gold-bot/observability';
import { authorizeApiAccount, requireRouteToken } from '../middleware/auth.js';
import { error, type JsonResponse } from '../http/response.js';

export type AIRouteRequest = {
  method: string;
  path: string;
  headers: HeaderMap;
  url: string;
  rawBody: string;
};

export type AIRouteDeps = {
  store: EaStore;
  nowIso: () => string;
  commandLifecycle: CommandLifecycleService;
  shadow: ShadowService;
  events: SseHub<SseEvent>;
  aiApproveCooldown: AIApproveCooldown;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
};

export type AIRouteHelpers = {
  analysisPayload: (store: EaStore, accountId: string, symbol: string, timestamp: string) => EaRecord;
  handleAIResultRoute: (method: string, accountId: string, symbol: string, rawBody: string, deps: AIRouteDeps) => JsonResponse;
};

export function handleAIRoute(request: AIRouteRequest, deps: AIRouteDeps, helpers: AIRouteHelpers): JsonResponse {
  const parts = request.path.split('/').filter(Boolean);

  if (parts[0] === 'api' && parts[1] === 'analysis_payload' && parts[2] != null && parts.length === 3 && request.method === 'GET') {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, parts[2], deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return {
      statusCode: 200,
      body: helpers.analysisPayload(deps.store, parts[2], 'XAUUSD', deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'analysis_payload' && parts[3] != null && parts[4] != null && parts.length === 5 && request.method === 'GET') {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, parts[3], deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return {
      statusCode: 200,
      body: helpers.analysisPayload(deps.store, parts[3], parts[4], deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'ai_result' && parts[2] != null && parts.length === 3) {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, parts[2], deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return helpers.handleAIResultRoute(request.method, parts[2], 'XAUUSD', request.rawBody, deps);
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'ai_result' && parts[3] != null && parts[4] != null && parts.length === 5) {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, parts[3], deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return helpers.handleAIResultRoute(request.method, parts[3], parts[4], request.rawBody, deps);
  }

  return error(404, 'not found');
}
