import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { SchedulerService } from './service.js';
import { CommandLifecycleService } from '../command-lifecycle/service.js';

describe('SchedulerService', () => {
  it('publishes replay signals through the command lifecycle for cutover accounts', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    const commandLifecycle = new CommandLifecycleService(store);
    const scheduler = new SchedulerService(
      {
        analyzeAccountSymbol() {
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
      commandLifecycle
    );

    scheduler.enqueueAnalysis('90011087', 'XAUUSD');

    const commands = store.listCommands('90011087');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      source: 'ea_analysis',
      status: 'queued',
      strategy: 'pullback'
    });
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
});
