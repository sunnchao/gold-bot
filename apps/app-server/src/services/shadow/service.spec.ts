import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { ShadowService } from './service.js';

describe('ShadowService', () => {
  it('returns placeholder metrics when no shadow comparisons exist', () => {
    const service = new ShadowService(createInMemoryEaStore(), () => '2026-07-03T00:00:00.000Z');

    expect(service.metrics()).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:00:00.000Z',
      report: {
        ready: false,
        protocol_error_rate: 0,
        signal_drift_rate: 0,
        command_drift_rate: 0,
        last_shadow_event_at: '',
        missing_capabilities: ['shadow_traffic']
      },
      totals: {
        comparisons: 0,
        protocol_errors: 0,
        signal_drifts: 0,
        command_drifts: 0
      }
    });
  });

  it('aggregates persisted shadow comparison metrics', () => {
    const store = createInMemoryEaStore();
    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ai_result',
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
      created_at: '2026-07-03T00:05:00.000Z'
    });

    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');

    expect(service.metrics()).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:10:00.000Z',
      report: {
        ready: false,
        protocol_error_rate: 0.5,
        signal_drift_rate: 0.5,
        command_drift_rate: 0.5,
        last_shadow_event_at: '2026-07-03T00:05:00.000Z',
        missing_capabilities: []
      },
      totals: {
        comparisons: 2,
        protocol_errors: 1,
        signal_drifts: 1,
        command_drifts: 1
      }
    });
  });

  it('records oracle-backed comparison rows and computes drift flags', () => {
    const store = createInMemoryEaStore();
    const service = new ShadowService(store, () => '2026-07-03T00:10:00.000Z');

    const comparison = service.recordOracleComparison({
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
    expect(store.listShadowComparisons()).toEqual([comparison]);
  });
});
