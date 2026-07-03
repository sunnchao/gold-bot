import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { SchedulerService } from './service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';
import { AnalysisService } from '../analysis/service.js';

describe('SchedulerService', () => {
  it('publishes replay signals through the command lifecycle for cutover accounts', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.9, ask: 3336.1 });
    store.saveBars({
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

    scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');
    scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');

    const commands = store.listCommands('90011087');
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

  it('skips replay analysis for non-live strategy timeframes', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
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

    scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'D1');

    expect(calls).toBe(0);
    expect(store.listCommands('90011087')).toEqual([]);
  });

  it('skips replay analysis when EA runtime is not tradeable', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    store.saveHeartbeat({
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

    scheduler.enqueueAnalysis('90011087', 'XAUUSD', 'H1');

    expect(calls).toBe(0);
    expect(store.listCommands('90011087')).toEqual([]);
  });

  it('publishes replay position commands through the command lifecycle for cutover accounts', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
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
      commandLifecycle
    );

    scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    expect(store.listCommands('90011087')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'MODIFY',
          source: 'position_review',
          status: 'queued',
          ticket: 777,
          new_sl: 3330
        }),
        expect.objectContaining({
          action: 'CLOSE',
          source: 'position_review',
          status: 'queued',
          ticket: 777,
          lots: 0.04
        })
      ])
    );
  });

  it('hydrates and persists position manager state during position review', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3343.1, ask: 3343.2 });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: flatH1Bars(15)
    });
    store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 202, symbol: 'XAUUSD', type: 'BUY', open_price: 3340, lots: 0.5, sl: 3340 }]
    });
    store.savePositionState('90011087', 'XAUUSD', {
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
    const scheduler = new SchedulerService(analysis, new CommandLifecycleService(store));

    scheduler.enqueuePositionReview('90011087', 'XAUUSD');

    expect(store.listCommands('90011087')).toEqual([]);
    expect(store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
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
