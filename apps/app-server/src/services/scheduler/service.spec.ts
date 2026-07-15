import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { SchedulerService } from './service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import { AnalysisService } from '../analysis/service.js';

describe('SchedulerService', () => {
  it('publishes replay signals through the command lifecycle for cutover accounts', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.9, ask: 3336.1 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 3335, high: 3337, low: 3333, close: 3336, atr: 2 }]
    });
    const commandLifecycle = new CommandLifecycleService(store);
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: {
                strategy: 'pullback',
                side: 'BUY',
                entry: 3335,
                stop_loss: 3330,
                tp1: 3345,
                tp2: 3355,
                score: 8,
                atr: 2
              },
              position_commands: null
            }
          };
        }
      } as never,
      commandLifecycle,
      undefined,
      store,
      () => '2026-04-13T08:00:00.000Z'
    );

    await scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');
    await scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');

    const commands = await store.listCommands('90011087');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      source: 'live_strategy',
      status: 'queued',
      strategy: 'pullback',
      trigger_key: 'H1:2026-04-13T07:00:00.000Z',
      analysis_mode: 'bars',
      order_type: 'BUY_LIMIT',
      expiration: Math.floor(Date.parse('2026-04-13T08:00:00.000Z') / 1000) + 24 * 60 * 60
    });
    expect(String(commands[0].command_id)).toMatch(/^live_[0-9a-f]{16}$/);
    expect(commands[0].decision_id).toBe(commands[0].command_id);
  });

  it('skips replay analysis for non-live strategy timeframes', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    let calls = 0;
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          calls += 1;
          return {
            replay: {
              signal: {
                strategy: 'pullback',
                side: 'BUY',
                entry: 3335.7,
                stop_loss: 3330,
                tp1: 3345,
                tp2: 3355,
                score: 8
              },
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store
    );

    await scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'D1');

    expect(calls).toBe(0);
    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('skips replay analysis when EA runtime is not tradeable', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: false,
      is_trade_allowed: true
    });
    let calls = 0;
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          calls += 1;
          return {
            replay: {
              signal: {
                strategy: 'pullback',
                side: 'BUY',
                entry: 3335.7,
                stop_loss: 3330,
                tp1: 3345,
                tp2: 3355,
                score: 8
              },
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store
    );

    await scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');

    expect(calls).toBe(0);
    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('skips replay analysis when heartbeat is missing', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    let calls = 0;
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          calls += 1;
          return {
            replay: {
              signal: {
                strategy: 'pullback',
                side: 'BUY',
                entry: 3335.7,
                stop_loss: 3330,
                tp1: 3345,
                tp2: 3355,
                score: 8
              },
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store
    );

    await scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');

    expect(calls).toBe(0);
    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('skips position review when heartbeat is missing', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    let calls = 0;
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          calls += 1;
          return {
            replay: {
              signal: null,
              position_commands: [
                { action: 'CLOSE', ticket: 777, lots: 0.04, reason: 'TP1_2.2ATR' }
              ]
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store
    );

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    expect(calls).toBe(0);
    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('queues replay position manager commands during position review', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 777, symbol: 'XAUUSD', type: 'BUY', open_price: 3320, lots: 0.1, sl: 3325, tp: 3345 }]
    });
    const commandLifecycle = new CommandLifecycleService(store);
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: [
                { action: 'MODIFY', ticket: 777, new_sl: 3330, reason: 'breakeven_2.2ATR' },
                { action: 'CLOSE', ticket: 777, lots: 0.04, reason: 'TP1_2.2ATR' }
              ]
            }
          };
        }
      } as never,
      commandLifecycle,
      undefined,
      store,
      () => '2026-04-13T08:00:00.000Z'
    );

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    const commands = await store.listCommands('90011087');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      command_id: expect.stringMatching(/^pm_90011087_XAUUSD_777_modify_breakeven_2_2ATR_20260413080000000$/),
      action: 'MODIFY',
      source: 'position_manager',
      status: 'queued',
      symbol: 'XAUUSD',
      ticket: 777,
      new_sl: 3330,
      sl: 3330,
      old_sl: 3325,
      tp: 3345,
      open_price: 3320,
      distance: 5,
      reason: 'breakeven_2.2ATR',
      trigger_time: '2026-04-13T08:00:00.000Z',
      analysis_mode: 'positions'
    });
    expect(commands[1]).toMatchObject({
      command_id: expect.stringMatching(/^pm_90011087_XAUUSD_777_close_TP1_2_2ATR_20260413080000000$/),
      action: 'CLOSE',
      source: 'position_manager',
      status: 'queued',
      symbol: 'XAUUSD',
      ticket: 777,
      lots: 0.04,
      reason: 'TP1_2.2ATR',
      trigger_time: '2026-04-13T08:00:00.000Z',
      analysis_mode: 'positions'
    });
  });

  it('skips position manager MODIFY commands when the new stop equals the current stop', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 778, symbol: 'XAUUSD', type: 'BUY', open_price: 3320, lots: 0.1, sl: 3330, tp: 3345 }]
    });
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: [
                { action: 'MODIFY', ticket: 778, new_sl: 3330, reason: 'breakeven_2.2ATR' }
              ]
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => '2026-04-13T08:00:00.000Z'
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    } finally {
      log.mockRestore();
    }

    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('queues CANCEL_PENDING and skips CLOSE for pending orders', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAGUSD',
      positions: [
        {
          ticket: 42275433,
          symbol: 'XAGUSD',
          type: 'SELL_LIMIT',
          order_class: 'pending',
          open_price: 59.5,
          lots: 0.05,
          sl: 59.5,
          tp: 58.36
        }
      ]
    });
    const commandLifecycle = new CommandLifecycleService(store);
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: [
                { action: 'CLOSE', ticket: 42275433, lots: 0.05, reason: 'trail_tp2_dd2.1' },
                { action: 'CANCEL_PENDING', ticket: 42275433, reason: 'pending_tp_reached_58.36' }
              ]
            }
          };
        }
      } as never,
      commandLifecycle,
      undefined,
      store,
      () => '2026-04-13T08:00:00.000Z'
    );

    await scheduler.enqueuePositionReview('90011087', 'XAGUSD');

    const commands = await store.listCommands('90011087');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action: 'CANCEL_PENDING',
      source: 'position_manager',
      status: 'queued',
      symbol: 'XAGUSD',
      ticket: 42275433,
      reason: 'pending_tp_reached_58.36'
    });
  });

  it('publishes position-triggered replay signals with positions analysis mode', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.9, ask: 3336.1 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 3335, high: 3337, low: 3333, close: 3336, atr: 2 }]
    });
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: {
                strategy: 'pullback',
                side: 'BUY',
                entry: 3335,
                stop_loss: 3330,
                tp1: 3345,
                tp2: 3355,
                score: 8,
                atr: 2
              },
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => '2026-04-13T08:00:00.000Z'
    );

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    const commands = await store.listCommands('90011087');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      source: 'live_strategy',
      action: 'SIGNAL',
      analysis_mode: 'positions',
      trigger_key: 'H1:2026-04-13T07:00:00.000Z'
    });
  });

  it('queues GBPJPY AI stop-loss lock-profit commands with ATR derived from H1 OHLC', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'GBPJPY', bid: 219.99, ask: 220.01 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'GBPJPY',
      timeframe: 'H1',
      bars: gbpJpyH1BarsWithoutAtr(20)
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{ ticket: 123456, symbol: 'GBPJPY', type: 'BUY', open_price: 218.4, lots: 0.2, sl: 218.7, tp: 222 }]
    });
    await store.saveAIResult('90011087', 'GBPJPY', {
      suggested_sl: 219.77,
      trade_plan: { decision_id: 'tpv1_modify_sl' }
    });
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => '2026-04-13T08:02:00.000Z'
    );
    const restoreAITrailSymbols = useDefaultAITrailSymbols();

    try {
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');

      const commands = await store.listCommands('90011087');
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        command_id: expect.stringMatching(/^mod_[0-9a-f]{16}$/),
        action: 'MODIFY',
        source: 'ai_stop_loss',
        status: 'queued',
        symbol: 'GBPJPY',
        ticket: 123456,
        new_sl: 219.77,
        sl: 219.77,
        tp: 222,
        old_sl: 218.7,
        distance: expect.closeTo(1.07, 10),
        atr: expect.closeTo(0.5, 10),
        decision_id: 'tpv1_modify_sl',
        trigger_time: '2026-04-13T08:02:00.000Z',
        analysis_mode: 'positions'
      });
    } finally {
      restoreAITrailSymbols();
    }
  });

  it('does not queue AI stop-loss commands for non-canary symbols by default', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3339.9, ask: 3340.1 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 3338, high: 3341, low: 3337, close: 3340, atr: 2 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 123457, symbol: 'XAUUSD', type: 'BUY', open_price: 3335, lots: 0.2, sl: 3336, tp: 3355 }]
    });
    await store.saveAIResult('90011087', 'XAUUSD', {
      suggested_sl: 3338.8,
      trade_plan: { decision_id: 'xau_disabled' }
    });
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => '2026-04-13T08:02:00.000Z'
    );
    const restoreAITrailSymbols = useDefaultAITrailSymbols();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"reason":"symbol_ai_trail_disabled"'));
    } finally {
      log.mockRestore();
      restoreAITrailSymbols();
    }

    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('does not queue BUY AI stop-loss commands that loosen below the current stop', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'GBPJPY', bid: 219.99, ask: 220.01 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'GBPJPY',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 219.8, high: 220.2, low: 219.7, close: 220, atr: 0.5 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{ ticket: 123458, symbol: 'GBPJPY', type: 'BUY', open_price: 218.4, lots: 0.2, sl: 219.2, tp: 222 }]
    });
    await store.saveAIResult('90011087', 'GBPJPY', {
      suggested_sl: 219.0,
      trade_plan: { decision_id: 'loosen_rejected' }
    });
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => '2026-04-13T08:02:00.000Z'
    );
    const restoreAITrailSymbols = useDefaultAITrailSymbols();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');
    } finally {
      log.mockRestore();
      restoreAITrailSymbols();
    }

    expect(await store.listCommands('90011087')).toEqual([]);
  });

  it('suppresses AI stop-loss modify commands for the same ticket inside the five-minute cooldown', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'GBPJPY', bid: 219.99, ask: 220.01 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'GBPJPY',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 219.8, high: 220.2, low: 219.7, close: 220, atr: 0.5 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{ ticket: 123456, symbol: 'GBPJPY', type: 'BUY', open_price: 218.4, lots: 0.2, sl: 218.7, tp: 222 }]
    });
    await store.saveAIResult('90011087', 'GBPJPY', {
      suggested_sl: 219.77,
      trade_plan: { decision_id: 'tpv1_modify_sl' }
    });
    let now = '2026-04-13T08:02:00.000Z';
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
          return {
            replay: {
              signal: null,
              position_commands: null
            }
          };
        }
      } as never,
      new CommandLifecycleService(store),
      undefined,
      store,
      () => now
    );
    const restoreAITrailSymbols = useDefaultAITrailSymbols();

    try {
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');
      now = '2026-04-13T08:04:00.000Z';
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');
      now = '2026-04-13T08:07:00.000Z';
      await scheduler.enqueuePositionReview('90011087', 'GBPJPY');
    } finally {
      restoreAITrailSymbols();
    }

    const commands = (await store.listCommands('90011087')).filter((command) => command.source === 'ai_stop_loss');
    expect(commands).toHaveLength(2);
    expect(commands.map((command) => command.trigger_time)).toEqual([
      '2026-04-13T08:02:00.000Z',
      '2026-04-13T08:07:00.000Z'
    ]);
  });

  it('hydrates existing position manager state during position review without persisting replay-only state', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3343.1, ask: 3343.2 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: flatH1Bars(15)
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 202, symbol: 'XAUUSD', type: 'BUY', open_price: 3340, lots: 0.5, sl: 3340 }]
    });
    await store.savePositionState('90011087', 'XAUUSD', {
      ticket: 202,
      tp1_hit: true,
      tp2_hit: false,
      max_profit_atr: 1.6,
      be_moved: true,
      be_trigger_atr: 1.5,
      best_sl: 0,
      open_time: '2026-04-13T06:00:00.000Z',
      last_modify_time: '2026-04-13T07:00:00.000Z',
      add_on_count: 0,
      last_add_on_time: '',
      last_add_on_price: 0,
      group_id: '',
      group_avg_entry: 0,
      group_best_sl: 0
    });
    const analysis = new AnalysisService(store, () => '2026-04-13T08:00:00.000Z');
    const scheduler = new SchedulerService(analysis, new CommandLifecycleService(store), undefined, store);

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    expect(await store.listCommands('90011087')).toEqual([]);
    expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
      expect.objectContaining({
        ticket: 202,
        tp1_hit: true,
        be_moved: true,
        open_time: '2026-04-13T06:00:00.000Z'
      })
    ]);
  });
});

function flatH1Bars(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 3340,
    high: 3341,
    low: 3339,
    close: 3340
  }));
}

function gbpJpyH1BarsWithoutAtr(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 219 + index * 0.02;
    return {
      time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
      open: close - 0.01,
      high: close + 0.25,
      low: close - 0.25,
      close,
      volume: 1000 + index
    };
  });
}

function useDefaultAITrailSymbols(): () => void {
  const original = process.env.GB_AI_TRAIL_SYMBOLS;
  delete process.env.GB_AI_TRAIL_SYMBOLS;
  return () => {
    if (original == null) {
      delete process.env.GB_AI_TRAIL_SYMBOLS;
      return;
    }
    process.env.GB_AI_TRAIL_SYMBOLS = original;
  };
}

async function saveTradeableHeartbeat(store: ReturnType<typeof createInMemoryEaStore>) {
  await store.saveHeartbeat({
    account_id: '90011087',
    market_open: true,
    is_trade_allowed: true
  });
}

it('persists position_states after position review', async () => {
  const store = createInMemoryEaStore();
  const mockPositionStates = [
    { ticket: 6001, addOnCount: 1, lastAddOnTime: '2026-04-13T08:00:00.000Z', groupAvgEntry: 3328.5 }
  ];
  const analysis = {
    analyzeAccountSymbol: vi.fn().mockResolvedValue({
      replay: {
        position_states: mockPositionStates,
        signal: null
      }
    }),
    persistPositionStates: vi.fn().mockResolvedValue(undefined)
  };

  await saveTradeableHeartbeat(store);

  const commandLifecycle = new CommandLifecycleService(store);
  const scheduler = new SchedulerService(analysis as any, commandLifecycle, undefined, store);
  await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

  expect(analysis.persistPositionStates).toHaveBeenCalledWith(
    '90011087',
    'XAUUSD',
    mockPositionStates
  );
});
