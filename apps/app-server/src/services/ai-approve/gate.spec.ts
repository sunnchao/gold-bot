import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore, type EaRecord, type EaStore } from '@gold-bot/persistence';
import { createAIApproveCooldown, evaluateAIApprovePendingGate } from './gate.js';

const accountId = '90011087';
const symbol = 'XAUUSD';
const nowIso = '2026-04-13T08:00:00.000Z';

describe('AI approve pending gate', () => {
  it('accepts valid approve plans when market context is Go-compatible', () => {
    const store = createInMemoryEaStore();
    seedStrongTrendState(store);

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).toMatchObject({
      accepted: true,
      currentPrice: 3335.6,
      entry: 3335.6,
      lots: 0.01,
      h1Atr: 2
    });
  });

  it('rejects active duplicate AI approve pending commands', () => {
    const store = createInMemoryEaStore();
    seedStrongTrendState(store);
    const pending = store.saveCommandCandidate(accountId, {
      command_id: 'ai_pending_90011087_XAUUSD_active',
      source: 'ai_approve',
      symbol,
      type: 'BUY',
      action: 'SIGNAL',
      expiration: 1776081600
    });
    store.promoteCommand(pending.command_id);

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).toEqual({
      accepted: false,
      reason: 'pending.duplicate'
    });
  });

  it('rejects weak trend consensus after the Go lots-halving rule', () => {
    const store = createInMemoryEaStore();
    seedStrongTrendState(store, { trend: 'neutral' });

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).toEqual({
      accepted: false,
      reason: 'trend.weak_lots_below_min'
    });
  });

  it('mirrors Go same-side and add-on distance gates', () => {
    const store = createInMemoryEaStore();
    seedStrongTrendState(store);
    store.savePositions({
      account_id: accountId,
      symbol,
      positions: [{ ticket: 1001, symbol, type: 'BUY', lots: 0.1, open_price: 3335, strategy: 'ai_signal' }]
    });

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso
    })).toEqual({
      accepted: false,
      reason: 'position.same_side'
    });

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ add_on: true }),
      nowIso
    })).toEqual({
      accepted: false,
      reason: 'position.add_on_distance'
    });

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ entry_zone: { min: 3338.1, max: 3338.1 }, add_on: true }),
      nowIso
    })).toMatchObject({ accepted: true, entry: 3338.1 });
  });

  it('rejects cooldown and far H1 ATR entry distance', () => {
    const store = createInMemoryEaStore();
    seedStrongTrendState(store);
    const cooldown = createAIApproveCooldown();
    cooldown.mark(symbol, '2026-04-13T07:45:00.000Z');

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan(),
      nowIso,
      cooldown
    })).toEqual({
      accepted: false,
      reason: 'cooldown.active'
    });

    expect(evaluateAIApprovePendingGate({
      store,
      accountId,
      symbol,
      tradePlan: tradePlan({ entry_zone: { min: 3350, max: 3350 } }),
      nowIso
    })).toEqual({
      accepted: false,
      reason: 'entry.too_far_from_market'
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
    stop_loss: 3330,
    take_profit: [3345],
    max_lots: 0.2,
    expires_at: '2099-06-06T09:15:00Z',
    reason_codes: ['mode.approve', 'side.buy'],
    narrative: 'approved by AI',
    ...overrides
  };
}

function seedStrongTrendState(store: EaStore, options: { trend?: 'bull' | 'neutral' } = {}): void {
  store.saveTick({
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
    store.saveBars({
      account_id: accountId,
      symbol,
      timeframe,
      bars: [bar]
    });
  }
}
