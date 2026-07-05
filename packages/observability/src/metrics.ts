import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  register as defaultRegistry
} from 'prom-client';

export type MetricsRegistry = {
  registry: Registry;
  signalsTotal: Counter<string>;
  signalScore: Histogram<string>;
  ordersTotal: Counter<string>;
  orderLatency: Histogram<string>;
  orderProfit: Histogram<string>;
  accountEquity: Gauge<string>;
  accountBalance: Gauge<string>;
  accountPositions: Gauge<string>;
  accountFloatingPL: Gauge<string>;
  accountDailyPL: Gauge<string>;
  eaHeartbeatTimestamp: Gauge<string>;
  eaHeartbeatsTotal: Counter<string>;
  eaTicksTotal: Counter<string>;
  httpRequestsTotal: Counter<string>;
  httpRequestDuration: Histogram<string>;
  dbQueryDuration: Histogram<string>;
  dbQueriesTotal: Counter<string>;
  dbConnectionsOpen: Gauge<string>;
  dbConnectionsInUse: Gauge<string>;
  strategyExecutionDuration: Histogram<string>;
  strategyWinRate: Gauge<string>;
  riskGateRejections: Counter<string>;
  spreadPoints: Gauge<string>;
};

export function createMetricsRegistry(enableDefault = true): MetricsRegistry {
  const registry = new Registry();
  if (enableDefault) {
    collectDefaultMetrics({ register: registry });
  }

  const signalsTotal = new Counter({
    name: 'goldbot_signals_total',
    help: 'Total number of trading signals generated',
    labelNames: ['account_id', 'symbol', 'strategy', 'side'],
    registers: [registry]
  });

  const signalScore = new Histogram({
    name: 'goldbot_signal_score',
    help: 'Distribution of signal scores',
    buckets: [0, 2, 4, 6, 8, 10],
    labelNames: ['account_id', 'strategy'],
    registers: [registry]
  });

  const ordersTotal = new Counter({
    name: 'goldbot_orders_total',
    help: 'Total number of orders executed',
    labelNames: ['account_id', 'symbol', 'side', 'result'],
    registers: [registry]
  });

  const orderLatency = new Histogram({
    name: 'goldbot_order_latency_seconds',
    help: 'Order execution latency from signal to EA execution',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    labelNames: ['account_id', 'order_type'],
    registers: [registry]
  });

  const orderProfit = new Histogram({
    name: 'goldbot_order_profit_usd',
    help: 'Order profit/loss distribution in USD',
    buckets: [-1000, -500, -100, -50, 0, 50, 100, 500, 1000],
    labelNames: ['account_id', 'symbol'],
    registers: [registry]
  });

  const accountEquity = new Gauge({
    name: 'goldbot_account_equity_usd',
    help: 'Account equity in USD',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const accountBalance = new Gauge({
    name: 'goldbot_account_balance_usd',
    help: 'Account balance in USD',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const accountPositions = new Gauge({
    name: 'goldbot_account_positions',
    help: 'Number of open positions',
    labelNames: ['account_id', 'symbol'],
    registers: [registry]
  });

  const accountFloatingPL = new Gauge({
    name: 'goldbot_account_floating_pl_usd',
    help: 'Floating profit/loss in USD',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const accountDailyPL = new Gauge({
    name: 'goldbot_account_daily_pl_usd',
    help: 'Daily profit/loss in USD (resets at midnight)',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const eaHeartbeatTimestamp = new Gauge({
    name: 'goldbot_ea_last_heartbeat_timestamp',
    help: 'Unix timestamp of last EA heartbeat',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const eaHeartbeatsTotal = new Counter({
    name: 'goldbot_ea_heartbeats_total',
    help: 'Total number of EA heartbeats received',
    labelNames: ['account_id'],
    registers: [registry]
  });

  const eaTicksTotal = new Counter({
    name: 'goldbot_ea_ticks_total',
    help: 'Total number of ticks received from EA',
    labelNames: ['account_id', 'symbol'],
    registers: [registry]
  });

  const httpRequestsTotal = new Counter({
    name: 'goldbot_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [registry]
  });

  const httpRequestDuration = new Histogram({
    name: 'goldbot_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    labelNames: ['method', 'path'],
    registers: [registry]
  });

  const dbQueryDuration = new Histogram({
    name: 'goldbot_db_query_duration_seconds',
    help: 'Database query duration in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    labelNames: ['operation'],
    registers: [registry]
  });

  const dbQueriesTotal = new Counter({
    name: 'goldbot_db_queries_total',
    help: 'Total number of database queries',
    labelNames: ['operation', 'status'],
    registers: [registry]
  });

  const dbConnectionsOpen = new Gauge({
    name: 'goldbot_db_connections_open',
    help: 'Number of open database connections',
    registers: [registry]
  });

  const dbConnectionsInUse = new Gauge({
    name: 'goldbot_db_connections_in_use',
    help: 'Number of database connections currently in use',
    registers: [registry]
  });

  const strategyExecutionDuration = new Histogram({
    name: 'goldbot_strategy_execution_seconds',
    help: 'Strategy execution duration in seconds',
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    labelNames: ['account_id', 'strategy'],
    registers: [registry]
  });

  const strategyWinRate = new Gauge({
    name: 'goldbot_strategy_win_rate',
    help: 'Strategy win rate (0-1)',
    labelNames: ['account_id', 'strategy'],
    registers: [registry]
  });

  const riskGateRejections = new Counter({
    name: 'goldbot_risk_gate_rejections_total',
    help: 'Total number of signals rejected by risk gate',
    labelNames: ['account_id', 'reason'],
    registers: [registry]
  });

  const spreadPoints = new Gauge({
    name: 'goldbot_spread_points',
    help: 'Current spread in points',
    labelNames: ['account_id', 'symbol'],
    registers: [registry]
  });

  return {
    registry,
    signalsTotal,
    signalScore,
    ordersTotal,
    orderLatency,
    orderProfit,
    accountEquity,
    accountBalance,
    accountPositions,
    accountFloatingPL,
    accountDailyPL,
    eaHeartbeatTimestamp,
    eaHeartbeatsTotal,
    eaTicksTotal,
    httpRequestsTotal,
    httpRequestDuration,
    dbQueryDuration,
    dbQueriesTotal,
    dbConnectionsOpen,
    dbConnectionsInUse,
    strategyExecutionDuration,
    strategyWinRate,
    riskGateRejections,
    spreadPoints
  };
}

export function httpStatusClass(code: number): string {
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 300 && code < 400) return '3xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500) return '5xx';
  return 'unknown';
}

export const defaultMetricsRegistry = createMetricsRegistry(false);

export async function metricsText(): Promise<string> {
  return defaultMetricsRegistry.registry.metrics();
}

export { defaultRegistry };
