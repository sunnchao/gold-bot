import { describe, expect, it } from 'vitest';
import { routeAfterFetch } from './edges.js';
import type { AnalysisGraphStateType } from './state.js';

function createState(
  overrides: Partial<AnalysisGraphStateType>,
): AnalysisGraphStateType {
  return {
    accountId: 'acc-001',
    symbol: 'XAUUSD',
    symbols: ['XAUUSD'],
    timestamp: new Date().toISOString(),
    payload: undefined,
    payloads: undefined,
    pendingSignal: undefined,
    pendingSignals: undefined,
    technicalAnalysis: undefined,
    technicalAnalyses: undefined,
    waveAnalysis: undefined,
    waveAnalyses: undefined,
    chanlunAnalysis: undefined,
    chanlunAnalyses: undefined,
    riskAssessment: undefined,
    riskAssessments: undefined,
    arbitration: undefined,
    arbitrations: undefined,
    finalSignal: undefined,
    finalSignals: undefined,
    logs: [],
    errors: [],
    skipReason: undefined,
    duration: undefined,
    durations: undefined,
    ...overrides,
  };
}

describe('routeAfterFetch', () => {
  it('routes to analyze when fetched payloads are mixed open and closed', () => {
    const decision = routeAfterFetch(
      createState({
        symbol: 'XAUUSD',
        symbols: [],
        payloads: {
          XAUUSD: {
            market_status: { market_open: false },
          } as AnalysisGraphStateType['payload'],
          GBPJPY: {
            market_status: { market_open: true },
          } as AnalysisGraphStateType['payload'],
        },
      }),
    );

    expect(decision).toBe('analyze');
  });

  it('routes to skip only when all fetched payloads are closed', () => {
    const decision = routeAfterFetch(
      createState({
        symbols: ['XAUUSD', 'XAGUSD'],
        payloads: {
          XAUUSD: {
            market_status: { market_open: false },
          } as AnalysisGraphStateType['payload'],
          XAGUSD: {
            market_status: { market_open: false },
          } as AnalysisGraphStateType['payload'],
        },
      }),
    );

    expect(decision).toBe('skip');
  });
});
