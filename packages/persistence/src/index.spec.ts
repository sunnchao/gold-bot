import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryEaStore, createSqliteEaStore, persistenceStatus, type EaCommand } from './index.js';

async function withAdvancingDate<T>(startIso: string, stepMs: number, callback: () => T | Promise<T>): Promise<T> {
  const RealDate = Date;
  const startMs = RealDate.parse(startIso);
  let calls = 0;
  class AdvancingDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value == null) {
        super(startMs + calls * stepMs);
        calls += 1;
      } else {
        super(value);
      }
    }

    static now(): number {
      const value = startMs + calls * stepMs;
      calls += 1;
      return value;
    }
  }
  vi.stubGlobal('Date', AdvancingDate);
  try {
    return await callback();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('persistence scaffold', () => {
  it('declares that persistence does not write live commands', () => {
    expect(persistenceStatus.writesLiveCommands).toBe(false);
  });

  it('stores EA lifecycle snapshots by account', async () => {
    const store = createInMemoryEaStore();

    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      ai_symbols: ['XAUUSD']
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.8
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 }]
    });
    await store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
    });
    await store.saveOrderResult({
      account_id: '90011087',
      command_id: 'sig_1',
      result: 'filled',
      ticket: 1001
    });

    expect(await store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
    expect(await store.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
    expect(await store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.8 });
    expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
    expect(await store.getPositions('90011087')).toHaveLength(1);
    expect(await store.getOrderResults('90011087')).toEqual([
      {
        account_id: '90011087',
        command_id: 'sig_1',
        result: 'filled',
        ticket: 1001
      }
    ]);
  });

  it('isolates position snapshots by account and symbol while preserving account-wide reads', async () => {
    const store = createInMemoryEaStore();

    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{ ticket: 2002, symbol: 'GBPJPY', type: 'SELL', lots: 0.2 }]
    });

    expect((await store.getPositions('90011087', 'XAUUSD')).map((position) => position.ticket)).toEqual([1001]);
    expect((await store.getPositions('90011087', 'GBPJPY')).map((position) => position.ticket)).toEqual([2002]);
    expect((await store.getPositions('90011087')).map((position) => position.ticket).sort()).toEqual([1001, 2002]);
  });

  for (const testCase of [
    {
      name: 'in-memory',
      create() {
        return {
          store: createInMemoryEaStore(),
          cleanup() {}
        };
      }
    },
    {
      name: 'sqlite',
      create() {
        const dir = mkdtempSync(join(tmpdir(), 'gold-bot-position-state-'));
        return {
          store: createSqliteEaStore(join(dir, 'ea.sqlite')),
          cleanup() {
            rmSync(dir, { recursive: true, force: true });
          }
        };
      }
    }
  ]) {
    it(`stores symbol-scoped position manager states in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1001,
          tp1_hit: true,
          tp2_hit: false,
          max_profit_atr: 1.6,
          be_moved: true,
          be_trigger_atr: 1.5,
          best_sl: 0,
          open_time: '2026-04-13T06:00:00.000Z',
          last_modify_time: '2026-04-13T08:00:00.000Z'
        });
        await store.savePositionState('90011087', 'GBPJPY', {
          ticket: 1001,
          tp1_hit: false,
          tp2_hit: false,
          max_profit_atr: 0.4,
          be_moved: false,
          be_trigger_atr: 1.5,
          best_sl: 0,
          open_time: '2026-04-13T06:05:00.000Z',
          last_modify_time: '2026-04-13T08:05:00.000Z'
        });

        expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
          {
            ticket: 1001,
            tp1_hit: true,
            tp2_hit: false,
            max_profit_atr: 1.6,
            be_moved: true,
            be_trigger_atr: 1.5,
            best_sl: 0,
            open_time: '2026-04-13T06:00:00.000Z',
            last_modify_time: '2026-04-13T08:00:00.000Z'
          }
        ]);

        await store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1001,
          tp1_hit: true,
          tp2_hit: true,
          max_profit_atr: 2.4,
          be_moved: true,
          be_trigger_atr: 1.5,
          best_sl: 0,
          open_time: '2026-04-13T06:00:00.000Z',
          last_modify_time: '2026-04-13T09:00:00.000Z'
        });
        await store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1002,
          tp1_hit: false,
          tp2_hit: false,
          max_profit_atr: 0.2,
          be_moved: false,
          be_trigger_atr: 1.5,
          best_sl: 0,
          open_time: '2026-04-13T07:00:00.000Z',
          last_modify_time: '2026-04-13T07:00:00.000Z'
        });

        expect((await store.loadPositionStates('90011087', 'XAUUSD')).map((state) => state.ticket)).toEqual([1001, 1002]);
        await store.deleteStalePositionStates('90011087', 'XAUUSD', [1001]);
        expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
          {
            ticket: 1001,
            tp1_hit: true,
            tp2_hit: true,
            max_profit_atr: 2.4,
            be_moved: true,
            be_trigger_atr: 1.5,
            best_sl: 0,
            open_time: '2026-04-13T06:00:00.000Z',
            last_modify_time: '2026-04-13T09:00:00.000Z'
          }
        ]);
        expect((await store.loadPositionStates('90011087', 'GBPJPY')).map((state) => state.ticket)).toEqual([1001]);
        await store.deleteStalePositionStates('90011087', 'XAUUSD', []);
        expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`keeps only the latest AI result per symbol in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.saveAIResult('90011087', 'XAUUSD', { confidence: 70, bias: 'old' });
        await store.saveAIResult('90011087', 'GBPJPY', { confidence: 61, bias: 'cross' });
        await store.saveAIResult('90011087', 'XAUUSD', { confidence: 82, bias: 'new' });

        expect(await store.getAIResults('90011087')).toEqual([
          { account_id: '90011087', symbol: 'XAUUSD', confidence: 82, bias: 'new' },
          { account_id: '90011087', symbol: 'GBPJPY', confidence: 61, bias: 'cross' }
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });
  }

  it('delivers explicitly queued commands once without generating commands itself', async () => {
    const store = createInMemoryEaStore();
    const command: EaCommand = {
      command_id: 'sig_1',
      action: 'SIGNAL',
      strategy: 'pullback',
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 3345.5,
      sl: 3338,
      tp1: 3358,
      score: 7
    };

    expect(await store.pollCommands('90011087')).toEqual([]);

    await store.enqueueCommand('90011087', command);

    expect(await store.pollCommands('90011087')).toEqual([command]);
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('defaults an unseen account to oracle mode and persists explicit runtime modes', async () => {
    const store = createInMemoryEaStore();

    expect(await store.getRuntimeMode('90011087')).toBe('oracle');

    await store.setRuntimeMode('90011087', 'cutover');
    expect(await store.getRuntimeMode('90011087')).toBe('cutover');
  });

  it('stores command candidates and transitions them through queued, delivered, and acked states', async () => {
    const store = createInMemoryEaStore();

    const stored = await store.saveCommandCandidate('90011087', {
      source: 'ai_result',
      symbol: 'XAUUSD',
      action: 'SIGNAL',
      strategy: 'pullback',
      mode: 'approve'
    });

    expect(stored.status).toBe('draft');
    expect((await store.getCommand(stored.command_id))?.status).toBe('draft');

    await store.promoteCommand(stored.command_id);

    const delivered = await store.pollCommands('90011087');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ source: 'ai_result' });
    expect((await store.getCommand(stored.command_id))?.status).toBe('delivered');

    await store.reconcileCommandResult('90011087', stored.command_id, 'OK', 1001);
    expect(await store.getCommand(stored.command_id)).toMatchObject({
      status: 'acked',
      result: 'OK',
      ticket: 1001
    });
  });

  for (const testCase of [
    {
      name: 'in-memory',
      create() {
        return {
          store: createInMemoryEaStore(),
          cleanup() {}
        };
      }
    },
    {
      name: 'sqlite',
      create() {
        const dir = mkdtempSync(join(tmpdir(), 'gold-bot-expired-command-'));
        return {
          store: createSqliteEaStore(join(dir, 'ea.sqlite')),
          cleanup() {
            rmSync(dir, { recursive: true, force: true });
          }
        };
      }
    }
  ]) {
    it(`does not deliver expired queued commands in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await withAdvancingDate('2026-04-13T07:30:00.000Z', 4.5 * 60 * 60 * 1000, async () => {
          const legacy = await store.saveCommandCandidate('90011087', {
            command_id: 'sig_legacy_no_expiration',
            source: 'ai_approve',
            symbol: 'XAUUSD',
            action: 'SIGNAL',
            type: 'BUY',
            strategy: 'ai_signal',
            decision_id: 'tpv1_legacy_no_expiration'
          });
          await store.promoteCommand(legacy.command_id);

          expect(await store.pollCommands('90011087')).toEqual([]);
          expect(await store.getCommand(legacy.command_id)).toMatchObject({
            status: 'failed',
            result: 'expired',
            error_text: 'command expired before delivery',
            failed_at: '2026-04-13T12:00:00.000Z'
          });
        });

        await withAdvancingDate('2026-04-13T12:00:00.000Z', 0, async () => {
          const expired = await store.saveCommandCandidate('90011087', {
            command_id: 'sig_expired_before_delivery',
            source: 'ai_approve',
            symbol: 'XAUUSD',
            action: 'SIGNAL',
            type: 'BUY',
            strategy: 'ai_signal',
            decision_id: 'tpv1_expired_before_delivery',
            expiration: 1776078000
          });
          const active = await store.saveCommandCandidate('90011087', {
            command_id: 'sig_active_delivery',
            source: 'ai_approve',
            symbol: 'XAUUSD',
            action: 'SIGNAL',
            type: 'SELL',
            strategy: 'ai_signal',
            decision_id: 'tpv1_active_delivery',
            expiration: 1776085200
          });
          await store.promoteCommand(expired.command_id);
          await store.promoteCommand(active.command_id);

          expect(await store.pollCommands('90011087')).toEqual([
            expect.objectContaining({ command_id: 'sig_active_delivery' })
          ]);
          expect(await store.getCommand(expired.command_id)).toMatchObject({
            status: 'failed',
            result: 'expired',
            error_text: 'command expired before delivery',
            failed_at: '2026-04-13T12:00:00.000Z'
          });
          expect(await store.getCommand(active.command_id)).toMatchObject({
            status: 'delivered',
            delivered_at: '2026-04-13T12:00:00.000Z'
          });
          expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toContainEqual(
            expect.objectContaining({
              decision_id: 'tpv1_expired_before_delivery',
              stage: 'order_result',
              status: 'failed',
              reason_codes: ['command.SIGNAL', 'source.ai_approve'],
              summary: expect.objectContaining({
                result: 'expired',
                error_text: 'command expired before delivery'
              })
            })
          );
        });
      } finally {
        await store.close?.();
        cleanup();
      }
    });
  }

  for (const testCase of [
    {
      name: 'in-memory',
      create() {
        return {
          store: createInMemoryEaStore(),
          cleanup() {}
        };
      }
    },
    {
      name: 'sqlite',
      create() {
        const dir = mkdtempSync(join(tmpdir(), 'gold-bot-order-result-'));
        return {
          store: createSqliteEaStore(join(dir, 'ea.sqlite')),
          cleanup() {
            rmSync(dir, { recursive: true, force: true });
          }
        };
      }
    }
  ]) {
    it(`applies order results only to delivered commands in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = await store.saveCommandCandidate('90011087', {
          command_id: 'sig_order_ack',
          source: 'ai_result',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_order_ack'
        });
        await store.promoteCommand(stored.command_id);

        expect(
          await store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'OK',
            1001,
            '',
            '2026-04-13T08:00:00.000Z'
          )
        ).toBe(false);
        expect(await store.getCommand(stored.command_id)).toMatchObject({ status: 'queued' });
        expect(await store.getOrderResults('90011087')).toEqual([]);

        expect(await store.pollCommands('90011087')).toHaveLength(1);
        expect(
          await store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'OK',
            1001,
            '',
            '2026-04-13T08:01:00.000Z'
          )
        ).toBe(true);
        expect(await store.getCommand(stored.command_id)).toMatchObject({
          status: 'acked',
          result: 'OK',
          ticket: 1001,
          acked_at: '2026-04-13T08:01:00.000Z',
          error_text: ''
        });
        expect(await store.getOrderResults('90011087')).toEqual([
          {
            account_id: '90011087',
            command_id: stored.command_id,
            result: 'OK',
            ticket: 1001,
            error_text: '',
            created_at: '2026-04-13T08:01:00.000Z'
          }
        ]);
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'acked' })).toEqual([
          expect.objectContaining({
            decision_id: 'tpv1_order_ack',
            stage: 'order_result',
            status: 'acked',
            reason_codes: ['command.SIGNAL', 'source.ai_result'],
            related_command_id: stored.command_id,
            created_at: '2026-04-13T08:01:00.000Z',
            summary: {
              command_id: stored.command_id,
              action: 'SIGNAL',
              result: 'OK',
              ticket: 1001,
              error_text: ''
            }
          })
        ]);

        expect(
          await store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'ERROR',
            0,
            'late failure',
            '2026-04-13T08:02:00.000Z'
          )
        ).toBe(false);
        expect(
          await store.reconcileCommandResult(
            '90022000',
            stored.command_id,
            'OK',
            1002,
            '',
            '2026-04-13T08:03:00.000Z'
          )
        ).toBe(false);
        expect(
          await store.reconcileCommandResult(
            '90011087',
            'sig_missing',
            'ERROR',
            0,
            'missing',
            '2026-04-13T08:04:00.000Z'
          )
        ).toBe(false);
        expect(await store.getOrderResults('90011087')).toHaveLength(1);
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'failed' })).toEqual([]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`records failed delivered order results with error text in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = await store.saveCommandCandidate('90011087', {
          command_id: 'sig_order_fail',
          source: 'position_review',
          symbol: 'XAUUSD',
          action: 'MODIFY',
          ticket: 2002,
          decision_id: 'tpv1_order_fail'
        });
        await store.promoteCommand(stored.command_id);
        expect(await store.pollCommands('90011087')).toHaveLength(1);

        expect(
          await store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'REJECTED',
            0,
            'invalid stops',
            '2026-04-13T09:01:00.000Z'
          )
        ).toBe(true);
        expect(await store.getCommand(stored.command_id)).toMatchObject({
          status: 'failed',
          result: 'REJECTED',
          ticket: 0,
          failed_at: '2026-04-13T09:01:00.000Z',
          error_text: 'invalid stops'
        });
        expect(await store.getOrderResults('90011087')).toEqual([
          {
            account_id: '90011087',
            command_id: stored.command_id,
            result: 'REJECTED',
            ticket: 0,
            error_text: 'invalid stops',
            created_at: '2026-04-13T09:01:00.000Z'
          }
        ]);
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'failed' })).toEqual([
          expect.objectContaining({
            decision_id: 'tpv1_order_fail',
            stage: 'order_result',
            status: 'failed',
            reason_codes: ['command.MODIFY', 'source.position_review'],
            related_command_id: stored.command_id,
            created_at: '2026-04-13T09:01:00.000Z',
            summary: {
              command_id: stored.command_id,
              action: 'MODIFY',
              result: 'REJECTED',
              ticket: 0,
              error_text: 'invalid stops'
            }
          })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });
  }

  for (const testCase of [
    {
      name: 'in-memory',
      create() {
        return {
          store: createInMemoryEaStore(),
          cleanup() {}
        };
      }
    },
    {
      name: 'sqlite',
      create() {
        const dir = mkdtempSync(join(tmpdir(), 'gold-bot-command-timeline-'));
        return {
          store: createSqliteEaStore(join(dir, 'ea.sqlite')),
          cleanup() {
            rmSync(dir, { recursive: true, force: true });
          }
        };
      }
    }
  ]) {
    it(`records command enqueue and delivery decision events in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = await store.saveCommandCandidate('90011087', {
          command_id: 'sig_timeline',
          source: 'ai_result',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_timeline'
        });

        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([]);
        await store.promoteCommand(stored.command_id);

        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
          expect.objectContaining({
            decision_id: 'tpv1_timeline',
            stage: 'command_enqueued',
            status: 'pending',
            reason_codes: ['command.SIGNAL', 'source.ai_result'],
            related_command_id: stored.command_id,
            created_at: stored.created_at,
            summary: {
              command_id: stored.command_id,
              action: 'SIGNAL'
            }
          })
        ]);

        expect(await store.pollCommands('90011087')).toHaveLength(1);
        const deliveredAt = (await store.getCommand(stored.command_id))?.delivered_at;
        expect(deliveredAt).toBeDefined();
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
          expect.objectContaining({
            decision_id: 'tpv1_timeline',
            stage: 'command_delivered',
            status: 'delivered',
            reason_codes: ['command.SIGNAL', 'source.ai_result'],
            related_command_id: stored.command_id,
            created_at: deliveredAt,
            summary: {
              command_id: stored.command_id,
              action: 'SIGNAL'
            }
          }),
          expect.objectContaining({
            decision_id: 'tpv1_timeline',
            stage: 'command_enqueued',
            status: 'pending'
          })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`uses one delivered_at timestamp for each poll batch in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const first = await store.saveCommandCandidate('90011087', {
          command_id: 'sig_batch_a',
          source: 'ai_result',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_batch_a'
        });
        const second = await store.saveCommandCandidate('90011087', {
          command_id: 'sig_batch_b',
          source: 'ai_result',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_batch_b'
        });
        await store.promoteCommand(first.command_id);
        await store.promoteCommand(second.command_id);

        await withAdvancingDate('2026-04-13T08:00:00.000Z', 1000, async () => {
          expect(await store.pollCommands('90011087')).toHaveLength(2);
        });

        const firstDeliveredAt = (await store.getCommand(first.command_id))?.delivered_at;
        const secondDeliveredAt = (await store.getCommand(second.command_id))?.delivered_at;
        expect(firstDeliveredAt).toBe('2026-04-13T08:00:00.000Z');
        expect(secondDeliveredAt).toBe(firstDeliveredAt);
        const deliveredEvents = (await store
          .listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'delivered' }))
          .filter((event) => event.stage === 'command_delivered');
        expect(new Set(deliveredEvents.map((event) => event.created_at))).toEqual(new Set([firstDeliveredAt]));
      } finally {
        vi.unstubAllGlobals();
        await store.close?.();
        cleanup();
      }
    });

    it(`preserves AI approve command source in ${testCase.name} decision events`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = await store.saveCommandCandidate('90011087', {
          command_id: 'ai_pending_90011087_XAUUSD_buy',
          source: 'ai_approve',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_ai_approve'
        });

        await store.promoteCommand(stored.command_id);

        expect(await store.getCommand(stored.command_id)).toMatchObject({
          source: 'ai_approve'
        });
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
          expect.objectContaining({
            decision_id: 'tpv1_ai_approve',
            stage: 'command_enqueued',
            status: 'pending',
            reason_codes: ['command.SIGNAL', 'source.ai_approve'],
            related_command_id: stored.command_id
          })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`detects active AI approve pending commands in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        const nowIso = '2026-04-13T08:00:00.000Z';
        const active = await store.saveCommandCandidate('90011087', {
          command_id: 'ai_pending_90011087_XAUUSD_active',
          source: 'ai_approve',
          symbol: 'XAUUSD',
          type: 'BUY',
          action: 'SIGNAL',
          expiration: 1776081600
        });

        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'buy', nowIso)).toBe(false);
        await store.promoteCommand(active.command_id);
        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'buy', nowIso)).toBe(true);
        expect(await store.hasActiveAIApprovePending('other-account', 'XAUUSD', 'buy', nowIso)).toBe(false);
        expect(await store.hasActiveAIApprovePending('90011087', 'GBPJPY', 'buy', nowIso)).toBe(false);
        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'sell', nowIso)).toBe(false);

        await store.pollCommands('90011087');
        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'buy', nowIso)).toBe(false);

        const expired = await store.saveCommandCandidate('90011087', {
          command_id: 'ai_pending_90011087_XAUUSD_expired',
          source: 'ai_approve',
          symbol: 'XAUUSD',
          type: 'SELL',
          action: 'SIGNAL',
          expiration: 1776067199
        });
        await store.promoteCommand(expired.command_id);
        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'sell', nowIso)).toBe(false);

        const otherSource = await store.saveCommandCandidate('90011087', {
          command_id: 'ai_result_90011087_XAUUSD_buy',
          source: 'ai_result',
          symbol: 'XAUUSD',
          type: 'BUY',
          action: 'SIGNAL',
          expiration: 1776081600
        });
        await store.promoteCommand(otherSource.command_id);
        expect(await store.hasActiveAIApprovePending('90011087', 'XAUUSD', 'buy', nowIso)).toBe(false);
      } finally {
        await store.close?.();
        cleanup();
      }
    });
  }

  it('stores and reloads the latest shadow runtime snapshot by account, symbol, and source', async () => {
    const store = createInMemoryEaStore();

    await store.saveShadowSnapshot({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY' },
      command: { action: 'SIGNAL', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });

    expect(await store.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ea_analysis')).toEqual({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY' },
      command: { action: 'SIGNAL', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });
  });

  it('filters and summarizes shadow comparisons for qualification checks', async () => {
    const store = createInMemoryEaStore();

    await store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:00:00.000Z'
    });
    await store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: false,
      signal_drift: true,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:10:00.000Z'
    });
    await store.recordShadowComparison({
      account_id: '90022098',
      symbol: 'GBPJPY',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: false,
      source: 'ai_result',
      created_at: '2026-07-03T00:20:00.000Z'
    });

    expect(await store.listShadowComparisons({ account_id: '90011087', signal_drift: true })).toEqual([
      {
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: false,
        signal_drift: true,
        command_drift: false,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:10:00.000Z'
      }
    ]);
    expect(await store.summarizeShadowComparisons({ account_id: '90011087', source: 'ea_analysis' })).toEqual({
      comparisons: 2,
      protocol_errors: 1,
      signal_drifts: 1,
      command_drifts: 0,
      oracle_compared: 2,
      first_created_at: '2026-07-03T00:00:00.000Z',
      last_created_at: '2026-07-03T00:10:00.000Z'
    });
  });

  it('stores decision events newest-first with account, symbol, status, and limit filters', async () => {
    const store = createInMemoryEaStore();

    await store.recordDecisionEvent({
      decision_id: 'tpv1_old',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'candidate_signal',
      status: 'pending',
      reason_codes: ['candidate.created'],
      summary: { score: 7 },
      related_command_id: '',
      created_at: '2026-04-13T07:59:00.000Z'
    });
    await store.recordDecisionEvent({
      decision_id: 'tpv1_rejected',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'risk_gate',
      status: 'rejected',
      reason_codes: ['risk.spread.wide'],
      summary: { max_lots: 0 },
      related_command_id: 'sig_rejected',
      created_at: '2026-04-13T08:01:00.000Z'
    });
    await store.recordDecisionEvent({
      decision_id: 'tpv1_other_symbol',
      account_id: '90011087',
      symbol: 'GBPJPY',
      stage: 'risk_gate',
      status: 'accepted',
      reason_codes: [],
      summary: {},
      related_command_id: 'sig_other',
      created_at: '2026-04-13T08:02:00.000Z'
    });
    await store.recordDecisionEvent({
      decision_id: 'tpv1_other_account',
      account_id: '90022098',
      symbol: 'XAUUSD',
      stage: 'risk_gate',
      status: 'rejected',
      reason_codes: ['risk.limit'],
      summary: {},
      related_command_id: '',
      created_at: '2026-04-13T08:03:00.000Z'
    });

    expect((await store.listDecisionEvents({ account_id: '90011087' })).map((event) => event.decision_id)).toEqual([
      'tpv1_other_symbol',
      'tpv1_rejected',
      'tpv1_old'
    ]);
    expect(
      await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'rejected', limit: 1 })
    ).toEqual([
      {
        id: 2,
        decision_id: 'tpv1_rejected',
        account_id: '90011087',
        symbol: 'XAUUSD',
        stage: 'risk_gate',
        status: 'rejected',
        reason_codes: ['risk.spread.wide'],
        summary: { max_lots: 0 },
        related_command_id: 'sig_rejected',
        created_at: '2026-04-13T08:01:00.000Z'
      }
    ]);
  });

  it('lists account symbols and explicitly stored pending signals', async () => {
    const store = createInMemoryEaStore();
    const pendingSignal = {
      account_id: '90011087',
      symbol: 'XAUUSD',
      strategy: 'pullback',
      side: 'buy',
      score: 9,
      status: 'pending'
    };

    await store.saveRegistration({
      account_id: '90011087',
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'US100Cash',
      bid: 18000,
      ask: 18002
    });
    await store.savePendingSignal(pendingSignal);

    expect(await store.listAccountIds()).toEqual(['90011087']);
    expect(await store.listSymbols('90011087')).toEqual(['US100Cash']);
    expect(await store.listAISymbols('90011087')).toEqual(['XAUUSD', 'GBPJPY']);
    expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([expect.objectContaining({ ...pendingSignal, id: 1 })]);
    expect(await store.getPendingSignals('90011087', 'GBPJPY')).toEqual([]);
  });

  it('does not create account ids from symbol-scoped AI results', async () => {
    const store = createInMemoryEaStore();

    await store.saveAIResult('90011087', 'XAUUSD', { confidence: 80 });

    expect(await store.listAccountIds()).toEqual(['90011087']);
  });

  for (const testCase of [
    {
      name: 'in-memory',
      create() {
        return {
          store: createInMemoryEaStore(),
          cleanup() {}
        };
      }
    },
    {
      name: 'sqlite',
      create() {
        const dir = mkdtempSync(join(tmpdir(), 'gold-bot-pending-signal-decision-'));
        return {
          store: createSqliteEaStore(join(dir, 'ea.sqlite')),
          cleanup() {
            rmSync(dir, { recursive: true, force: true });
          }
        };
      }
    }
  ]) {
    it(`records candidate_signal decision events for pending signals in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.savePendingSignal({
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          score: 87,
          strategy: 'momentum_scalp',
          status: 'pending',
          created_at: '2026-04-13T08:00:00.000Z',
          expires_at: '2026-04-13T08:01:00.000Z'
        });

        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
          expect.objectContaining({
            decision_id: 'candidate_90011087_XAUUSD_1',
            stage: 'candidate_signal',
            status: 'pending',
            reason_codes: ['candidate.momentum_scalp'],
            related_command_id: '',
            created_at: '2026-04-13T08:00:00.000Z',
            summary: {
              signal_id: 1,
              side: 'buy',
              score: 87,
              strategy: 'momentum_scalp',
              expires_at: '2026-04-13T08:01:00.000Z'
            }
          })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`updates explicit pending signal ids without inserting or duplicating decisions in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.savePendingSignal({
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          score: 87,
          strategy: 'momentum_scalp',
          status: 'pending',
          created_at: '2026-04-13T08:00:00.000Z',
          expires_at: '2026-04-13T08:01:00.000Z'
        });
        await store.savePendingSignal({
          id: 1,
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          score: 91,
          strategy: 'momentum_scalp',
          status: 'pending',
          created_at: '2026-04-13T08:00:15.000Z',
          expires_at: '2026-04-13T08:02:00.000Z'
        });
        await store.savePendingSignal({
          id: 99,
          account_id: '90011087',
          symbol: 'GBPJPY',
          side: 'sell',
          score: 70,
          strategy: 'range',
          status: 'pending',
          created_at: '2026-04-13T08:00:30.000Z',
          expires_at: '2026-04-13T08:02:00.000Z'
        });

        expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([
          expect.objectContaining({ id: 1, score: 91, expires_at: '2026-04-13T08:02:00.000Z' })
        ]);
        expect(await store.getPendingSignals('90011087', 'GBPJPY')).toEqual([]);
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toHaveLength(1);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`allocates pending signal ids before recording candidate decisions in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.savePendingSignal({
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          score: 87,
          strategy: 'momentum_scalp',
          status: 'pending',
          created_at: '2026-04-13T08:00:00.000Z',
          expires_at: '2026-04-13T08:01:00.000Z'
        });

        expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([
          expect.objectContaining({ id: 1, strategy: 'momentum_scalp' })
        ]);
        expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
          expect.objectContaining({
            decision_id: 'candidate_90011087_XAUUSD_1',
            stage: 'candidate_signal',
            summary: expect.objectContaining({ signal_id: 1 })
          })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });

    it(`expires pending signals using UTC-normalized timestamps in ${testCase.name} storage`, async () => {
      const { store, cleanup } = testCase.create();
      try {
        await store.savePendingSignal({
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          score: 87,
          strategy: 'momentum_scalp',
          status: 'pending',
          created_at: '2026-04-13T07:59:00.000Z',
          expires_at: '2026-04-13T16:00:00+08:00'
        });
        await store.savePendingSignal({
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'sell',
          score: 74,
          strategy: 'range',
          status: 'pending',
          created_at: '2026-04-13T08:00:00.000Z',
          expires_at: '2026-04-13T16:02:00+08:00'
        });

        expect(await store.expirePendingSignals('2026-04-13T08:00:01.000Z')).toBe(1);
        expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([
          expect.objectContaining({ id: 2, status: 'pending' })
        ]);
      } finally {
        await store.close?.();
        cleanup();
      }
    });
  }

  it('updates and expires pending signal arbitration state', async () => {
    const store = createInMemoryEaStore();
    await store.savePendingSignal({
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      score: 9,
      strategy: 'pullback',
      status: 'pending',
      created_at: '2026-04-13T08:00:00.000Z',
      expires_at: '2026-04-13T08:10:00.000Z',
      arbitration_result: '',
      arbitration_reason: ''
    });
    await store.savePendingSignal({
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'sell',
      score: 7,
      strategy: 'range',
      status: 'pending',
      created_at: '2026-04-13T08:01:00.000Z',
      expires_at: '2026-04-13T08:02:00.000Z',
      arbitration_result: '',
      arbitration_reason: ''
    });

    expect(await store.updatePendingSignalArbitration(1, 'approved', 'manual ok')).toBe(true);
    expect((await store.getPendingSignals('90011087', 'XAUUSD')).map((signal) => signal.id)).toEqual([2]);
    expect(await store.expirePendingSignals('2026-04-13T08:03:00.000Z')).toBe(1);
    expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);
    expect(await store.updatePendingSignalArbitration(999, 'approved', 'missing')).toBe(false);
  });

  it('stores and deletes API token records', async () => {
    const store = createInMemoryEaStore();

    await store.saveApiToken({
      token: 'user-token',
      name: 'Desk',
      accounts: ['90011087', '90022000'],
      is_admin: false,
      created_at: '2026-04-13T08:00:00.000Z'
    });

    expect(await store.listApiTokens()).toEqual([
      {
        token: 'user-token',
        name: 'Desk',
        accounts: ['90011087', '90022000'],
        is_admin: false,
        created_at: '2026-04-13T08:00:00.000Z'
      }
    ]);
    expect(await store.deleteApiToken('user-token')).toBe(true);
    expect(await store.listApiTokens()).toEqual([]);
  });

  it('persists EA lifecycle snapshots and queued commands in SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-bot-persistence-'));
    const dbPath = join(dir, 'ea.sqlite');
    const command: EaCommand = {
      command_id: 'sig_1',
      action: 'SIGNAL',
      strategy: 'pullback',
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 3345.5,
      sl: 3338,
      tp1: 3358,
      score: 7
    };

    try {
      const store = createSqliteEaStore(dbPath);
      await store.saveRegistration({ account_id: '90011087', broker: 'Demo Broker', ai_symbols: ['XAUUSD', 'GBPJPY'] });
      await store.saveHeartbeat({ account_id: '90011087', equity: 1100.25, ai_symbols: ['XAUUSD', 'GBPJPY'] });
      await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.55, ask: 3335.75 });
      await store.saveBars({
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: [{ time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 }]
      });
      await store.savePositions({ account_id: '90011087', positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY' }] });
      await store.savePendingSignal({ account_id: '90011087', symbol: 'XAUUSD', strategy: 'pullback', side: 'buy' });
      await store.saveAIResult('90011087', 'XAUUSD', { confidence: 82 });
      await store.saveShadowSnapshot({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        signal: { strategy: 'pullback', side: 'BUY' },
        command: { action: 'SIGNAL', tp1: 3358 },
        created_at: '2026-07-03T00:00:00.000Z'
      });
      await store.recordShadowComparison({
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: false,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:00:00.000Z'
      });
      await store.recordShadowComparison({
        account_id: '90011087',
        symbol: 'GBPJPY',
        protocol_ok: false,
        signal_drift: true,
        command_drift: false,
        oracle_compared: true,
        source: 'ai_result',
        created_at: '2026-07-03T00:05:00.000Z'
      });
      await store.recordDecisionEvent({
        decision_id: 'tpv1_persisted',
        account_id: '90011087',
        symbol: 'XAUUSD',
        stage: 'risk_gate',
        status: 'rejected',
        reason_codes: ['risk.spread.wide'],
        summary: { max_lots: 0 },
        related_command_id: 'sig_persisted',
        created_at: '2026-07-03T00:06:00.000Z'
      });
      await store.saveApiToken({
        token: 'user-token',
        name: 'Desk',
        accounts: ['90011087', '90022000'],
        is_admin: false,
        created_at: '2026-07-03T00:07:00.000Z'
      });
      await store.enqueueCommand('90011087', command);
      await store.setRuntimeMode('90011087', 'cutover');
      const candidate = await store.saveCommandCandidate('90011087', {
        command_id: 'candidate_1',
        source: 'ai_result',
        symbol: 'XAUUSD',
        action: 'SIGNAL',
        strategy: 'pullback',
        mode: 'approve'
      });
      await store.promoteCommand(candidate.command_id);
      expect(await store.pollCommands('90011087')).toEqual(expect.arrayContaining([
        expect.objectContaining({ command_id: command.command_id }),
        expect.objectContaining({ command_id: candidate.command_id })
      ]));
      await store.reconcileCommandResult('90011087', candidate.command_id, 'OK', 999001);
      await store.close();

      const reopened = createSqliteEaStore(dbPath);
      expect(await reopened.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
      expect(await reopened.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
      expect(await reopened.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.75 });
      expect(await reopened.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
      expect(await reopened.getPositions('90011087')).toHaveLength(1);
      expect(await reopened.getPendingSignals('90011087', 'XAUUSD')).toHaveLength(1);
      expect(await reopened.updatePendingSignalArbitration(1, 'rejected', 'manual reject')).toBe(true);
      expect(await reopened.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);
      expect(await reopened.getAIResults('90011087')).toHaveLength(1);
      expect(await reopened.listSymbols('90011087')).toEqual(['XAUUSD']);
      expect(await reopened.getRuntimeMode('90011087')).toBe('cutover');
      expect(await reopened.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ea_analysis')).toEqual({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        signal: { strategy: 'pullback', side: 'BUY' },
        command: { action: 'SIGNAL', tp1: 3358 },
        created_at: '2026-07-03T00:00:00.000Z'
      });
      expect(await reopened.listShadowComparisons({ source: 'ai_result' })).toEqual([
        {
          account_id: '90011087',
          symbol: 'GBPJPY',
          protocol_ok: false,
          signal_drift: true,
          command_drift: false,
          oracle_compared: true,
          source: 'ai_result',
          created_at: '2026-07-03T00:05:00.000Z'
        }
      ]);
      expect(await reopened.summarizeShadowComparisons({ account_id: '90011087' })).toEqual({
        comparisons: 2,
        protocol_errors: 1,
        signal_drifts: 1,
        command_drifts: 0,
        oracle_compared: 2,
        first_created_at: '2026-07-03T00:00:00.000Z',
        last_created_at: '2026-07-03T00:05:00.000Z'
      });
      expect(await reopened.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'rejected' })).toEqual([
        expect.objectContaining({
          decision_id: 'tpv1_persisted',
          account_id: '90011087',
          symbol: 'XAUUSD',
          stage: 'risk_gate',
          status: 'rejected',
          reason_codes: ['risk.spread.wide'],
          summary: { max_lots: 0 },
          related_command_id: 'sig_persisted',
          created_at: '2026-07-03T00:06:00.000Z'
        })
      ]);
      expect(await reopened.listApiTokens()).toEqual([
        {
          token: 'user-token',
          name: 'Desk',
          accounts: ['90011087', '90022000'],
          is_admin: false,
          created_at: '2026-07-03T00:07:00.000Z'
        }
      ]);
      expect(await reopened.getCommand('candidate_1')).toMatchObject({
        status: 'acked',
        result: 'OK',
        ticket: 999001
      });
      expect(await reopened.pollCommands('90011087')).toEqual([]);
      await reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
