import type { HeaderMap } from '@gold-bot/shared-contracts';
import type { EaRecord, EaStore } from '@gold-bot/persistence';
import { eventStreamHeaders } from '@gold-bot/observability';
import { randomBytes } from 'node:crypto';
import { authorizeRouteAccount, requireAdminRoute, requireRouteToken } from '../middleware/auth.js';
import { parseJsonObject } from '../http/json.js';
import { error, type JsonResponse } from '../http/response.js';

export type ApiTokenRecord = {
  token: string;
  name: string;
  accounts: string[];
  isAdmin: boolean;
};

export type AdminRouteRequest = {
  method: string;
  path: string;
  headers: HeaderMap;
  url: string;
  rawBody: string;
};

export type AdminRouteDeps = {
  store: EaStore;
  nowIso: () => string;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
  tokenRecords: Map<string, ApiTokenRecord>;
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
  if (
    parts[0] === 'api' &&
    parts[1] === 'v1' &&
    parts[2] === 'accounts' &&
    parts[3] != null &&
    parts[4] === 'decisions' &&
    parts.length === 5
  ) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (request.method !== 'GET') {
      return { ...error(405, 'method not allowed'), headers: { Allow: 'GET' } };
    }
    const query = new URL(request.url, 'http://localhost').searchParams;
    const rawLimit = query.get('limit')?.trim() ?? '';
    const limit = parseDecisionLimit(rawLimit);
    if (limit === null) {
      return error(400, 'limit must be a positive integer');
    }
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        account_id: parts[3],
        decision_events: deps.store.listDecisionEvents({
          account_id: parts[3],
          symbol: query.get('symbol')?.trim() ?? '',
          status: query.get('status')?.trim() ?? '',
          ...(limit == null ? {} : { limit })
        })
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'arbitration' && parts[2] === 'expire' && parts.length === 3) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (request.method !== 'POST') {
      return error(405, 'method not allowed');
    }
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        expired: deps.store.expirePendingSignals(deps.nowIso())
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'arbitration' && parts[2] != null && parts.length === 3) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (request.method !== 'POST') {
      return error(405, 'method not allowed');
    }
    const signalId = Number(parts[2]);
    if (!Number.isSafeInteger(signalId)) {
      return error(400, 'invalid signal_id');
    }
    const parsed = parseJsonObject(request.rawBody);
    if (!parsed.ok) {
      return error(400, 'invalid JSON');
    }
    const result = stringField(parsed.body, 'result');
    const reason = stringField(parsed.body, 'reason');
    if (result !== 'approved' && result !== 'rejected') {
      return error(400, "result must be 'approved' or 'rejected'");
    }
    if (!deps.store.updatePendingSignalArbitration(signalId, result, reason)) {
      return error(500, `update arbitration for signal ${signalId}: not found`);
    }
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        signal_id: signalId,
        result
      }
    };
  }
  if (parts[0] === 'api' && parts[1] === 'tokens' && parts.length === 2) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (request.method === 'GET') {
      return {
        statusCode: 200,
        body: {
          status: 'OK',
          tokens: listTokenRecords(deps.tokenRecords)
        }
      };
    }
    if (request.method === 'POST') {
      const parsed = parseJsonObject(request.rawBody);
      if (!parsed.ok) {
        return error(400, 'invalid JSON');
      }
      const token = randomBytes(24).toString('base64url');
      const name = stringField(parsed.body, 'name');
      const accounts = stringArrayField(parsed.body, 'accounts');
      deps.validTokens?.add(token);
      deps.tokenAccounts?.set(token, new Set(accounts));
      deps.tokenRecords.set(token, { token, name, accounts, isAdmin: false });
      deps.store.saveApiToken({ token, name, accounts, is_admin: false });
      return {
        statusCode: 200,
        body: {
          status: 'OK',
          token,
          name,
          accounts
        }
      };
    }
    return error(405, 'method not allowed');
  }
  if (parts[0] === 'api' && parts[1] === 'tokens' && parts[2] != null && parts.length === 3) {
    const tokenResult = requireAdminRoute(deps.validTokens, deps.adminTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    if (request.method !== 'DELETE') {
      return error(405, 'method not allowed');
    }
    const token = findTokenByPrefix(deps.tokenRecords, parts[2]);
    if (token == null) {
      return error(404, 'token not found');
    }
    deps.tokenRecords.delete(token);
    deps.validTokens?.delete(token);
    deps.tokenAccounts?.delete(token);
    deps.adminTokens.delete(token);
    deps.store.deleteApiToken(token);
    return {
      statusCode: 200,
      body: {
        status: 'OK',
        revoked: maskToken(token)
      }
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

function parseDecisionLimit(raw: string): number | undefined | null {
  if (raw.length === 0) {
    return undefined;
  }
  if (!/^[0-9]+$/.test(raw)) {
    return null;
  }
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : null;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(record: EaRecord, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function listTokenRecords(records: Map<string, ApiTokenRecord>): EaRecord {
  const out: EaRecord = {};
  for (const record of records.values()) {
    if (!record.isAdmin) {
      out[maskToken(record.token)] = {
        accounts: record.accounts,
        name: record.name,
        full_token: record.token
      };
    }
  }
  return out;
}

function findTokenByPrefix(records: Map<string, ApiTokenRecord>, prefix: string): string | undefined {
  for (const token of records.keys()) {
    if (token === prefix || token.startsWith(prefix)) {
      return token;
    }
  }
  return undefined;
}

function maskToken(token: string): string {
  return token.length <= 8 ? token : `${token.slice(0, 4)}...${token.slice(-4)}`;
}
