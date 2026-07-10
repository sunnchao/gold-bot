import { describe, expect, it } from 'vitest';
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

  it('queues AI stop-loss modify commands during position review when no replay signal is produced', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3333.9, ask: 3334.1 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 3333, high: 3335, low: 3330, close: 3334, atr: 1.5 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY', open_price: 3333, lots: 0.2, sl: 3331, tp: 3344 }]
    });
    await store.saveAIResult('90011087', 'XAUUSD', {
      suggested_sl: 3332.8,
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

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    const commands = await store.listCommands('90011087');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      command_id: expect.stringMatching(/^mod_[0-9a-f]{16}$/),
      action: 'MODIFY',
      source: 'ai_stop_loss',
      status: 'queued',
      symbol: 'XAUUSD',
      ticket: 123456,
      new_sl: 3332.8,
      sl: 3332.8,
      tp: 3344,
      old_sl: 3331,
      distance: expect.closeTo(1.8, 10),
      atr: 1.5,
      decision_id: 'tpv1_modify_sl',
      trigger_time: '2026-04-13T08:02:00.000Z',
      analysis_mode: 'positions'
    });
  });

  it('suppresses AI stop-loss modify commands for the same ticket inside the five-minute cooldown', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    await saveTradeableHeartbeat(store);
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3333.9, ask: 3334.1 });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026-04-13T07:00:00.000Z', open: 3333, high: 3335, low: 3330, close: 3334, atr: 1.5 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY', open_price: 3333, lots: 0.2, sl: 3331, tp: 3344 }]
    });
    await store.saveAIResult('90011087', 'XAUUSD', {
      suggested_sl: 3332.8,
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

    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    now = '2026-04-13T08:04:00.000Z';
    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');
    now = '2026-04-13T08:07:00.000Z';
    await scheduler.enqueuePositionReview('90011087', 'XAUUSD');

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
      open_time: '2026-04-13T06:00:00.000Z',
      last_modify_time: '2026-04-13T07:00:00.000Z'
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

async function saveTradeableHeartbeat(store: ReturnType<typeof createInMemoryEaStore>) {
  await store.saveHeartbeat({
    account_id: '90011087',
    market_open: true,
    is_trade_allowed: true
  });
}
