import { describe, expect, it } from 'vitest';
import { ArbitrationManager, defaultArbitrationConfig } from './service.js';
import { createInMemoryEaStore } from '@gold-bot/persistence';

function makeSignal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    side: 'buy',
    entry: 2350,
    stop_loss: 2340,
    tp1: 2360,
    tp2: 2370,
    score: 9,
    strategy: 'pullback',
    atr: 5,
    scale_in_parent_ticket: 0,
    weighted_avg_entry: 0,
    unified_sl: 0,
    scale_in_count: 0,
    ...overrides
  };
}

describe('ArbitrationManager', () => {
  it('exposes default config matching Go defaults', () => {
    const cfg = defaultArbitrationConfig();
    expect(cfg.maxWaitMs).toBe(30_000);
    expect(cfg.timeoutAutoPassScore).toBe(8);
    expect(cfg.pollIntervalMs).toBe(1_000);
    expect(cfg.pendingSignalTtlMs).toBe(5 * 60 * 1_000);
  });

  it('auto-passes on timeout when score >= threshold', async () => {
    const store = createInMemoryEaStore();
    const sleeps: number[] = [];
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 30, pollIntervalMs: 10, timeoutAutoPassScore: 8 },
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += 15;
      },
      now: () => new Date(nowMs)
    });

    const verdict = await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(verdict.execute).toBe(true);
    expect(verdict.reason).toBe('timeout_auto_pass');
    expect(verdict.result.status).toBe('timeout');
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('abandons on timeout when score < threshold', async () => {
    const store = createInMemoryEaStore();
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 25, pollIntervalMs: 10, timeoutAutoPassScore: 8 },
      sleep: async () => {
        nowMs += 15;
      },
      now: () => new Date(nowMs)
    });

    const verdict = await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 5 }));
    expect(verdict.execute).toBe(false);
    expect(verdict.reason).toBe('timeout_abandoned');
  });

  it('returns approved when admin updates result before timeout', async () => {
    const store = createInMemoryEaStore();
    let signalId = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 10_000, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        // on first poll, approve the signal
        if (signalId === 0) {
          const pending = await store.getPendingSignals('90011087', 'XAUUSD');
          const id = (pending[0] as { id?: number }).id ?? 0;
          signalId = id;
          await store.updatePendingSignalArbitration(id, 'approved', 'manual_review');
        }
      },
      now: () => new Date(0)
    });

    const verdict = await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(verdict.execute).toBe(true);
    expect(verdict.reason).toBe('manual_review');
    expect(verdict.result.status).toBe('approved');
  });

  it('returns rejected when admin rejects before timeout', async () => {
    const store = createInMemoryEaStore();
    let approved = false;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 10_000, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        if (!approved) {
          approved = true;
          const pending = await store.getPendingSignals('90011087', 'XAUUSD');
          const id = (pending[0] as { id?: number }).id ?? 0;
          await store.updatePendingSignalArbitration(id, 'rejected', 'too_risky');
        }
      },
      now: () => new Date(0)
    });

    const verdict = await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(verdict.execute).toBe(false);
    expect(verdict.reason).toBe('too_risky');
    expect(verdict.result.status).toBe('rejected');
  });

  it('saves pending signal with 5min expiration and side/score/strategy', async () => {
    const store = createInMemoryEaStore();
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 5, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        nowMs += 10;
      },
      now: () => new Date(nowMs)
    });

    await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ side: 'sell', score: 10, strategy: 'momentum_scalp' }));
    const pending = await store.getPendingSignals('90011087', 'XAUUSD');
    expect(pending.length).toBe(1);
    const signal = pending[0];
    expect(String(signal.status)).toBe('pending');
    expect(String(signal.side)).toBe('sell');
    expect(Number(signal.score)).toBe(10);
    expect(String(signal.strategy)).toBe('momentum_scalp');
    expect(String(signal.created_at)).toBe(new Date(0).toISOString());
    // 5 minute expiration per Go default
    expect(String(signal.expires_at)).toBe(new Date(5 * 60 * 1_000).toISOString());
    const indicators = String(signal.indicators);
    expect(indicators).toContain('"side":"sell"');
    expect(indicators).toContain('"strategy":"momentum_scalp"');
    expect(indicators).toContain('"score":10');
  });

  it('serializes all_strategies when present', async () => {
    const store = createInMemoryEaStore();
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 5, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        nowMs += 10;
      },
      now: () => new Date(nowMs)
    });

    await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ all_strategies: ['pullback', 'momentum_scalp'] }));
    const pending = await store.getPendingSignals('90011087', 'XAUUSD');
    expect(String(pending[0].indicators)).toContain('"all_strategies":["pullback","momentum_scalp"]');
  });

  it('delegates expireStaleSignals / getPendingSignals / updateArbitrationResult to store', async () => {
    const store = createInMemoryEaStore();
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 5, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {},
      now: () => new Date(0)
    });

    await store.savePendingSignal({
      account_id: '90011087',
      symbol: 'XAUUSD',
      status: 'pending',
      created_at: new Date(0).toISOString(),
      expires_at: new Date(0).toISOString()
    });
    const pending = await manager.getPendingSignals('90011087', 'XAUUSD');
    expect(pending.length).toBe(1);
    const id = Number(pending[0].id);
    expect(await manager.updateArbitrationResult(id, 'approved', 'manual')).toBe(true);
    const expired = await manager.expireStaleSignals();
    expect(expired).toBe(0);
  });

  it('respects abort signal cancellation', async () => {
    const store = createInMemoryEaStore();
    const controller = new AbortController();
    const manager = new ArbitrationManager({
      store,
      signal: () => controller.signal,
      config: { maxWaitMs: 10_000, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        controller.abort();
      },
      now: () => new Date(0)
    });

    const verdict = await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(verdict.result.status).toBe('timeout');
    expect(verdict.result.reason).toBe('context_cancelled');
    expect(verdict.execute).toBe(true); // score 9 >= 8 auto-passes
  });

  it('tracks active pending signals during submit', async () => {
    const store = createInMemoryEaStore();
    let activeDuringWait = -1;
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 5, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        activeDuringWait = manager.activeCount();
        nowMs += 10;
      },
      now: () => new Date(nowMs)
    });

    await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(activeDuringWait).toBe(1);
    expect(manager.activeCount()).toBe(0);
  });

  it('uses provided log callback', async () => {
    const store = createInMemoryEaStore();
    const logs: string[] = [];
    let nowMs = 0;
    const manager = new ArbitrationManager({
      store,
      config: { maxWaitMs: 5, pollIntervalMs: 5, timeoutAutoPassScore: 8 },
      sleep: async () => {
        nowMs += 10;
      },
      now: () => new Date(nowMs),
      log: (message) => logs.push(message)
    });

    await manager.submitSignal('90011087', 'XAUUSD', makeSignal({ score: 9 }));
    expect(logs.some((entry) => entry.includes('submit'))).toBe(true);
    expect(logs.some((entry) => entry.includes('timeout auto-pass'))).toBe(true);
  });
});
