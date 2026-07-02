import type { EaRecord } from '@gold-bot/persistence';
import type { HeaderMap } from '@gold-bot/shared-contracts';
import { parseJsonObject } from '../http/json.js';
import { error, type JsonResponse } from '../http/response.js';
import { requireRouteToken } from '../middleware/auth.js';

const ALERT_TTL_MS = 4 * 60 * 60 * 1000;

export type IndicatorAlert = EaRecord & {
  id?: string | number;
  type?: string;
  indicator?: string;
  direction?: string;
  symbol?: string;
  timeframe?: string;
  time?: string;
  price?: number;
  strength?: number;
  confidence?: number;
  description?: string;
  macd_divergence?: boolean;
  rsi_divergence?: boolean;
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
      existing.alert = structuredClone(alert);
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

  const parsed = parseJsonObject(request.rawBody);
  if (!parsed.ok) {
    return error(400, 'invalid json');
  }

  if (request.path === '/indicator_alert/store') {
    return {
      statusCode: 200,
      body: {
        status: 'ok',
        should_send: deps.alerts.add(parsed.body as IndicatorAlert)
      }
    };
  }
  if (request.path === '/indicator_alert/poll') {
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

function alertKey(alert: IndicatorAlert): string {
  return `${stringField(alert, 'symbol')}_${stringField(alert, 'indicator')}_${stringField(alert, 'direction')}`;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}
