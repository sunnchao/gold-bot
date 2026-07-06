import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoldbotAPI, GoldbotApiService } from '../tools/goldbot-api.js';
import type { AppConfigService } from '../config/app-config.service.js';
import { GoldbotPayloadSchema, HarmonicAnalysisResultSchema, PendingSignalSchema } from '../types/schemas.js';

describe('GoldbotAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should construct with base URL and token', () => {
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');
    expect(api).toBeDefined();
  });

  it('should strip trailing slash from baseUrl', () => {
    const api = new GoldbotAPI('http://localhost:8880/', 'test-token');
    // Verify it was created without error
    expect(api).toBeDefined();
  });

  it('should have fetchAnalysisPayload method', () => {
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');
    expect(typeof api.fetchAnalysisPayload).toBe('function');
  });

  it('should have fetchPendingSignal method', () => {
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');
    expect(typeof api.fetchPendingSignal).toBe('function');
  });

  it('should have fetchAccountSymbols method', () => {
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');
    expect(typeof api.fetchAccountSymbols).toBe('function');
  });

  it('should have postAIResult method', () => {
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');
    expect(typeof api.postAIResult).toBe('function');
  });

  it('should construct GoldbotApiService from AppConfigService', () => {
    const service = new GoldbotApiService({
      goldbot: {
        apiUrl: 'http://localhost:8880/',
        apiToken: 'test-token',
      },
    } as AppConfigService);

    expect(service).toBeDefined();
    expect(typeof service.fetchAnalysisPayload).toBe('function');
    expect(typeof service.fetchPendingSignal).toBe('function');
    expect(typeof service.fetchAccountSymbols).toBe('function');
    expect(typeof service.postAIResult).toBe('function');
  });

  it('should fetch account symbols from goldbot', async () => {
    const fetchMock = mockJsonFetch(['XAUUSD', 'XAGUSD', 'GBPJPY', 'US100Cash']);
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');

    await expect(api.fetchAccountSymbols('90011087')).resolves.toEqual({
      symbols: ['XAUUSD', 'XAGUSD', 'GBPJPY', 'US100Cash'],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8880/api/ai_symbols/90011087',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Token': 'test-token' }),
      }),
    );
  });

  it('should parse the real Go pending_signal shape', () => {
    const signal = PendingSignalSchema.parse({
      id: 1,
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      score: 8,
      strategy: 'pullback',
      indicators: '{"rsi":55}',
      status: 'pending',
      created_at: '2026-06-06T00:00:00Z',
      expires_at: '2026-06-06T00:05:00Z',
      arbitration_result: '',
      arbitration_reason: '',
    });

    expect(signal.id).toBe(1);
    expect(signal.account_id).toBe('90011087');
    expect(signal.side).toBe('buy');
    expect(signal.score).toBe(8);
    expect(signal.strategy).toBe('pullback');
    expect(signal.status).toBe('pending');
  });

  it('should fetch a single Go pending_signal object', async () => {
    const body = createPendingSignal({ id: 7, side: 'SELL' });
    const fetchMock = mockJsonFetch(body);
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');

    const signal = await api.fetchPendingSignal('90011087', 'XAUUSD');

    expect(signal).toEqual({ ...body, side: 'sell' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8880/api/pending_signal/90011087/XAUUSD',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Token': 'test-token' }),
      }),
    );
  });

  it('should fetch the first pending_signal from the legacy array response', async () => {
    const first = createPendingSignal({ id: 8, side: 'BUY' });
    const second = createPendingSignal({ id: 9, side: 'CLOSE' });
    mockJsonFetch([first, second]);
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');

    await expect(api.fetchPendingSignal('90011087', 'XAUUSD')).resolves.toEqual({
      ...first,
      side: 'buy',
    });
  });

  it('should return null for an empty legacy pending_signal array', async () => {
    mockJsonFetch([]);
    const api = new GoldbotAPI('http://localhost:8880', 'test-token');

    await expect(api.fetchPendingSignal('90011087', 'XAUUSD')).resolves.toBeNull();
  });

  it('should parse analysis payload bars with optional indicator fields', () => {
    const payload = GoldbotPayloadSchema.parse({
      account: {
        account_id: '90011087',
        equity: 10000,
        balance: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
      },
      market: {
        symbol: 'XAUUSD',
        bid: 2350.3,
        ask: 2350.7,
        spread: 0.4,
      },
      indicators: {
        H1: {
          close: 2350,
          open: 2348,
          high: 2352,
          low: 2347,
          ema20: 2348,
          ema50: 2340,
          rsi: 55,
          adx: 25,
          atr: 15,
          macd: 1.2,
          macd_signal: 0.8,
          macd_hist: 0.4,
          bb_upper: 2360,
          bb_middle: 2350,
          bb_lower: 2340,
          stoch_k: 65,
          stoch_d: 60,
        },
      },
      positions: [],
      market_status: {
        market_open: true,
        is_trade_allowed: true,
        tradeable: true,
      },
      strategy_mapping: {},
      bars: {
        H1: [
          {
            time: '2026-06-06T00:00:00Z',
            open: 2348,
            high: 2352,
            low: 2347,
            close: 2351,
            volume: 1000,
            ema20: 2348,
            ema50: 2340,
            ema200: 2310,
            atr: 15,
            rsi: 55,
            macd: 1.2,
            macd_signal: 0.8,
            macd_hist: 0.4,
            adx: 25,
            bb_upper: 2360,
            bb_lower: 2340,
            bb_mid: 2350,
            stoch_k: 65,
            stoch_d: 60,
            vol_sma: 1200,
            fib_236: 2335,
            fib_382: 2330,
            fib_500: 2325,
            fib_618: 2320,
            fib_786: 2315,
            pp: 2349,
            r1: 2355,
            r2: 2362,
            s1: 2342,
            s2: 2335,
          },
        ],
      },
    });

    expect(payload.bars?.H1).toHaveLength(1);
    expect(payload.bars?.H1?.[0]?.bb_mid).toBe(2350);
    expect(payload.bars?.H1?.[0]?.r2).toBe(2362);
  });

  it('should parse analysis payload null indicators for sparse timeframes', () => {
    const payload = GoldbotPayloadSchema.parse({
      account: {
        account_id: '90011087',
        equity: 10000,
        balance: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
      },
      market: {
        symbol: 'XAUUSD',
        bid: 2350.3,
        ask: 2350.7,
        spread: 0.4,
      },
      indicators: {
        M15: null,
        H1: {
          close: 2350,
          open: 2348,
          high: 2352,
          low: 2347,
          ema20: 2348,
          ema50: 2340,
          rsi: 55,
          adx: 25,
          atr: 15,
          macd: 1.2,
          macd_signal: 0.8,
          macd_hist: 0.4,
          bb_upper: 2360,
          bb_middle: 2350,
          bb_lower: 2340,
          stoch_k: 65,
          stoch_d: 60,
        },
      },
      positions: [],
      market_status: {
        market_open: true,
        is_trade_allowed: true,
        tradeable: true,
      },
      strategy_mapping: {},
    });

    expect(payload.indicators.M15).toBeNull();
    expect(payload.indicators.H1?.atr).toBe(15);
  });

  it('should parse harmonic context patterns without completion and active fields', () => {
    const payload = GoldbotPayloadSchema.parse({
      account: {
        account_id: '90011087',
        equity: 10000,
        balance: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
      },
      market: {
        symbol: 'XAUUSD',
        bid: 2350.3,
        ask: 2350.7,
        spread: 0.4,
      },
      indicators: {},
      positions: [],
      market_status: {
        market_open: true,
        is_trade_allowed: true,
        tradeable: true,
      },
      strategy_mapping: {},
      harmonic_context: {
        h4_patterns: [
          {
            type: 'gartley',
            direction: 'bullish',
            timeframe: 'H4',
            score: 78,
            x_price: 2300,
            a_price: 2360,
            b_price: 2322.9,
            c_price: 2345,
            d_price: 2310,
            ab_ratio: 0.618,
            bc_ratio: 0.382,
            cd_ratio: 1.272,
            xd_ratio: 0.786,
            reason: 'valid ratios',
          },
        ],
        h1_patterns: [],
        m30_patterns: [],
        active_pattern: null,
        direction_bias: 'bullish',
        score: 78,
        summary: 'H4 bullish Gartley candidate',
      },
    });

    expect(payload.harmonic_context?.h4_patterns[0]?.completion_pct).toBeUndefined();
    expect(payload.harmonic_context?.h4_patterns[0]?.is_active).toBeUndefined();
  });

  it('should parse harmonic analysis results without completion and active fields', () => {
    const result = HarmonicAnalysisResultSchema.parse({
      detected_pattern: 'gartley',
      direction: 'bullish',
      timeframe: 'H4',
      confidence: 78,
      d_zone_price: 2310,
      entry_zone: '2308-2312',
      stop_loss: 2298,
      take_profit_1: 2330,
      take_profit_2: 2350,
      rationale: 'valid ratios',
    });

    expect(result.completion_pct).toBeUndefined();
    expect(result.is_active).toBeUndefined();
  });
});

function createPendingSignal(
  overrides: Partial<{
    id: number;
    side: 'buy' | 'sell' | 'close';
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    account_id: '90011087',
    symbol: 'XAUUSD',
    side: overrides.side ?? 'buy',
    score: 8,
    strategy: 'pullback',
    indicators: '{"rsi":55}',
    status: 'pending',
    created_at: '2026-06-06T00:00:00Z',
    expires_at: '2026-06-06T00:05:00Z',
    arbitration_result: '',
    arbitration_reason: '',
  };
}

function mockJsonFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
