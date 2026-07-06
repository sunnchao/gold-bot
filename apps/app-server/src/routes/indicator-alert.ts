import type { EaRecord } from '@gold-bot/persistence';
import type { HeaderMap } from '@gold-bot/shared-contracts';
import { error, type JsonResponse } from '../http/response.js';
import { requireRouteToken } from '../middleware/auth.js';

const ALERT_TTL_MS = 4 * 60 * 60 * 1000;

export type IndicatorAlert = EaRecord & {
  id?: string;
  type?: string;
  indicator?: string;
  direction?: string;
  symbol?: string;
  timeframe?: string;
  time?: string;
  price?: number;
  strength?: string;
  confidence?: number;
  description?: string;
  macd_divergence?: string;
  rsi_divergence?: string;
};

export type IndicatorAlertCache = {
  add(alert: IndicatorAlert): boolean;
  recent(): IndicatorAlert[];
};

type CachedAlert = {
  alert: IndicatorAlert;
  lastSentAtMs: number;
  count: number;
};

export type IndicatorAlertRouteRequest = {
  method: string;
  path: string;
  headers: HeaderMap;
  url: string;
  rawBody: string;
};

export type IndicatorAlertRouteDeps = {
  validTokens: Set<string> | null;
  alerts: IndicatorAlertCache;
};

export function createIndicatorAlertCache(nowMs: () => number): IndicatorAlertCache {
  const alerts = new Map<string, CachedAlert>();
  return {
    add(alert) {
      const key = alertKey(alert);
      const now = nowMs();
      const existing = alerts.get(key);
      if (existing == null || now - existing.lastSentAtMs >= ALERT_TTL_MS) {
        alerts.set(key, { alert: structuredClone(alert), lastSentAtMs: now, count: (existing?.count ?? 0) + 1 });
        return true;
      }
      existing.count += 1;
      return false;
    },
    recent() {
      const cutoff = nowMs() - ALERT_TTL_MS;
      return Array.from(alerts.values())
        .filter((entry) => entry.lastSentAtMs > cutoff)
        .map((entry) => structuredClone(entry.alert));
    }
  };
}

export function handleIndicatorAlertRoute(request: IndicatorAlertRouteRequest, deps: IndicatorAlertRouteDeps): JsonResponse {
  const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
  if (tokenResult.response != null) {
    return tokenResult.response;
  }
  if (request.method !== 'POST') {
    return error(405, 'method not allowed');
  }

  const parsed = parseStrictJsonObject(request.rawBody);
  if (!parsed.ok) {
    return error(400, 'invalid json');
  }

  if (request.path === '/indicator_alert/store') {
    if (!isGoDecodableIndicatorAlert(parsed.body)) {
      return error(400, 'invalid json');
    }
    const alert = sanitizeIndicatorAlert(parsed.body);
    return {
      statusCode: 200,
      body: {
        status: 'ok',
        should_send: deps.alerts.add(alert)
      }
    };
  }
  if (request.path === '/indicator_alert/poll') {
    const accountId = parsed.body.account_id;
    if (accountId != null && typeof accountId !== 'string') {
      return error(400, 'invalid json');
    }
    const alerts = deps.alerts.recent();
    return {
      statusCode: 200,
      body: {
        status: 'ok',
        count: alerts.length,
        alerts
      }
    };
  }
  return error(404, 'not found');
}

const GO_STRING_FIELDS = [
  'id',
  'type',
  'indicator',
  'direction',
  'symbol',
  'timeframe',
  'time',
  'strength',
  'description',
  'macd_divergence',
  'rsi_divergence'
] as const;

const GO_NUMBER_FIELDS = ['price', 'confidence'] as const;
const GO_ALERT_FIELDS = [...GO_STRING_FIELDS, ...GO_NUMBER_FIELDS] as const;

function parseStrictJsonObject(rawBody: string): { ok: true; body: EaRecord } | { ok: false } {
  if (rawBody.trim().length === 0) {
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, body: parsed as EaRecord };
  } catch {
    return { ok: false };
  }
}

function isGoDecodableIndicatorAlert(record: EaRecord): boolean {
  for (const field of GO_STRING_FIELDS) {
    const value = record[field];
    if (value != null && typeof value !== 'string') {
      return false;
    }
  }
  for (const field of GO_NUMBER_FIELDS) {
    const value = record[field];
    if (value != null && typeof value !== 'number') {
      return false;
    }
  }
  return true;
}

function sanitizeIndicatorAlert(record: EaRecord): IndicatorAlert {
  const alert: EaRecord = {};
  for (const field of GO_ALERT_FIELDS) {
    const value = record[field];
    if (value != null) {
      alert[field] = value;
    }
  }
  return alert;
}

function alertKey(alert: IndicatorAlert): string {
  return `${stringField(alert, 'symbol')}_${stringField(alert, 'indicator')}_${stringField(alert, 'direction')}`;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}
