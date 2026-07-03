import { describe, expect, it } from 'vitest';
import { buildShadowReport, createSseHub, formatSseFrame, healthPayload } from './index.js';

describe('observability scaffold', () => {
  it('returns a stable health payload shape', () => {
    expect(healthPayload('ok')).toEqual({ status: 'ok' });
  });

  it('formats SSE frames with JSON payloads', () => {
    expect(formatSseFrame({ status: 'OK' })).toBe('data: {"status":"OK"}\n\n');
  });

  it('publishes events to current SSE subscribers only', () => {
    const hub = createSseHub<{ event_type: string }>();
    const received: string[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event.event_type));

    hub.publish({ event_type: 'ai_result' });
    unsubscribe();
    hub.publish({ event_type: 'ai_analysis_failed' });

    expect(received).toEqual(['ai_result']);
    expect(hub.subscriberCount()).toBe(0);
  });

  it('builds a placeholder report when no shadow comparisons exist', () => {
    expect(buildShadowReport([])).toEqual({
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
          oracle_compared: true,
          source: 'ai_result',
          created_at: '2026-07-02T12:00:00.000Z'
        }
      ])
    ).toEqual({
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 1,
      last_shadow_event_at: '2026-07-02T12:00:00.000Z',
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
          detail: 'Signal 0.00%, command 100.00% (limit 2.00%)',
          tone: 'red'
        },
        {
          label: 'Protocol Errors',
          value: '0.00%',
          detail: 'No contract mismatches observed in mirrored traffic',
          tone: 'green'
        }
      ]
    });
  });

  it('keeps shadow metrics non-ready until oracle comparisons exist', () => {
    expect(
      buildShadowReport([
        {
          account_id: '90011087',
          symbol: 'XAUUSD',
          protocol_ok: true,
          signal_drift: false,
          command_drift: false,
          oracle_compared: false,
          source: 'ea_analysis',
          created_at: '2026-07-03T00:00:00.000Z'
        }
      ])
    ).toEqual({
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: '2026-07-03T00:00:00.000Z',
      missing_capabilities: ['go_oracle_reference'],
      checks: [
        {
          label: 'Oracle Replay',
          value: 'pending',
          detail: 'Go oracle comparisons have not been approved yet',
          tone: 'orange'
        },
        {
          label: 'Shadow Drift',
          value: 'within threshold',
          detail: 'Signal 0.00%, command 0.00%',
          tone: 'green'
        },
        {
          label: 'Protocol Errors',
          value: '0.00%',
          detail: 'No contract mismatches observed in mirrored traffic',
          tone: 'green'
        }
      ]
    });
  });

  it('marks cutover ready when compared traffic stays within thresholds', () => {
    expect(
      buildShadowReport([
        {
          account_id: '90011087',
          symbol: 'XAUUSD',
          protocol_ok: true,
          signal_drift: false,
          command_drift: false,
          oracle_compared: true,
          source: 'ai_result',
          created_at: '2026-07-03T01:00:00.000Z'
        },
        {
          account_id: '90011087',
          symbol: 'XAUUSD',
          protocol_ok: true,
          signal_drift: false,
          command_drift: false,
          oracle_compared: true,
          source: 'ai_result',
          created_at: '2026-07-03T01:05:00.000Z'
        }
      ])
    ).toEqual({
      ready: true,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: '2026-07-03T01:05:00.000Z',
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
          value: 'within threshold',
          detail: 'Signal 0.00%, command 0.00%',
          tone: 'green'
        },
        {
          label: 'Protocol Errors',
          value: '0.00%',
          detail: 'No contract mismatches observed in mirrored traffic',
          tone: 'green'
        }
      ]
    });
  });
});
