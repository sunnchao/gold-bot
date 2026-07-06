import { describe, expect, it, vi } from 'vitest';
import {
  captureReplayFixture,
  computeReplayMetrics,
  replayFixture,
  type ReplayCandidateResult,
} from './replay-runner.js';
import type { TradePlan } from '../types/agent.js';
import type { GoldbotPayload, PendingSignal } from '../types/goldbot.js';

function basePayload(): GoldbotPayload {
  return {
    account: {
      account_id: '90011087',
      balance: 10000,
      equity: 10100,
      margin: 100,
      free_margin: 10000,
      currency: 'USD',
      leverage: 500,
    },
    market: {
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
    },
    indicators: {},
    positions: [],
    market_status: {
      market_open: true,
      is_trade_allowed: true,
      tradeable: true,
    },
    strategy_mapping: {},
  };
}

function basePendingSignal(): PendingSignal {
  return {
    id: 42,
    account_id: '90011087',
    symbol: 'XAUUSD',
    side: 'buy',
    score: 78,
    strategy: 'breakout',
    indicators: 'RSI=58',
    status: 'pending',
    created_at: '2026-06-06T09:00:00.000Z',
    expires_at: '2026-06-06T09:15:00.000Z',
    arbitration_result: 'buy',
    arbitration_reason: 'momentum aligned',
  };
}

function tradePlan(overrides: Partial<TradePlan> = {}): TradePlan {
  return {
    schema_version: 'trade_plan.v1',
    decision_id: 'tpv1_fixture',
    account_id: '90011087',
    symbol: 'XAUUSD',
    mode: 'approve',
    side: 'buy',
    confidence: 82,
    entry_zone: { min: 3335.5, max: 3335.7 },
    stop_loss: 3328,
    take_profit: [3350],
    max_lots: 0.2,
    expires_at: '2026-06-06T09:15:00.000Z',
    reason_codes: ['mode.approve', 'side.buy'],
    conflicts: [],
    narrative: 'multi-timeframe bullish alignment',
    ...overrides,
  };
}

describe('captureReplayFixture', () => {
  it('stores replay inputs, raw responses, parsed outputs, final plan, and redacts secrets', () => {
    const payload = {
      ...basePayload(),
      diagnostics: {
        api_key: 'sk-live-secret-value',
        authorization: 'Bearer abc.def.ghi',
      },
    } as GoldbotPayload & {
      diagnostics: { api_key: string; authorization: string };
    };

    const fixture = captureReplayFixture({
      fixtureId: 'xauusd-20260606-0900',
      capturedAt: '2026-06-06T09:00:00.000Z',
      accountId: '90011087',
      symbol: 'XAUUSD',
      analysisPayload: payload,
      pendingSignal: basePendingSignal(),
      llmResponses: [
        {
          agent: 'technical',
          rawResponse: '{"bias":"bullish","note":"api_key=sk-another-secret"}',
          parsedOutput: { bias: 'bullish' },
        },
        {
          agent: 'risk',
          rawResponse: 'not json',
          parseError: 'no JSON found',
        },
      ],
      parsedOutputs: {
        technical: { bias: 'bullish' },
        risk: null,
      },
      finalTradePlan: tradePlan(),
    });

    expect(fixture).toEqual(
      expect.objectContaining({
        schema_version: 'replay_fixture.v1',
        fixture_id: 'xauusd-20260606-0900',
        account_id: '90011087',
        symbol: 'XAUUSD',
        pending_signal: expect.objectContaining({ side: 'buy' }),
        final_trade_plan: expect.objectContaining({ side: 'buy', max_lots: 0.2 }),
      }),
    );
    expect(fixture.llm_responses).toHaveLength(2);
    expect(fixture.parsed_outputs).toEqual({
      technical: { bias: 'bullish' },
      risk: null,
    });

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toContain('sk-live-secret-value');
    expect(serialized).not.toContain('sk-another-secret');
    expect(serialized).not.toContain('Bearer abc.def.ghi');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('replayFixture', () => {
  it('uses stored fixture data by default and does not invoke a live LLM runner', async () => {
    const fixture = captureReplayFixture({
      fixtureId: 'offline-fixture',
      capturedAt: '2026-06-06T09:00:00.000Z',
      accountId: '90011087',
      symbol: 'XAUUSD',
      analysisPayload: basePayload(),
      pendingSignal: basePendingSignal(),
      llmResponses: [
        {
          agent: 'mao',
          rawResponse: '{"final_direction":"buy"}',
          parsedOutput: { final_direction: 'buy' },
        },
      ],
      parsedOutputs: {
        arbitration: { final_direction: 'buy' },
      },
      finalTradePlan: tradePlan(),
    });
    const liveRunner = vi.fn(async (): Promise<ReplayCandidateResult> => {
      throw new Error('live LLM should not be called');
    });

    const result = await replayFixture(fixture, { liveRunner });

    expect(liveRunner).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        fixture_id: 'offline-fixture',
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'fixture',
        trade_plan: expect.objectContaining({ side: 'buy', mode: 'approve' }),
        parse_failures: [],
      }),
    );
  });
});

describe('computeReplayMetrics', () => {
  it('computes parse failure, direction, mode, stop-loss, and max-lots drift rates', () => {
    const baseline: ReplayCandidateResult[] = [
      {
        fixture_id: 'a',
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'fixture',
        trade_plan: tradePlan({ decision_id: 'a', side: 'buy', mode: 'approve', stop_loss: 3328, max_lots: 0.2 }),
        parsed_outputs: {},
        parse_failures: [],
      },
      {
        fixture_id: 'b',
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'fixture',
        trade_plan: tradePlan({ decision_id: 'b', side: 'sell', mode: 'modify', stop_loss: 3348, max_lots: 0.1 }),
        parsed_outputs: {},
        parse_failures: [],
      },
    ];
    const candidate: ReplayCandidateResult[] = [
      {
        fixture_id: 'a',
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'candidate',
        trade_plan: tradePlan({ decision_id: 'a-new', side: 'sell', mode: 'approve', stop_loss: 3335, max_lots: 0.2 }),
        parsed_outputs: {},
        parse_failures: ['technical'],
      },
      {
        fixture_id: 'b',
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'candidate',
        trade_plan: tradePlan({ decision_id: 'b-new', side: 'sell', mode: 'close', stop_loss: 3348.5, max_lots: 0.15 }),
        parsed_outputs: {},
        parse_failures: [],
      },
    ];

    const metrics = computeReplayMetrics(baseline, candidate, {
      stopLossTolerance: 1,
      maxLotsTolerance: 0.01,
    });

    expect(metrics).toEqual(
      expect.objectContaining({
        total_fixtures: 2,
        compared_fixtures: 2,
        parse_failure_count: 1,
        parse_failure_rate: 0.5,
        direction_drift_count: 1,
        direction_drift_rate: 0.5,
        mode_drift_count: 1,
        mode_drift_rate: 0.5,
        stop_loss_drift_count: 1,
        stop_loss_drift_rate: 0.5,
        max_lots_drift_count: 1,
        max_lots_drift_rate: 0.5,
      }),
    );
    expect(metrics.stop_loss_average_abs_delta).toBe(3.75);
    expect(metrics.stop_loss_max_abs_delta).toBe(7);
    expect(metrics.max_lots_average_abs_delta).toBe(0.025);
    expect(metrics.max_lots_max_abs_delta).toBeCloseTo(0.05);
  });
});
