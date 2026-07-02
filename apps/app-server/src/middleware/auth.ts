import { extractAuthToken, type HeaderMap } from '@gold-bot/shared-contracts';

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
