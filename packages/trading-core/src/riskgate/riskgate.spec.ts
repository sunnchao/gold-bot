import { describe, expect, it } from 'vitest';
import { evaluateMarketFilters, evaluateRiskGate, type MarketFilterInput, type RiskGateInput } from './riskgate.js';

const now = '2026-06-06T09:00:00.000Z';

function validInput(): RiskGateInput {
  return {
    now,
    account: {
      accountId: '90011087',
      leverage: 500
    },
    runtime: {
      equity: 1100.25,
      freeMargin: 1000.25,
      marketOpen: true,
      isTradeAllowed: true,
      lastTickAt: '2026-06-06T08:59:50.000Z'
    },
    state: {
      tick: {
        symbol: 'XAUUSD',
        bid: 3335.55,
        ask: 3335.75,
        spread: 0.2
      },
      positions: []
    },
    plan: {
      decisionId: 'tpv1_gate_test',
      accountId: '90011087',
      symbol: 'XAUUSD',
      mode: 'approve',
      side: 'buy',
      entryZone: { min: 3335.55, max: 3335.75 },
      stopLoss: 3328,
      takeProfit: [3350],
      maxLots: 0.2,
      expiresAt: '2026-06-06T09:15:00.000Z'
    },
    sourceStrategy: 'pullback',
    allowAdd: false,
    allowHedge: false
  };
}

describe('riskgate parity slice', () => {
  it('accepts absent plan with Go parity reason code', () => {
    const input = validInput();
    input.plan = undefined as any;

    expect(() => evaluateRiskGate(input)).not.toThrow();
    const result = evaluateRiskGate(input);

    expect(result.status).toBe('accepted');
    expect(result.auditOnly).toBe(false);
    expect(result.reasonCodes).toContain('plan.absent');
  });

  it.each(['approve', 'modify'])('allows %s past the audit-only guard', (mode) => {
    const input = validInput();
    input.plan.mode = mode;
    input.plan.maxLots = 0.02;

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('accepted');
    expect(result.auditOnly).toBe(false);
    expect(result.reasonCodes).toContain('lots.accepted');
  });

  it.each(['observe', 'veto'])('keeps %s audit-only', (mode) => {
    const input = validInput();
    input.plan.mode = mode;

    const result = evaluateRiskGate(input);

    expect(result.auditOnly).toBe(true);
  });

  it.each([
    ['closed market', (input: RiskGateInput) => (input.runtime.marketOpen = false), 'market.closed'],
    ['trade disabled', (input: RiskGateInput) => (input.runtime.isTradeAllowed = false), 'market.trade_not_allowed'],
    ['stale tick', (input: RiskGateInput) => (input.runtime.lastTickAt = '2026-06-06T08:57:00.000Z'), 'tick.stale'],
    ['wide spread', (input: RiskGateInput) => (input.state.tick.spread = 80.1), 'spread.too_wide'],
    ['expired plan', (input: RiskGateInput) => (input.plan.expiresAt = '2026-06-06T08:59:59.000Z'), 'plan.expired']
  ])('rejects %s with Go reason code', (_name, mutate, wantCode) => {
    const input = validInput();
    mutate(input);

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('rejected');
    expect(result.reasonCodes).toContain(wantCode);
  });

  it.each([
    ['missing', 0, 'sl.missing'],
    ['too close', 3335.5, 'sl.too_close'],
    ['too far', 3150, 'sl.too_far']
  ])('rejects %s stop loss with Go reason code', (_name, stopLoss, wantCode) => {
    const input = validInput();
    input.plan.stopLoss = stopLoss;

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('rejected');
    expect(result.reasonCodes).toContain(wantCode);
  });

  it.each([
    ['same side add', 'BUY', 'pullback', 'pullback', 'position.add_not_allowed'],
    ['opposite side hedge', 'SELL', 'pullback', 'pullback', 'position.hedge_not_allowed'],
    ['missing position strategy keeps backward compatibility', 'BUY', '', 'ai_signal', 'position.add_not_allowed']
  ])('rejects %s conflicts', (_name, type, positionStrategy, sourceStrategy, wantCode) => {
    const input = validInput();
    input.sourceStrategy = sourceStrategy;
    input.state.positions = [{ ticket: 123456, symbol: 'XAUUSD', type, lots: 0.1, strategy: positionStrategy }];

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('rejected');
    expect(result.reasonCodes).toContain(wantCode);
  });

  it('does not reject different strategy positions as conflicts', () => {
    const input = validInput();
    input.sourceStrategy = 'ai_signal';
    input.state.positions = [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, strategy: 'pullback' }];

    const result = evaluateRiskGate(input);

    expect(result.reasonCodes).not.toContain('position.add_not_allowed');
    expect(result.reasonCodes).not.toContain('position.hedge_not_allowed');
  });

  it('clamps oversized lots using Go-compatible risk and margin limits', () => {
    const input = validInput();
    input.plan.maxLots = 3.77;

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('clamped');
    expect(result.reasonCodes).toContain('lots.clamped');
    expect(result.allowedLots).toBeGreaterThan(0);
    expect(result.allowedLots).toBeLessThan(input.plan.maxLots);
  });

  it.each(['close', 'reduce'])('accepts %s as audit-safe executable mode', (mode) => {
    const input = validInput();
    input.plan.mode = mode;
    input.plan.side = 'none';
    input.plan.stopLoss = 0;

    const result = evaluateRiskGate(input);

    expect(result.status).toBe('accepted');
    expect(result.reasonCodes).toContain('action.audit_safe');
  });
});

function validMarketFilterInput(): MarketFilterInput {
  return {
    now: '2026-06-04T13:00:00.000Z',
    symbol: 'XAUUSD',
    runtime: {
      marketOpen: true,
      isTradeAllowed: true,
      lastTickAt: '2026-06-04T12:59:50.000Z'
    },
    state: {
      tick: {
        symbol: 'XAUUSD',
        bid: 3335.55,
        ask: 3335.75,
        spread: 0.2
      },
      bars: {
        H1: atrBars(1, 24, 1)
      }
    }
  };
}

function atrBars(baseAtr: number, historyCount: number, latestAtr: number) {
  return [
    ...Array.from({ length: historyCount }, (_, index) => ({
      atr: baseAtr,
      close: 3300 + index
    })),
    {
      atr: latestAtr,
      close: 3300 + historyCount
    }
  ];
}

describe('market filter parity slice', () => {
  it.each([
    ['closed market', (input: MarketFilterInput) => (input.runtime.marketOpen = false), 'blocking', 'market.closed'],
    ['trade disabled', (input: MarketFilterInput) => (input.runtime.isTradeAllowed = false), 'blocking', 'market.trade_not_allowed'],
    ['stale tick', (input: MarketFilterInput) => (input.runtime.lastTickAt = '2026-06-04T12:57:00.000Z'), 'blocking', 'tick.stale'],
    ['wide spread', (input: MarketFilterInput) => (input.state.tick.spread = 8.1), 'blocking', 'spread.too_wide'],
    [
      'friday close window',
      (input: MarketFilterInput) => {
        input.now = '2026-06-05T20:45:00.000Z';
        input.runtime.lastTickAt = '2026-06-05T20:44:50.000Z';
      },
      'blocking',
      'session.friday_close_window'
    ],
    [
      'rollover window',
      (input: MarketFilterInput) => {
        input.now = '2026-06-04T21:58:00.000Z';
        input.runtime.lastTickAt = '2026-06-04T21:57:50.000Z';
      },
      'warning',
      'session.rollover_window'
    ],
    [
      'low liquidity session',
      (input: MarketFilterInput) => {
        input.now = '2026-06-04T22:30:00.000Z';
        input.runtime.lastTickAt = '2026-06-04T22:29:50.000Z';
      },
      'warning',
      'session.low_liquidity'
    ],
    [
      'abnormal ATR expansion',
      (input: MarketFilterInput) => {
        input.state.bars = { M30: atrBars(1, 24, 2.2) };
      },
      'warning',
      'volatility.atr_expansion'
    ]
  ] as const)('mirrors Go %s filter', (_name, mutate, severity, code) => {
    const input = validMarketFilterInput();
    mutate(input);

    const result = evaluateMarketFilters(input);

    expect(result.reason_codes).toContain(code);
    if (severity === 'blocking') {
      expect(result.blocked).toBe(true);
      expect(result.blocking).toEqual(expect.arrayContaining([{ code, severity: 'blocking' }]));
    } else {
      expect(result.warnings).toEqual(expect.arrayContaining([{ code, severity: 'warning' }]));
    }
  });

  it('has no active filters for normal markets', () => {
    const result = evaluateMarketFilters(validMarketFilterInput());

    expect(result).toEqual({
      blocked: false,
      blocking: [],
      warnings: [],
      reason_codes: []
    });
  });
});
