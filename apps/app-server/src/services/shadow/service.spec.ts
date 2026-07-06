import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { ShadowService } from './service.js';

describe('ShadowService', () => {
  it('returns placeholder metrics when no shadow comparisons exist', async () => {
    const service = new ShadowService(createInMemoryEaStore(), () => '2026-07-03T00:00:00.000Z');

    expect(await service.metrics()).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:00:00.000Z',
      report: {
        ready: false,
        protocol_error_rate: 0,
        signal_drift_rate: 0,
        command_drift_rate: 0,
        last_shadow_event_at: '',
        missing_capabilities: ['shadow_traffic'],
        checks: [
          {
            label: 'Oracle Replay',
            value: 'pending',
            detail: 'No Go oracle comparisons have been recorded yet',
            tone: 'orange'
          },
          {
            label: 'Shadow Drift',
            value: 'pending',
            detail: 'Waiting for mirrored production traffic',
            tone: 'orange'
          },
          {
            label: 'Protocol Errors',
            value: '0.00%',
            detail: 'Live shadow traffic has not started yet',
            tone: 'amber'
          }
        ]
      },
      totals: {
        comparisons: 0,
        protocol_errors: 0,
        signal_drifts: 0,
        command_drifts: 0
      }
    });
  });

  it('aggregates persisted shadow comparison metrics', async () => {
    const store = createInMemoryEaStore();
    await store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ai_result',
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
      created_at: '2026-07-03T00:05:00.000Z'
    });

    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');

    expect(await service.metrics()).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:10:00.000Z',
      report: {
        ready: false,
        protocol_error_rate: 0.5,
        signal_drift_rate: 0.5,
        command_drift_rate: 0.5,
        last_shadow_event_at: '2026-07-03T00:05:00.000Z',
        missing_capabilities: [],
        checks: [
          {
            label: 'Oracle Replay',
            value: 'validated',
            detail: 'Go oracle comparisons are flowing into the shadow stream',
            tone: 'green'
          },
          {
            label: 'Shadow Drift',
            value: 'review required',
            detail: 'Signal 50.00%, command 50.00% (limit 2.00%)',
            tone: 'red'
          },
          {
            label: 'Protocol Errors',
            value: '50.00%',
            detail: 'Legacy contract mismatches detected in mirrored traffic',
            tone: 'red'
          }
        ]
      },
      totals: {
        comparisons: 2,
        protocol_errors: 1,
        signal_drifts: 1,
        command_drifts: 1
      }
    });
  });

  it('records oracle-backed comparison rows and computes drift flags', async () => {
    const store = createInMemoryEaStore();
    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');

    const comparison = await service.recordOracleComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      node: {
        signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
        command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3345 }
      },
      oracle: {
        signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
        command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3350 }
      }
    });

    expect(comparison).toEqual({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:10:00.000Z'
    });
    expect(await store.listShadowComparisons()).toEqual([comparison]);
  });

  it('records runtime snapshots and can compare against oracle payloads later', async () => {
    const store = createInMemoryEaStore();
    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');

    await service.recordRuntimeSnapshot({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
      command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3345 }
    });

    const comparison = await service.recordOracleComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      oracle: {
        signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
        command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3350 }
      }
    });

    expect(comparison).toEqual({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:10:00.000Z'
    });
  });

  it('builds a cutover-style qualification payload from the current metrics', async () => {
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

    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');
    const qualification = await service.qualification();

    expect(qualification.status).toBe('OK');
    expect(qualification.report.ready).toBe(true);
    expect(qualification.summary).toHaveLength(3);
    expect(qualification.summary[0]).toMatchObject({
      label: 'Oracle Replay',
      value: 'validated'
    });
    expect(qualification.totals).toEqual({
      comparisons: 1,
      protocol_errors: 0,
      signal_drifts: 0,
      command_drifts: 0
    });
  });
});
