import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore, type EaRecord, type EaStore } from '@gold-bot/persistence';
import { createAIApproveCooldown, evaluateAIApprovePendingGate } from './gate.js';

const accountId = '90011087';
const symbol = 'XAUUSD';
const nowIso = '2026-04-13T08:00:00.000Z';

describe('AI approve pending gate', () => {
  it('accepts valid approve plans when market context is Go-compatible', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6,
      lots: 0.01,
      h1Atr: 2
    });
  });

  it('rejects active duplicate AI approve pending commands', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    const pending = await store.saveCommandCandidate(accountId, {
      command_id: 'ai_pending_90011087_XAUUSD_active',
      source: 'ai_approve',
      symbol,
      type: 'BUY',
      action: 'SIGNAL',
      expiration: 1776081600
    });
    await store.promoteCommand(pending.command_id);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'pending.duplicate'
    });
  });

  it('rejects weak trend consensus after the Go lots-halving rule', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store, { trend: 'neutral' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'trend.weak_lots_below_min'
    });
  });

  it('mirrors Go same-side and add-on distance gates', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [{ ticket: 1001, symbol, type: 'BUY', lots: 0.1, open_price: 3335, strategy: 'ai_signal' }]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.same_side'
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ add_on: true }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.add_on_distance'
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ entry_zone: { min: 3332.8, max: 3332.8 }, add_on: true }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, entry: 3332.8 });
  });

  it('rejects cooldown and far H1 ATR entry distance', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    const cooldown = createAIApproveCooldown();
    cooldown.mark(symbol, '2026-04-13T07:45:00.000Z');

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso,
      cooldown
    })).resolves.toEqual({
      accepted: false,
      reason: 'cooldown.active'
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        entry_zone: { min: 3328, max: 3328 },
        stop_loss: 3320
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'entry.too_far_from_market'
    });
  });

  it('returns accepted order type for explicit market, buy limit, and sell limit plans', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'market',
        requested_order_type: 'market',
        entry_zone: { min: 3335.5, max: 3335.7 }
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'market' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3332.5, max: 3332.5 }
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'BUY_LIMIT' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        side: 'sell',
        execution_type: 'limit',
        requested_order_type: 'SELL_LIMIT',
        entry_zone: { min: 3338.5, max: 3338.5 },
        stop_loss: 3344,
        take_profit: [3325],
        reason_codes: ['mode.approve', 'side.sell']
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, orderType: 'SELL_LIMIT' });
  });

  it('rejects disabled stops, mismatched market entry, mismatched limit direction, and invalid protection', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ execution_type: 'stop', requested_order_type: 'BUY_STOP' }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'stop_order.disabled' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'market',
        requested_order_type: 'market',
        entry_zone: { min: 3332, max: 3332 }
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'market_entry_mismatch' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3338, max: 3338 }
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'limit_direction_mismatch' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        stop_loss: 3338
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'protection.invalid_direction' });
  });

  it('rejects otherwise valid plans that omit explicit order intent', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: undefined,
        requested_order_type: undefined
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'order_intent.missing' });
  });
});

function tradePlan(overrides: EaRecord = {}): EaRecord {
  return {
    schema_version: 'trade_plan.v1',
    decision_id: 'tpv1_buy',
    account_id: accountId,
    symbol,
    mode: 'approve',
    side: 'buy',
    confidence: 80,
    entry_zone: { min: 3335.5, max: 3335.7 },
    execution_type: 'limit',
    requested_order_type: 'BUY_LIMIT',
    stop_loss: 3330,
    take_profit: [3345],
    max_lots: 0.2,
    expires_at: '2099-06-06T09:15:00Z',
    reason_codes: ['mode.approve', 'side.buy'],
    narrative: 'approved by AI',
    ...overrides
  };
}

async function seedStrongTrendState(store: EaStore, options: { trend?: 'bull' | 'neutral' } = {}): Promise<void> {
  await store.saveTick({
    account_id: accountId,
    symbol,
    bid: 3335.5,
    ask: 3335.7,
    spread: 0.2,
    time: '2026-04-13T07:59:30.000Z'
  });
  const trend = options.trend ?? 'bull';
  const bar = trend === 'bull'
    ? { close: 3336, ema20: 3335, ema50: 3330, adx: 35, atr: 2, rsi: 60 }
    : { close: 3335, ema20: 3335, ema50: 3335, adx: 10, atr: 2, rsi: 50 };
  for (const timeframe of ['D1', 'H4', 'H1', 'M30', 'M15']) {
    await store.saveBars({
      account_id: accountId,
      symbol,
      timeframe,
      bars: [bar]
    });
  }
}
