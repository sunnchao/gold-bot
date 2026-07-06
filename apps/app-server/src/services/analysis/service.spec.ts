import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { AnalysisService } from './service.js';

describe('AnalysisService', () => {
  it('passes the latest stored AI result into replay analysis', async () => {
    const store = createInMemoryEaStore();
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 95,
      ask: 95
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: pullbackBuyBars()
    });
    await store.saveAIResult('90011087', 'XAUUSD', {
      suggested_sl: 93
    });

    const result = await new AnalysisService(store, () => '2026-04-16T12:00:00.000Z').analyzeAccountSymbol('90011087', 'XAUUSD');

    expect(result.replay.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95,
      stop_loss: 93
    });
  });

  it('uses the latest H1 close for replay analysis when no current tick exists', async () => {
    const store = createInMemoryEaStore();
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: pullbackBuyBars()
    });

    const result = await new AnalysisService(store, () => '2026-04-16T12:00:00.000Z').analyzeAccountSymbol('90011087', 'XAUUSD');

    expect(result.replay.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95
    });
  });

  it('passes D1 bars into replay trend scoring', async () => {
    const store = createInMemoryEaStore();
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 95,
      ask: 95
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: pullbackBuyBars()
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'D1',
      bars: d1TrendBars()
    });

    const result = await new AnalysisService(store, () => '2026-04-16T12:00:00.000Z').analyzeAccountSymbol('90011087', 'XAUUSD');

    expect(result.replay.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      score: 8
    });
  });

  it('filters unrelated position symbols before replay conflict checks', async () => {
    const store = createInMemoryEaStore();
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 95,
      ask: 95
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: pullbackBuyBars()
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 2002, symbol: 'GBPJPY', type: 'BUY', lots: 0.2, open_price: 95.1, profit: 1.5 }]
    });

    const result = await new AnalysisService(store, () => '2026-04-16T12:00:00.000Z').analyzeAccountSymbol('90011087', 'XAUUSD');

    expect(result.replay.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95
    });
  });
});

function pullbackBuyBars() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    atr: 2,
    adx: 35,
    rsi: 45,
    ema20: 95.8,
    ema50: 90,
    macd_hist: 1
  }));

  bars[48] = {
    ...bars[48],
    close: 95.2,
    open: 95.2
  };
  bars[49] = {
    ...bars[49],
    close: 95,
    open: 95
  };
  return bars;
}

function d1TrendBars() {
  return Array.from({ length: 40 }, (_, index) => ({
    time: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    adx: 35,
    ema20: 120,
    ema50: 100
  }));
}
