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
    expect(store.getCommand(stored.command_id)?.status).toBe('delivered');

    store.reconcileCommandResult('90011087', stored.command_id, 'filled', 1001);
    expect(store.getCommand(stored.command_id)).toMatchObject({
      status: 'acked',
      result: 'filled',
      ticket: 1001
    });
  });

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
      store.reconcileCommandResult('90011087', candidate.command_id, 'filled', 999001);
      store.close();

      const reopened = createSqliteEaStore(dbPath);
      expect(reopened.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
      expect(reopened.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
      expect(reopened.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.75 });
      expect(reopened.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
      expect(reopened.getPositions('90011087')).toHaveLength(1);
      expect(reopened.getPendingSignals('90011087', 'XAUUSD')).toHaveLength(1);
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
      expect(reopened.getCommand('candidate_1')).toMatchObject({
        status: 'acked',
        result: 'filled',
        ticket: 999001
      });
      expect(reopened.pollCommands('90011087')).toEqual([command]);
      expect(reopened.pollCommands('90011087')).toEqual([]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
