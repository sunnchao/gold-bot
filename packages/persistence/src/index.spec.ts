import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryEaStore, createSqliteEaStore, persistenceStatus, type EaCommand } from './index.js';

describe('persistence scaffold', () => {
  it('declares that persistence does not write live commands', () => {
    expect(persistenceStatus.writesLiveCommands).toBe(false);
  });

  it('stores EA lifecycle snapshots by account', () => {
    const store = createInMemoryEaStore();

    store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      ai_symbols: ['XAUUSD']
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.8
    });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: [{ time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 }]
    });
    store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
    });
    store.saveOrderResult({
      account_id: '90011087',
      command_id: 'sig_1',
      result: 'filled',
      ticket: 1001
    });

    expect(store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
    expect(store.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
    expect(store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.8 });
    expect(store.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
    expect(store.getPositions('90011087')).toHaveLength(1);
    expect(store.getOrderResults('90011087')).toEqual([
      {
        account_id: '90011087',
        command_id: 'sig_1',
        result: 'filled',
        ticket: 1001
      }
    ]);
  });

  it('isolates position snapshots by account and symbol while preserving account-wide reads', () => {
    const store = createInMemoryEaStore();

    store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
    });
    store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{ ticket: 2002, symbol: 'GBPJPY', type: 'SELL', lots: 0.2 }]
    });

    expect(store.getPositions('90011087', 'XAUUSD').map((position) => position.ticket)).toEqual([1001]);
    expect(store.getPositions('90011087', 'GBPJPY').map((position) => position.ticket)).toEqual([2002]);
    expect(store.getPositions('90011087').map((position) => position.ticket).sort()).toEqual([1001, 2002]);
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
    it(`stores symbol-scoped position manager states in ${testCase.name} storage`, () => {
      const { store, cleanup } = testCase.create();
      try {
        store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1001,
          tp1_hit: true,
          tp2_hit: false,
          max_profit_atr: 1.6,
          be_moved: true,
          be_trigger_atr: 1.5,
          open_time: '2026-04-13T06:00:00.000Z',
          last_modify_time: '2026-04-13T08:00:00.000Z'
        });
        store.savePositionState('90011087', 'GBPJPY', {
          ticket: 1001,
          tp1_hit: false,
          tp2_hit: false,
          max_profit_atr: 0.4,
          be_moved: false,
          be_trigger_atr: 1.5,
          open_time: '2026-04-13T06:05:00.000Z',
          last_modify_time: '2026-04-13T08:05:00.000Z'
        });

        expect(store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
          {
            ticket: 1001,
            tp1_hit: true,
            tp2_hit: false,
            max_profit_atr: 1.6,
            be_moved: true,
            be_trigger_atr: 1.5,
            open_time: '2026-04-13T06:00:00.000Z',
            last_modify_time: '2026-04-13T08:00:00.000Z'
          }
        ]);

        store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1001,
          tp1_hit: true,
          tp2_hit: true,
          max_profit_atr: 2.4,
          be_moved: true,
          be_trigger_atr: 1.5,
          open_time: '2026-04-13T06:00:00.000Z',
          last_modify_time: '2026-04-13T09:00:00.000Z'
        });
        store.savePositionState('90011087', 'XAUUSD', {
          ticket: 1002,
          tp1_hit: false,
          tp2_hit: false,
          max_profit_atr: 0.2,
          be_moved: false,
          be_trigger_atr: 1.5,
          open_time: '2026-04-13T07:00:00.000Z',
          last_modify_time: '2026-04-13T07:00:00.000Z'
        });

        expect(store.loadPositionStates('90011087', 'XAUUSD').map((state) => state.ticket)).toEqual([1001, 1002]);
        store.deleteStalePositionStates('90011087', 'XAUUSD', [1001]);
        expect(store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
          {
            ticket: 1001,
            tp1_hit: true,
            tp2_hit: true,
            max_profit_atr: 2.4,
            be_moved: true,
            be_trigger_atr: 1.5,
            open_time: '2026-04-13T06:00:00.000Z',
            last_modify_time: '2026-04-13T09:00:00.000Z'
          }
        ]);
        expect(store.loadPositionStates('90011087', 'GBPJPY').map((state) => state.ticket)).toEqual([1001]);
        store.deleteStalePositionStates('90011087', 'XAUUSD', []);
        expect(store.loadPositionStates('90011087', 'XAUUSD')).toEqual([]);
      } finally {
        store.close?.();
        cleanup();
      }
    });
  }

  it('delivers explicitly queued commands once without generating commands itself', () => {
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

    expect(store.pollCommands('90011087')).toEqual([]);

    store.enqueueCommand('90011087', command);

    expect(store.pollCommands('90011087')).toEqual([command]);
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('defaults an unseen account to oracle mode and persists explicit runtime modes', () => {
    const store = createInMemoryEaStore();

    expect(store.getRuntimeMode('90011087')).toBe('oracle');

    store.setRuntimeMode('90011087', 'cutover');
    expect(store.getRuntimeMode('90011087')).toBe('cutover');
  });

  it('stores command candidates and transitions them through queued, delivered, and acked states', () => {
    const store = createInMemoryEaStore();

    const stored = store.saveCommandCandidate('90011087', {
      source: 'ai_result',
      symbol: 'XAUUSD',
      action: 'SIGNAL',
      strategy: 'pullback',
      mode: 'approve'
    });

    expect(stored.status).toBe('draft');
    expect(store.getCommand(stored.command_id)?.status).toBe('draft');

    store.promoteCommand(stored.command_id);

    const delivered = store.pollCommands('90011087');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ source: 'ai_result' });
    expect(store.getCommand(stored.command_id)?.status).toBe('delivered');

    store.reconcileCommandResult('90011087', stored.command_id, 'OK', 1001);
    expect(store.getCommand(stored.command_id)).toMatchObject({
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
    it(`applies order results only to delivered commands in ${testCase.name} storage`, () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = store.saveCommandCandidate('90011087', {
          command_id: 'sig_order_ack',
          source: 'ai_result',
          symbol: 'XAUUSD',
          action: 'SIGNAL',
          strategy: 'ai_signal',
          decision_id: 'tpv1_order_ack'
        });
        store.promoteCommand(stored.command_id);

        expect(
          store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'OK',
            1001,
            '',
            '2026-04-13T08:00:00.000Z'
          )
        ).toBe(false);
        expect(store.getCommand(stored.command_id)).toMatchObject({ status: 'queued' });
        expect(store.getOrderResults('90011087')).toEqual([]);

        expect(store.pollCommands('90011087')).toHaveLength(1);
        expect(
          store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'OK',
            1001,
            '',
            '2026-04-13T08:01:00.000Z'
          )
        ).toBe(true);
        expect(store.getCommand(stored.command_id)).toMatchObject({
          status: 'acked',
          result: 'OK',
          ticket: 1001,
          acked_at: '2026-04-13T08:01:00.000Z',
          error_text: ''
        });
        expect(store.getOrderResults('90011087')).toEqual([
          {
            account_id: '90011087',
            command_id: stored.command_id,
            result: 'OK',
            ticket: 1001,
            error_text: '',
            created_at: '2026-04-13T08:01:00.000Z'
          }
        ]);
        expect(store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'acked' })).toEqual([
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
          store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'ERROR',
            0,
            'late failure',
            '2026-04-13T08:02:00.000Z'
          )
        ).toBe(false);
        expect(
          store.reconcileCommandResult(
            '90022000',
            stored.command_id,
            'OK',
            1002,
            '',
            '2026-04-13T08:03:00.000Z'
          )
        ).toBe(false);
        expect(
          store.reconcileCommandResult(
            '90011087',
            'sig_missing',
            'ERROR',
            0,
            'missing',
            '2026-04-13T08:04:00.000Z'
          )
        ).toBe(false);
        expect(store.getOrderResults('90011087')).toHaveLength(1);
        expect(store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'failed' })).toEqual([]);
      } finally {
        store.close?.();
        cleanup();
      }
    });

    it(`records failed delivered order results with error text in ${testCase.name} storage`, () => {
      const { store, cleanup } = testCase.create();
      try {
        const stored = store.saveCommandCandidate('90011087', {
          command_id: 'sig_order_fail',
          source: 'position_review',
          symbol: 'XAUUSD',
          action: 'MODIFY',
          ticket: 2002,
          decision_id: 'tpv1_order_fail'
        });
        store.promoteCommand(stored.command_id);
        expect(store.pollCommands('90011087')).toHaveLength(1);

        expect(
          store.reconcileCommandResult(
            '90011087',
            stored.command_id,
            'REJECTED',
            0,
            'invalid stops',
            '2026-04-13T09:01:00.000Z'
          )
        ).toBe(true);
        expect(store.getCommand(stored.command_id)).toMatchObject({
          status: 'failed',
          result: 'REJECTED',
          ticket: 0,
          failed_at: '2026-04-13T09:01:00.000Z',
          error_text: 'invalid stops'
        });
        expect(store.getOrderResults('90011087')).toEqual([
          {
            account_id: '90011087',
            command_id: stored.command_id,
            result: 'REJECTED',
            ticket: 0,
            error_text: 'invalid stops',
            created_at: '2026-04-13T09:01:00.000Z'
          }
        ]);
        expect(store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'failed' })).toEqual([
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
        store.close?.();
        cleanup();
      }
    });
  }

  it('stores and reloads the latest shadow runtime snapshot by account, symbol, and source', () => {
    const store = createInMemoryEaStore();

    store.saveShadowSnapshot({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY' },
      command: { action: 'SIGNAL', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });

    expect(store.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ea_analysis')).toEqual({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY' },
      command: { action: 'SIGNAL', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });
  });

  it('filters and summarizes shadow comparisons for qualification checks', () => {
    const store = createInMemoryEaStore();

    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:00:00.000Z'
    });
    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: false,
      signal_drift: true,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:10:00.000Z'
    });
    store.recordShadowComparison({
      account_id: '90022098',
      symbol: 'GBPJPY',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: false,
      source: 'ai_result',
      created_at: '2026-07-03T00:20:00.000Z'
    });

    expect(store.listShadowComparisons({ account_id: '90011087', signal_drift: true })).toEqual([
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
    expect(store.summarizeShadowComparisons({ account_id: '90011087', source: 'ea_analysis' })).toEqual({
      comparisons: 2,
      protocol_errors: 1,
      signal_drifts: 1,
      command_drifts: 0,
      oracle_compared: 2,
      first_created_at: '2026-07-03T00:00:00.000Z',
      last_created_at: '2026-07-03T00:10:00.000Z'
    });
  });

  it('stores decision events newest-first with account, symbol, status, and limit filters', () => {
    const store = createInMemoryEaStore();

    store.recordDecisionEvent({
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
    store.recordDecisionEvent({
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
    store.recordDecisionEvent({
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
    store.recordDecisionEvent({
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

    expect(store.listDecisionEvents({ account_id: '90011087' }).map((event) => event.decision_id)).toEqual([
      'tpv1_other_symbol',
      'tpv1_rejected',
      'tpv1_old'
    ]);
    expect(
      store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'rejected', limit: 1 })
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

  it('lists account symbols and explicitly stored pending signals', () => {
    const store = createInMemoryEaStore();
    const pendingSignal = {
      id: 1,
      account_id: '90011087',
      symbol: 'XAUUSD',
      strategy: 'pullback',
      side: 'buy',
      score: 9,
      status: 'pending'
    };

    store.saveRegistration({
      account_id: '90011087',
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'US100Cash',
      bid: 18000,
      ask: 18002
    });
    store.savePendingSignal(pendingSignal);

    expect(store.listAccountIds()).toEqual(['90011087']);
    expect(store.listSymbols('90011087')).toEqual(['XAUUSD', 'GBPJPY', 'US100Cash']);
    expect(store.listAISymbols('90011087')).toEqual(['XAUUSD', 'GBPJPY']);
    expect(store.getPendingSignals('90011087', 'XAUUSD')).toEqual([pendingSignal]);
    expect(store.getPendingSignals('90011087', 'GBPJPY')).toEqual([]);
  });

  it('updates and expires pending signal arbitration state', () => {
    const store = createInMemoryEaStore();
    store.savePendingSignal({
      id: 1,
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
    store.savePendingSignal({
      id: 2,
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

    expect(store.updatePendingSignalArbitration(1, 'approved', 'manual ok')).toBe(true);
    expect(store.getPendingSignals('90011087', 'XAUUSD').map((signal) => signal.id)).toEqual([2]);
    expect(store.expirePendingSignals('2026-04-13T08:03:00.000Z')).toBe(1);
    expect(store.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);
    expect(store.updatePendingSignalArbitration(999, 'approved', 'missing')).toBe(false);
  });

  it('stores and deletes API token records', () => {
    const store = createInMemoryEaStore();

    store.saveApiToken({
      token: 'user-token',
      name: 'Desk',
      accounts: ['90011087', '90022000'],
      is_admin: false,
      created_at: '2026-04-13T08:00:00.000Z'
    });

    expect(store.listApiTokens()).toEqual([
      {
        token: 'user-token',
        name: 'Desk',
        accounts: ['90011087', '90022000'],
        is_admin: false,
        created_at: '2026-04-13T08:00:00.000Z'
      }
    ]);
    expect(store.deleteApiToken('user-token')).toBe(true);
    expect(store.listApiTokens()).toEqual([]);
  });

  it('persists EA lifecycle snapshots and queued commands in SQLite', () => {
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
      store.saveRegistration({ account_id: '90011087', broker: 'Demo Broker', ai_symbols: ['XAUUSD', 'GBPJPY'] });
      store.saveHeartbeat({ account_id: '90011087', equity: 1100.25, ai_symbols: ['XAUUSD', 'GBPJPY'] });
      store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 3335.55, ask: 3335.75 });
      store.saveBars({
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: [{ time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 }]
      });
      store.savePositions({ account_id: '90011087', positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY' }] });
      store.savePendingSignal({ id: 1, account_id: '90011087', symbol: 'XAUUSD', strategy: 'pullback', side: 'buy' });
      store.saveAIResult('90011087', 'XAUUSD', { confidence: 82 });
      store.saveShadowSnapshot({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        signal: { strategy: 'pullback', side: 'BUY' },
        command: { action: 'SIGNAL', tp1: 3358 },
        created_at: '2026-07-03T00:00:00.000Z'
      });
      store.recordShadowComparison({
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: false,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:00:00.000Z'
      });
      store.recordShadowComparison({
        account_id: '90011087',
        symbol: 'GBPJPY',
        protocol_ok: false,
        signal_drift: true,
        command_drift: false,
        oracle_compared: true,
        source: 'ai_result',
        created_at: '2026-07-03T00:05:00.000Z'
      });
      store.recordDecisionEvent({
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
      store.saveApiToken({
        token: 'user-token',
        name: 'Desk',
        accounts: ['90011087', '90022000'],
        is_admin: false,
        created_at: '2026-07-03T00:07:00.000Z'
      });
      store.enqueueCommand('90011087', command);
      store.setRuntimeMode('90011087', 'cutover');
      const candidate = store.saveCommandCandidate('90011087', {
        command_id: 'candidate_1',
        source: 'ai_result',
        symbol: 'XAUUSD',
        action: 'SIGNAL',
        strategy: 'pullback',
        mode: 'approve'
      });
      store.promoteCommand(candidate.command_id);
      expect(store.pollCommands('90011087')).toEqual(expect.arrayContaining([
        expect.objectContaining({ command_id: command.command_id }),
        expect.objectContaining({ command_id: candidate.command_id })
      ]));
      store.reconcileCommandResult('90011087', candidate.command_id, 'OK', 999001);
      store.close();

      const reopened = createSqliteEaStore(dbPath);
      expect(reopened.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
      expect(reopened.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
      expect(reopened.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.75 });
      expect(reopened.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
      expect(reopened.getPositions('90011087')).toHaveLength(1);
      expect(reopened.getPendingSignals('90011087', 'XAUUSD')).toHaveLength(1);
      expect(reopened.updatePendingSignalArbitration(1, 'rejected', 'manual reject')).toBe(true);
      expect(reopened.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);
      expect(reopened.getAIResults('90011087')).toHaveLength(1);
      expect(reopened.listSymbols('90011087')).toEqual(['XAUUSD', 'GBPJPY']);
      expect(reopened.getRuntimeMode('90011087')).toBe('cutover');
      expect(reopened.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ea_analysis')).toEqual({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        signal: { strategy: 'pullback', side: 'BUY' },
        command: { action: 'SIGNAL', tp1: 3358 },
        created_at: '2026-07-03T00:00:00.000Z'
      });
      expect(reopened.listShadowComparisons({ source: 'ai_result' })).toEqual([
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
      expect(reopened.summarizeShadowComparisons({ account_id: '90011087' })).toEqual({
        comparisons: 2,
        protocol_errors: 1,
        signal_drifts: 1,
        command_drifts: 0,
        oracle_compared: 2,
        first_created_at: '2026-07-03T00:00:00.000Z',
        last_created_at: '2026-07-03T00:05:00.000Z'
      });
      expect(reopened.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'rejected' })).toEqual([
        {
          id: 1,
          decision_id: 'tpv1_persisted',
          account_id: '90011087',
          symbol: 'XAUUSD',
          stage: 'risk_gate',
          status: 'rejected',
          reason_codes: ['risk.spread.wide'],
          summary: { max_lots: 0 },
          related_command_id: 'sig_persisted',
          created_at: '2026-07-03T00:06:00.000Z'
        }
      ]);
      expect(reopened.listApiTokens()).toEqual([
        {
          token: 'user-token',
          name: 'Desk',
          accounts: ['90011087', '90022000'],
          is_admin: false,
          created_at: '2026-07-03T00:07:00.000Z'
        }
      ]);
      expect(reopened.getCommand('candidate_1')).toMatchObject({
        status: 'acked',
        result: 'OK',
        ticket: 999001
      });
      expect(reopened.pollCommands('90011087')).toEqual([]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
