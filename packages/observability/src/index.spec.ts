import { describe, expect, it } from 'vitest';
import { buildShadowReport, formatSseFrame, healthPayload } from './index.js';

describe('observability scaffold', () => {
  it('returns a stable health payload shape', () => {
    expect(healthPayload('ok')).toEqual({ status: 'ok' });
  });

  it('formats SSE frames with JSON payloads', () => {
    expect(formatSseFrame({ status: 'OK' })).toBe('data: {"status":"OK"}\n\n');
  });

  it('builds a placeholder report when no shadow comparisons exist', () => {
    expect(buildShadowReport([])).toEqual({
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: '',
      missing_capabilities: ['shadow_traffic']
    });
  });

  it('builds a drift report from shadow comparisons', () => {
    expect(
      buildShadowReport([
        {
          account_id: '90011087',
          symbol: 'XAUUSD',
          protocol_ok: true,
          signal_drift: false,
          command_drift: true,
          created_at: '2026-07-02T12:00:00.000Z'
        }
      ])
    ).toEqual({
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 1,
      last_shadow_event_at: '2026-07-02T12:00:00.000Z',
      missing_capabilities: []
    });
  });
});
