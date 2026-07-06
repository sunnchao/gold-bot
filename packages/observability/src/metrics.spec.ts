import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import {
  createHttpMetricsMiddleware,
  createMetricsRegistry,
  createStoreMetricsCollector,
  httpStatusClass,
  normalizeHttpPath
} from './index.js';

describe('createMetricsRegistry', () => {
  it('exposes all goldbot_ metrics with empty output before any observation', async () => {
    const metrics = createMetricsRegistry(false);
    const text = await metrics.registry.metrics();
    expect(text).toContain('goldbot_signals_total');
    expect(text).toContain('goldbot_signal_score');
    expect(text).toContain('goldbot_orders_total');
    expect(text).toContain('goldbot_order_latency_seconds');
    expect(text).toContain('goldbot_order_profit_usd');
    expect(text).toContain('goldbot_account_equity_usd');
    expect(text).toContain('goldbot_account_balance_usd');
    expect(text).toContain('goldbot_account_positions');
    expect(text).toContain('goldbot_account_floating_pl_usd');
    expect(text).toContain('goldbot_account_daily_pl_usd');
    expect(text).toContain('goldbot_ea_last_heartbeat_timestamp');
    expect(text).toContain('goldbot_ea_heartbeats_total');
    expect(text).toContain('goldbot_ea_ticks_total');
    expect(text).toContain('goldbot_http_requests_total');
    expect(text).toContain('goldbot_http_request_duration_seconds');
    expect(text).toContain('goldbot_db_query_duration_seconds');
    expect(text).toContain('goldbot_db_queries_total');
    expect(text).toContain('goldbot_db_connections_open');
    expect(text).toContain('goldbot_db_connections_in_use');
    expect(text).toContain('goldbot_strategy_execution_seconds');
    expect(text).toContain('goldbot_strategy_win_rate');
    expect(text).toContain('goldbot_risk_gate_rejections_total');
    expect(text).toContain('goldbot_spread_points');
  });

  it('increments counters and observes histograms with labels', async () => {
    const metrics = createMetricsRegistry(false);
    metrics.signalsTotal.labels('90011087', 'XAUUSD', 'pullback', 'buy').inc();
    metrics.signalScore.labels('90011087', 'pullback').observe(7);
    metrics.ordersTotal.labels('90011087', 'XAUUSD', 'buy', 'success').inc();
    metrics.httpRequestsTotal.labels('GET', '/metrics', '2xx').inc();

    const text = await metrics.registry.metrics();
    expect(text).toContain('goldbot_signals_total{account_id="90011087",symbol="XAUUSD",strategy="pullback",side="buy"} 1');
    expect(text).toContain('goldbot_http_requests_total{method="GET",path="/metrics",status="2xx"} 1');
  });

  it('sets gauge values from store state', async () => {
    const store = createInMemoryEaStore();
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10500.25,
      balance: 10000,
      floating_pl: 500.25,
      timestamp: 1751750000
    });
    store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.9, ask: 3336.1, spread: 2 });

    const metrics = createMetricsRegistry(false);
    const collector = createStoreMetricsCollector({ metrics, store, now: () => 1751760000000 });
    const snapshot = await collector.collect();

    expect(snapshot.accounts).toBe(1);
    expect(snapshot.heartbeats).toBe(1);
    const text = await metrics.registry.metrics();
    expect(text).toContain('goldbot_account_equity_usd{account_id="90011087"} 10500.25');
    expect(text).toContain('goldbot_account_balance_usd{account_id="90011087"} 10000');
    expect(text).toContain('goldbot_account_floating_pl_usd{account_id="90011087"} 500.25');
    expect(text).toContain('goldbot_ea_last_heartbeat_timestamp{account_id="90011087"} 1751750000');
    expect(text).toContain('goldbot_spread_points{account_id="90011087",symbol="XAUUSD"} 2');
  });

  it('counts positions per symbol from store state', async () => {
    const store = createInMemoryEaStore();
    store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [
        { ticket: 1, symbol: 'XAUUSD', profit: 10 },
        { ticket: 2, symbol: 'XAUUSD', profit: -5 }
      ]
    });

    const metrics = createMetricsRegistry(false);
    const collector = createStoreMetricsCollector({ metrics, store });
    const snapshot = await collector.collect();

    expect(snapshot.positions).toBe(2);
    const text = await metrics.registry.metrics();
    expect(text).toContain('goldbot_account_positions{account_id="90011087",symbol="XAUUSD"} 2');
  });
});

describe('httpStatusClass', () => {
  it('maps status codes to class buckets', () => {
    expect(httpStatusClass(200)).toBe('2xx');
    expect(httpStatusClass(204)).toBe('2xx');
    expect(httpStatusClass(301)).toBe('3xx');
    expect(httpStatusClass(404)).toBe('4xx');
    expect(httpStatusClass(500)).toBe('5xx');
    expect(httpStatusClass(0)).toBe('unknown');
  });
});

describe('normalizeHttpPath', () => {
  it('collapses numeric segments to :id', () => {
    expect(normalizeHttpPath('GET', '/api/accounts/90011087/symbols')).toBe('/api/accounts/:id/symbols');
    expect(normalizeHttpPath('GET', '/')).toBe('/');
    expect(normalizeHttpPath('GET', '/metrics')).toBe('/metrics');
  });
});

describe('createHttpMetricsMiddleware', () => {
  it('records http request counters and durations', async () => {
    const metrics = createMetricsRegistry(false);
    const middleware = createHttpMetricsMiddleware({ metrics, now: () => 1000 });

    middleware.record({ method: 'GET', url: '/metrics', statusCode: 200, durationMs: 5 });
    middleware.record({ method: 'POST', url: '/api/ea/heartbeat', statusCode: 401, durationMs: 12 });

    const text = await metrics.registry.metrics();
    expect(text).toContain('goldbot_http_requests_total{method="GET",path="/metrics",status="2xx"} 1');
    expect(text).toContain('goldbot_http_requests_total{method="POST",path="/api/ea/heartbeat",status="4xx"} 1');
    expect(text).toContain('goldbot_http_request_duration_seconds_bucket{le="0.005",method="GET",path="/metrics"}');
  });
});
