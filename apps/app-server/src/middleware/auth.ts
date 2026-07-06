import { extractAuthToken, type HeaderMap } from '@gold-bot/shared-contracts';
import { error, type JsonResponse } from '../http/response.js';

export function extractRouteToken(headers: HeaderMap, url: string): string | undefined {
  return extractAuthToken(headers, url);
}

export function authorizeRouteAccount(
  tokenAccounts: Map<string, Set<string>> | null,
  token: string | undefined,
  accountId: string,
  adminTokens: Set<string>
): boolean {
  if (tokenAccounts == null) {
    return true;
  }
  if (token == null) {
    return false;
  }
  if (adminTokens.has(token)) {
    return true;
  }
  const accounts = tokenAccounts.get(token);
  if (accounts == null || accounts.size === 0) {
    tokenAccounts.set(token, new Set([accountId]));
    return true;
  }
  return accounts.has(accountId);
}

export function authorizeApiAccount(
  tokenAccounts: Map<string, Set<string>> | null,
  token: string | undefined,
  accountId: string,
  adminTokens: Set<string>
): boolean {
  if (tokenAccounts == null) {
    return true;
  }
  if (token == null) {
    return false;
  }
  if (adminTokens.has(token)) {
    return true;
  }
  return tokenAccounts.get(token)?.has(accountId) === true;
}

export function requireRouteToken(
  validTokens: Set<string> | null,
  headers: HeaderMap,
  url: string
): { token?: string; response?: JsonResponse } {
  const token = extractRouteToken(headers, url);
  if (token == null || validTokens == null || !validTokens.has(token)) {
    return {
      response: error(401, 'invalid token')
    };
  }
  return { token };
}

export function requireAdminRoute(
  validTokens: Set<string> | null,
  adminTokens: Set<string>,
  headers: HeaderMap,
  url: string
): { token?: string; response?: JsonResponse } {
  const tokenResult = requireRouteToken(validTokens, headers, url);
  if (tokenResult.response != null) {
    return tokenResult;
  }
  if (tokenResult.token == null || !adminTokens.has(tokenResult.token)) {
    return {
      response: error(403, 'admin only')
    };
  }
  return tokenResult;
}
