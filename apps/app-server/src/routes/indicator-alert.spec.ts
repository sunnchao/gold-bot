import { describe, expect, it } from 'vitest';
import {
  createIndicatorAlertCache,
  handleIndicatorAlertRoute,
  type IndicatorAlert,
  type IndicatorAlertRouteDeps,
  type IndicatorAlertRouteRequest
} from './indicator-alert.js';

const routeToken = 'test-token';

describe('indicator alert route', () => {
  it('keeps the original alert payload when a duplicate is suppressed within the TTL', () => {
    const alerts = createIndicatorAlertCache(() => 1772342400000);
    const deps: IndicatorAlertRouteDeps = {
      validTokens: new Set([routeToken]),
      alerts
    };
    const original: IndicatorAlert = {
      id: 'alert_1',
      type: 'divergence',
      indicator: 'RSI',
      direction: 'bullish',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      time: '2026-04-13T08:00:00.000Z',
      price: 3335.75,
      strength: 'strong',
      confidence: 0.82,
      description: 'RSI bullish divergence A',
      rsi_divergence: 'bullish'
    };
    const suppressedDuplicate: IndicatorAlert = {
      ...original,
      id: 'alert_2',
      time: '2026-04-13T08:05:00.000Z',
      price: 3340.25,
      confidence: 0.44,
      description: 'RSI bullish divergence B'
    };

    const first = handleIndicatorAlertRoute(storeRequest(original), deps);
    const second = handleIndicatorAlertRoute(storeRequest(suppressedDuplicate), deps);
    const recent = alerts.recent();
    const poll = handleIndicatorAlertRoute(pollRequest(), deps);

    expect(first.body).toEqual({ status: 'ok', should_send: true });
    expect(second.body).toEqual({ status: 'ok', should_send: false });
    expect(recent).toEqual([original]);
    expect(poll.body).toEqual({ status: 'ok', count: 1, alerts: [original] });
  });
});

function storeRequest(alert: IndicatorAlert): IndicatorAlertRouteRequest {
  return {
    method: 'POST',
    path: '/indicator_alert/store',
    headers: { 'X-API-Token': routeToken },
    url: '/indicator_alert/store',
    rawBody: JSON.stringify(alert)
  };
}

function pollRequest(): IndicatorAlertRouteRequest {
  return {
    method: 'POST',
    path: '/indicator_alert/poll',
    headers: { 'X-API-Token': routeToken },
    url: '/indicator_alert/poll',
    rawBody: JSON.stringify({ account_id: 'ignored-by-go' })
  };
}
