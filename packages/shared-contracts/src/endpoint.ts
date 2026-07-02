export const EA_COMPAT_ENDPOINTS = [
  '/register',
  '/heartbeat',
  '/tick',
  '/bars',
  '/positions',
  '/poll',
  '/order_result'
] as const;

export type EaCompatEndpoint = (typeof EA_COMPAT_ENDPOINTS)[number];

const endpointSet = new Set<string>(EA_COMPAT_ENDPOINTS);

export function isEaCompatEndpoint(value: string): value is EaCompatEndpoint {
  return endpointSet.has(value);
}

export type HeaderMap = Record<string, string | string[] | undefined>;

export function extractAuthToken(headers: HeaderMap, url: string): string | undefined {
  return firstHeader(headers, 'X-API-Token') ?? firstHeader(headers, 'X-API-Key') ?? queryToken(url);
}

function firstHeader(headers: HeaderMap, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }
    const token = Array.isArray(value) ? value[0] : value;
    return token != null && token.length > 0 ? token : undefined;
  }
  return undefined;
}

function queryToken(url: string): string | undefined {
  const token = new URL(url, 'http://localhost').searchParams.get('token');
  return token != null && token.length > 0 ? token : undefined;
}
