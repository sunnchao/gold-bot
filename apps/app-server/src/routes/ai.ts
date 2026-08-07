import type { EaRecord, EaStore } from '@gold-bot/persistence';
import type { DiscordNotifier, FeishuNotifier } from '@gold-bot/notifications';
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
  discord: DiscordNotifier | null;
  feishu: FeishuNotifier | null;
};

export type AIRouteHelpers = {
  analysisPayload: (store: EaStore, accountId: string, symbol: string, timestamp: string) => Promise<EaRecord>;
  handleAIResultRoute: (method: string, accountId: string, symbol: string, rawBody: string, deps: AIRouteDeps) => Promise<JsonResponse>;
};

export async function handleAIRoute(request: AIRouteRequest, deps: AIRouteDeps, helpers: AIRouteHelpers): Promise<JsonResponse> {
  const parts = request.path.split('/').filter(Boolean);
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  if (parts[0] === 'api' && parts[1] === 'analysis_payload' && parts[2] != null && parts.length === 3) {
    const accountId = decode(parts[2]);
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return {
      statusCode: 200,
      body: await helpers.analysisPayload(deps.store, accountId, 'XAUUSD', deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'analysis_payload' && parts[3] != null && parts[4] != null && parts.length === 5) {
    const accountId = decode(parts[3]);
    const symbol = decode(parts[4]);
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return {
      statusCode: 200,
      body: await helpers.analysisPayload(deps.store, accountId, symbol, deps.nowIso())
    };
  }
  if (parts[0] === 'api' && parts[1] === 'ai_result' && parts[2] != null && parts.length === 3) {
    const accountId = decode(parts[2]);
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return await helpers.handleAIResultRoute(request.method, accountId, 'XAUUSD', request.rawBody, deps);
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'ai_result' && parts[3] != null && parts[4] != null && parts.length === 5) {
    const accountId = decode(parts[3]);
    const symbol = decode(parts[4]);
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
      return error(403, 'forbidden');
    }
    return await helpers.handleAIResultRoute(request.method, accountId, symbol, request.rawBody, deps);
  }

  return error(404, 'not found');
}
