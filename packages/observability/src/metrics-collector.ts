import type { EaStore, EaRecord } from '@gold-bot/persistence';
import type { MetricsRegistry } from './metrics.js';

export type StoreMetricsCollectorOptions = {
  metrics: MetricsRegistry;
  store: EaStore;
  now?: () => number;
};

export type StoreMetricsSnapshot = {
  accounts: number;
  heartbeats: number;
  positions: number;
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function accountIdOf(record: EaRecord | undefined): string | undefined {
  if (!record) return undefined;
  return (record.account_id as string | undefined) ?? (record.accountId as string | undefined);
}

export function createStoreMetricsCollector(options: StoreMetricsCollectorOptions) {
  const metrics = options.metrics;
  const store = options.store;
  const now = options.now ?? (() => Date.now());

  async function collect(): Promise<StoreMetricsSnapshot> {
    const accountIds = await store.listAccountIds();
    let positionsSeen = 0;
    let heartbeatsSeen = 0;

    for (const accountId of accountIds) {
      const heartbeat = await store.getHeartbeat(accountId);
      if (heartbeat) {
        heartbeatsSeen++;
        const ts = asNumber(heartbeat.timestamp) ?? asNumber(heartbeat.ts) ?? asNumber(heartbeat.time);
        if (ts != null) {
          metrics.eaHeartbeatTimestamp.labels(accountId).set(ts);
        } else {
          metrics.eaHeartbeatTimestamp.labels(accountId).set(Math.floor(now() / 1000));
        }
        const equity = asNumber(heartbeat.equity);
        if (equity != null) metrics.accountEquity.labels(accountId).set(equity);
        const balance = asNumber(heartbeat.balance);
        if (balance != null) metrics.accountBalance.labels(accountId).set(balance);
        const floatingPL = asNumber(heartbeat.floating_pl) ?? asNumber(heartbeat.floatingPL) ?? asNumber(heartbeat.profit);
        if (floatingPL != null) metrics.accountFloatingPL.labels(accountId).set(floatingPL);
        const dailyPL = asNumber(heartbeat.daily_pl) ?? asNumber(heartbeat.dailyPL);
        if (dailyPL != null) metrics.accountDailyPL.labels(accountId).set(dailyPL);
      }

      const symbols = await store.listSymbols(accountId);
      for (const symbol of symbols) {
        const tick = await store.getLatestTick(accountId, symbol);
        if (tick) {
          const spread = asNumber(tick.spread);
          if (spread != null) metrics.spreadPoints.labels(accountId, symbol).set(spread);
        }

        const positions = await store.getPositions(accountId, symbol);
        positionsSeen += positions.length;
        metrics.accountPositions.labels(accountId, symbol).set(positions.length);
      }
    }

    return { accounts: accountIds.length, heartbeats: heartbeatsSeen, positions: positionsSeen };
  }

  return { collect };
}
