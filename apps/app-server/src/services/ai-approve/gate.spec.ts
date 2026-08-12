import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore, type EaRecord, type EaStore } from '@gold-bot/persistence';
import { createAIApproveCooldown, evaluateAIApprovePendingGate } from './gate.js';

const accountId = '90011087';
const symbol = 'XAUUSD';
const nowIso = '2026-04-13T08:00:00.000Z';

describe('AI approve pending gate', () => {
  it('rejects an account symbol that is not present in ai_symbols', async () => {
    const store = createInMemoryEaStore();
    await store.saveRegistration({ account_id: accountId, ai_symbols: ['XAUUSD'] });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol: 'US100Cash',
      tradePlan: tradePlan({ symbol: 'US100Cash' }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'account.symbol_not_loaded'
    });
  });

  it('fails closed when registration ai_symbols are missing', async () => {
    const store = createInMemoryEaStore();

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'account.symbol_not_loaded'
    });
  });

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
      lots: 0,
      h1Atr: 2
    });
  });

  it('matches ai_symbols case-insensitively after trimming and uses the registered contract symbol', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store, { symbol: 'GOLDm#' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol: ' goldm# ',
      tradePlan: tradePlan({ symbol: 'GOLDm#' }),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6,
      h1Atr: 2
    });
  });

  it('rejects otherwise valid approve plans when execution R:R is 1.249', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3342.8193]
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'rr.below_minimum'
    });
  });

  it('accepts otherwise valid approve plans when execution R:R is exactly 1.25', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3342.825]
      }),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6
    });
  });

  it('accepts staged approve plans when TP1 R:R is below 1.25 as long as the far TP2 qualifies', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3340, 3342.825]
      }),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6
    });
  });

  it('rejects staged approve plans when TP1 is invalid even if TP2 qualifies', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3335.65, 3342.825]
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'rr.invalid'
    });
  });

  it('normalizes staged approve targets by distance before validating each executable child target', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3350, 3342.825]
      }),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6
    });
  });

  it('rejects market approve plans whose final execution R:R geometry is invalid', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        take_profit: [3335.65]
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'rr.invalid'
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

  it('rejects plans once the per-symbol daily AI signal limit is reached', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    // 用 SELL 方向占满当日限额，避免先触发 pending.duplicate（BUY 侧无重复）。
    // createStoredCommand 用真实时钟盖 created_at，所以 nowIso 也用真实时钟对齐 UTC 日期。
    const realNowIso = new Date().toISOString();
    const expiration = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
    for (const suffix of ['a', 'b']) {
      const command = await store.saveCommandCandidate(accountId, {
        command_id: `ai_pending_90011087_XAUUSD_daily_${suffix}`,
        source: 'ai_approve',
        symbol,
        type: 'SELL',
        action: 'SIGNAL',
        expiration
      });
      await store.promoteCommand(command.command_id);
    }

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso: realNowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'daily_limit.symbol'
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
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3332.8, max: 3332.8 },
        add_on: true
      }),
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
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
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

  it('accepts lower-confidence sell limit plans when trend context is bearish', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store, { trend: 'bear' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        side: 'sell',
        confidence: 70,
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

  it('does not reject approved plans just because EMA/ADX trend indicators are absent from bars', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store, { trend: 'missing-indicators' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        side: 'sell',
        confidence: 68,
        execution_type: 'limit',
        requested_order_type: 'SELL_LIMIT',
        entry_zone: { min: 3338.5, max: 3338.5 },
        stop_loss: 3344,
        take_profit: [3325],
        max_lots: 0.08,
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
    })).resolves.toMatchObject({ accepted: true, orderType: 'market' });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        entry_zone: { min: 3332.5, max: 3332.5 },
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

  it('accepts favorable add-on when profit >= 1.0 ATR and new lots <= existing * 0.5', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [{ ticket: 2001, symbol, type: 'BUY', lots: 0.2, open_price: 3333.6, strategy: 'ai_signal' }]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        entry_zone: { min: 3335.5, max: 3335.7 },
        max_lots: 0.1
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true });
  });

  it('rejects favorable add-on when profit < 1.0 ATR', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [{ ticket: 2001, symbol, type: 'BUY', lots: 0.2, open_price: 3335.0, strategy: 'ai_signal' }]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        entry_zone: { min: 3337.6, max: 3337.8 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT',
        max_lots: 0.1
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.favorable_add_profit_not_enough'
    });
  });

  it('rejects favorable add-on when new lots > existing * 0.5', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [{ ticket: 2001, symbol, type: 'BUY', lots: 0.01, open_price: 3333.6, strategy: 'ai_signal' }]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        entry_zone: { min: 3335.5, max: 3335.7 },
        max_lots: 0.15
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.favorable_add_lots_too_large'
    });
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
    execution_type: 'market',
    requested_order_type: 'market',
    stop_loss: 3330,
    take_profit: [3345],
    max_lots: 0.2,
    expires_at: '2099-06-06T09:15:00Z',
    reason_codes: ['mode.approve', 'side.buy'],
    narrative: 'approved by AI',
    ...overrides
  };
}

async function seedStrongTrendState(
  store: EaStore,
  options: { trend?: 'bull' | 'bear' | 'neutral' | 'missing-indicators'; symbol?: string } = {}
): Promise<void> {
  const stateSymbol = options.symbol ?? symbol;
  await store.saveRegistration({
    account_id: accountId,
    ai_symbols: [stateSymbol]
  });
  await store.saveTick({
    account_id: accountId,
    symbol: stateSymbol,
    bid: 3335.5,
    ask: 3335.7,
    spread: 0.2,
    time: '2026-04-13T07:59:30.000Z'
  });
  const trend = options.trend ?? 'bull';
  const bar = trend === 'bull'
    ? { close: 3336, ema20: 3335, ema50: 3330, adx: 35, atr: 2, rsi: 60 }
    : trend === 'bear'
      ? { close: 3334, ema20: 3335, ema50: 3340, adx: 35, atr: 2, rsi: 40 }
      : trend === 'missing-indicators'
        ? { open: 3335, high: 3340, low: 3330, close: 3336, volume: 100, atr: 2 }
        : { close: 3335, ema20: 3335, ema50: 3335, adx: 10, atr: 2, rsi: 50 };
  for (const timeframe of ['D1', 'H4', 'H1', 'M30', 'M15']) {
    await store.saveBars({
      account_id: accountId,
      symbol: stateSymbol,
      timeframe,
      bars: [bar]
    });
  }
}

describe('AI approve favorable add-on', () => {
  it('accepts favorable add-on when profit >= 1.0 ATR and lots <= existing*0.5', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3333.0, sl: 3330.0, tp: 3340.0, profit: 260, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        max_lots: 0.05,
        entry_zone: { min: 3336.0, max: 3336.2 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toMatchObject({
      accepted: true,
      lots: 0
    });
  });

  it('rejects favorable add-on when profit < 1.0 ATR', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3334.5, sl: 3330.0, tp: 3340.0, profit: 110, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        max_lots: 0.05,
        entry_zone: { min: 3336.6, max: 3336.8 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.favorable_add_profit_not_enough'
    });
  });

  it('rejects favorable add-on when new lots > existing*0.5', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.01, open_price: 3333.0, sl: 3330.0, tp: 3340.0, profit: 104, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'favorable',
        max_lots: 0.10,
        entry_zone: { min: 3336.0, max: 3336.2 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({
      accepted: false,
      reason: 'position.favorable_add_lots_too_large'
    });
  });
});

describe('AI approve adverse add-on', () => {
  it('accepts adverse add-on L1 when loss >= 1.0 ATR, spacing >= 1.0 ATR, lots <= net*0.6', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3337.6, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1,
        max_lots: 0.05,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toMatchObject({ accepted: true, lots: 0 });
  });

  it('rejects adverse add-on when loss < 1.0 ATR (L1)', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3336.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1,
        max_lots: 0.05,
        entry_zone: { min: 3333.4, max: 3333.6 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_loss_not_enough' });
  });

  it('rejects adverse add-on L2 when spacing < 1.5 ATR', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3340.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 2,
        max_lots: 0.05,
        entry_zone: { min: 3337.0, max: 3337.2 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.add_on_distance' });
  });

  it('rejects adverse add-on L2 when time interval not elapsed (45min)', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3340.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });
    await store.savePositionState(accountId, symbol, {
      ticket: 1001,
      tp1_hit: false,
      tp2_hit: false,
      max_profit_atr: 0,
      be_moved: false,
      be_trigger_atr: 1.5,
      best_sl: 0,
      open_time: '2026-04-13T06:00:00.000Z',
      last_modify_time: '2026-04-13T07:10:00.000Z',
      add_on_count: 1,
      last_add_on_time: '2026-04-13T07:30:00.000Z',
      last_add_on_price: 3338.0,
      group_id: '',
      group_avg_entry: 0,
      group_best_sl: 0
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 2,
        max_lots: 0.05,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso: '2026-04-13T07:50:00.000Z'
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_interval_active' });
  });

  it('rejects adverse add-on when count exceeded (max_add_count=2)', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3343.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });
    await store.savePositionState(accountId, symbol, {
      ticket: 1001,
      tp1_hit: false,
      tp2_hit: false,
      max_profit_atr: 0,
      be_moved: false,
      be_trigger_atr: 1.5,
      best_sl: 0,
      open_time: '2026-04-13T05:00:00.000Z',
      last_modify_time: '2026-04-13T07:00:00.000Z',
      add_on_count: 2,
      last_add_on_time: '2026-04-13T05:30:00.000Z',
      last_add_on_price: 3339.0,
      group_id: '',
      group_avg_entry: 0,
      group_best_sl: 0
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 3,
        max_add_count: 2,
        max_lots: 0.05,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_count_exceeded' });
  });

  it('rejects adverse add-on when single lots > net*0.6', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.01, open_price: 3338.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1,
        max_lots: 0.10,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_single_lots_too_large' });
  });

  it('rejects adverse add-on when total lots > max_total_lots', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3338.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1,
        max_lots: 0.05,
        max_total_lots: 0.10,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_total_lots_exceeded' });
  });

  it('rejects adverse add-on when account drawdown >= 5%', async () => {
    const store = createInMemoryEaStore();
    await seedStrongTrendState(store);
    await store.savePositions({
      account_id: accountId,
      symbol,
      positions: [
        { ticket: 1001, symbol, type: 'BUY', lots: 0.10, open_price: 3338.0, sl: 3330.0, tp: 3340.0, strategy: 'ai_signal' }
      ]
    });
    await store.saveHeartbeat({
      account_id: accountId,
      balance: 10000,
      equity: 9400,
      time: '2026-04-13T07:59:00.000Z'
    });

    await expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({
        add_on: true,
        add_on_type: 'adverse',
        add_on_level: 1,
        max_lots: 0.05,
        entry_zone: { min: 3335.5, max: 3335.7 },
        execution_type: 'limit',
        requested_order_type: 'BUY_LIMIT'
      }),
      nowIso
    })).resolves.toEqual({ accepted: false, reason: 'position.adverse_add_account_drawdown_exceeded' });
  });
});
