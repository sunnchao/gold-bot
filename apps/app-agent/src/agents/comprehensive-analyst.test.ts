import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComprehensiveAnalystService } from './comprehensive-analyst.js';
import { LLMClient, type LlmClientService } from '../tools/llm-client.js';
import type { AppConfigService } from '../config/app-config.service.js';
import type { GoldbotPayload } from '../types/goldbot.js';
import type { MarketInsight } from '../types/comprehensive.js';
import { TRADE_ACTION_TOOLS_LEGACY } from '../types/trade-action.js';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  getLogger: () => loggerMock,
}));

const markdownResponse = `## TECHNICAL
- Bias: neutral
- Confidence: 50
- Phase: consolidation
- Indicators Summary: 震荡整理 (Consolidation)
- Support Levels:
  - 2300 | support | strong | H1 | 3
- Resistance Levels:
  - 2400 | resistance | strong | H1 | 3
- Recommendation: none
- Rationale: 观望 (Hold)

## WAVE
- Confirmation: partial
- Extension Wave: 3
- Corrective Type: zigzag
- Trend Strength: moderate
- Target Level 1.618: 2380
- Target Level 2.0: 2420
- Confidence: 50
- Rationale: 部分确认 (Partial)

## CHANLUN
- Trend: range
- Strength: moderate
- Latest Signal: hold
- Hub State: active
- Confidence: 50
- Rationale: 中枢震荡 (Range)

## HARMONIC
- Detected Pattern: none
- Direction: neutral
- Timeframe: N/A
- Completion: 0
- Confidence: 0
- D Zone Price: 0
- Entry Zone: N/A
- Stop Loss: 0
- Take Profit 1: 0
- Take Profit 2: 0
- Rationale: 无形态 (None)

## RISK
- Risk Level: medium
- Max Position Size: 0.1
- Suggested SL: 2290
- Suggested TP: 2410
- Warnings: 无 (None)
- Add On: false

## ARBITRATION
- Final Direction: hold
- Confidence: 50
- Action: hold
- Primary Contradiction:
- Phase: consolidation
- United Front Analysis: 观望 (Hold)
- Reasoning: 市场整理。波浪和缠论未形成一致突破。风险收益不明确。
- Dow Primary Trend: neutral
- Dow Primary Phase: accumulation
- Dow Secondary Trend: neutral
- Dow Short Term Trend: neutral
- Dow Multi TF Confirm: false
- Dow Rationale: neutral
- Wave Current Wave: 3
- Wave Direction: unclear
- Wave Count: partial
- Wave Next Target: 2380
- Wave Confidence: 50
- Wave Rationale: partial
- Chanlun Trend: range
- Chanlun Bi Direction: none
- Chanlun Duan Direction: none
- Chanlun Zhongshu State: active
- Chanlun Buy Sell Point: none
- Chanlun Confidence: 50
- Chanlun Rationale: range
- Harmonic Pattern: none
- Harmonic Direction: neutral
- Harmonic Confidence: 0
- Harmonic Rationale: none
- Trade Direction: hold
- Trade Entry Price: 0
- Trade Stop Loss: 0
- Trade Take Profit 1: 0
- Trade Take Profit 2: 0
- Trade Risk Reward Ratio: 0
- Trade Position Size Lots: 0.01
- Trade Rationale: hold`;

const buySetupMarkdownResponse = markdownResponse
  .replace('- Bias: neutral', '- Bias: bullish')
  .replace('- Confidence: 50', '- Confidence: 75')
  .replace('- Risk Level: medium', '- Risk Level: low')
  .replace('- Max Position Size: 0.1', '- Max Position Size: 0.05')
  .replace('- Suggested SL: 2290', '- Suggested SL: 4125')
  .replace('- Suggested TP: 2410', '- Suggested TP: 4188')
  .replace('- Final Direction: hold', '- Final Direction: buy')
  .replace('- Action: hold', '- Action: open')
  .replace('- Reasoning: 市场整理。波浪和缠论未形成一致突破。风险收益不明确。', '- Reasoning: 多头趋势仍在，等待回调提供更好盈亏比。')
  .replace('- Trade Direction: hold', '- Trade Direction: buy')
  .replace('- Trade Entry Price: 0', '- Trade Entry Price: 4145')
  .replace('- Trade Stop Loss: 0', '- Trade Stop Loss: 4125')
  .replace('- Trade Take Profit 1: 0', '- Trade Take Profit 1: 4188')
  .replace('- Trade Take Profit 2: 0', '- Trade Take Profit 2: 4205')
  .replace('- Trade Risk Reward Ratio: 0', '- Trade Risk Reward Ratio: 2.15')
  .replace('- Trade Position Size Lots: 0.01', '- Trade Position Size Lots: 0.05')
  .replace('- Trade Rationale: hold', '- Trade Rationale: 等待回调至 4145 入场 (wait for pullback to 4145)');

const cacheStats = {
  readTokens: 0,
  creationTokens: 0,
  hitTokens: 0,
  missTokens: 0,
};

const appConfig = {
  llm: {
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test-key',
    model: 'deepseek-v4-pro',
    fallbackModel: 'deepseek-v4-pro',
    timeout: 120000,
    maxRetries: 3,
    enablePromptCaching: false,
  },
  llmTradeModel: 'deepseek-v4-flash-0731',
} as AppConfigService;

function createService(client: LlmClientService): ComprehensiveAnalystService {
  return new ComprehensiveAnalystService(client, appConfig);
}

function indicator(close: number) {
  return {
    close,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    ema20: close - 1,
    ema50: close - 2,
    ema200: close - 3,
    rsi: 50,
    adx: 20,
    atr: 5,
    macd: 1,
    macd_signal: 0.5,
    macd_hist: 0.5,
    bb_upper: close + 10,
    bb_middle: close,
    bb_lower: close - 10,
    stoch_k: 50,
    stoch_d: 50,
  };
}

function payloadWithLastBarClose(lastClose: number): GoldbotPayload {
  return {
    account: {
      account_id: 'acc-001',
      equity: 10000,
      balance: 10000,
      margin: 100,
      free_margin: 9900,
      currency: 'USD',
      leverage: 100,
    },
    market: {
      symbol: 'XAUUSD',
      bid: lastClose,
      ask: lastClose + 0.2,
      spread: 0.2,
    },
    indicators: {
      M15: indicator(lastClose),
      M30: indicator(lastClose),
      H1: indicator(lastClose),
      H4: indicator(lastClose),
    },
    positions: [],
    market_status: {
      market_open: true,
      is_trade_allowed: true,
      tradeable: true,
    },
    strategy_mapping: {
      trend: '10001',
    },
    bars: {
      H1: [
        { time: '2026-06-30T00:00:00Z', open: 2300, high: 2310, low: 2290, close: 2305 },
        { time: '2026-06-30T01:00:00Z', open: 2305, high: 2320, low: 2300, close: 2315 },
        { time: '2026-06-30T02:00:00Z', open: 2315, high: 2330, low: 2310, close: 2325 },
        { time: '2026-06-30T03:00:00Z', open: 2325, high: 2340, low: 2320, close: lastClose },
      ],
    },
    harmonic_context: {
      h4_patterns: [],
      h1_patterns: [],
      m30_patterns: [],
      active_pattern: null,
      direction_bias: 'neutral',
      score: 0,
      summary: 'none',
    },
  };
}

function payloadWithOnlyOneClosedBar(lastClose: number): GoldbotPayload {
  const payload = payloadWithLastBarClose(lastClose);
  return {
    ...payload,
    bars: {
      H1: [
        { time: '2026-06-30T00:00:00Z', open: 2300, high: 2310, low: 2290, close: 2305 },
        { time: '2026-06-30T01:00:00Z', open: 2305, high: 2320, low: 2300, close: lastClose },
      ],
    },
  };
}

describe('ComprehensiveAnalystService prompt caching integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends four prompt layers and keeps computed context stable when only the unclosed bar changes', async () => {
    const streamLayered = vi.fn().mockResolvedValue({
      content: markdownResponse,
      cacheStats: {
        readTokens: 0,
        creationTokens: 0,
        hitTokens: 0,
        missTokens: 0,
      },
    });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    await service.run(payloadWithLastBarClose(2335), 'XAUUSD');
    await service.run(payloadWithLastBarClose(2348), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(2);

    const [firstSystemBlocks, firstUserLayers] = streamLayered.mock.calls[0];
    const [secondSystemBlocks, secondUserLayers] = streamLayered.mock.calls[1];

    expect(firstSystemBlocks).toHaveLength(2);
    expect(firstSystemBlocks[0]).toMatchObject({ cacheable: true });
    expect(firstSystemBlocks[1]).toMatchObject({ cacheable: true });
    expect(firstSystemBlocks[0].text).not.toContain('XAUUSD');
    expect(firstSystemBlocks[1].text).toContain('XAUUSD');
    expect(firstUserLayers).toHaveLength(2);
    expect(firstUserLayers[0]).toMatchObject({ cacheable: true });
    expect(firstUserLayers[1]).toMatchObject({ cacheable: false });
    expect(firstUserLayers[0].text).toBe(secondUserLayers[0].text);
    expect(firstUserLayers[1].text).not.toBe(secondUserLayers[1].text);
    expect(secondSystemBlocks[0].text).toBe(firstSystemBlocks[0].text);
  });

  it('does not use the unclosed bar in computed context when closed bars are insufficient', async () => {
    const streamLayered = vi.fn().mockResolvedValue({
      content: markdownResponse,
      cacheStats: {
        readTokens: 0,
        creationTokens: 0,
        hitTokens: 0,
        missTokens: 0,
      },
    });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    await service.run(payloadWithOnlyOneClosedBar(2335), 'XAUUSD');

    const [, userLayers] = streamLayered.mock.calls[0];
    expect(userLayers[0].text).not.toContain('2335');
  });

  it('populates tradeAction from tool_use second-phase call', async () => {
    const streamLayered = vi.fn().mockResolvedValueOnce({
      content: buySetupMarkdownResponse,
      cacheStats,
    });
    const tradeStreamLayered = vi.spyOn(LLMClient.prototype, 'streamLayered').mockResolvedValueOnce({
      content: '',
      cacheStats,
      toolUse: {
        id: 't1',
        name: 'place_pending_order',
        input: {
          account_id: 'acc-001',
          symbol: 'XAUUSD',
          side: 'buy',
          entry_price: 4145,
          stop_loss: 4125,
          take_profit_1: 4188,
          take_profit_2: 4205,
          lots: 0.05,
          order_type: 'limit',
          reason: '等待回调至 4145 入场 (wait for pullback to 4145)',
        },
      },
    });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const result = await service.run(payloadWithLastBarClose(4174), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(1);
    expect(tradeStreamLayered).toHaveBeenCalledTimes(1);
    expect((tradeStreamLayered.mock.contexts[0] as LLMClient).getModel()).toBe('deepseek-v4-flash-0731');
    expect(tradeStreamLayered.mock.calls[0][2]).toMatchObject({
      tools: TRADE_ACTION_TOOLS_LEGACY,
      toolChoice: { type: 'any' },
    });
    expect(tradeStreamLayered.mock.calls[0][0][0].text).toContain(
      'Lots must be between 0.01 and 0.5 (typically 0.01-0.05 for XAUUSD intraday)',
    );
    expect(result.tradeAction).toEqual({
      type: 'place_pending_order',
      side: 'buy',
      entry_price: 4145,
      stop_loss: 4125,
      take_profit_1: 4188,
      take_profit_2: 4205,
      lots: 0.05,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '等待回调至 4145 入场 (wait for pullback to 4145)',
    });
  });

  it('falls back to undefined when tool_use call fails', async () => {
    const streamLayered = vi.fn().mockResolvedValueOnce({
      content: buySetupMarkdownResponse,
      cacheStats,
    });
    const tradeStreamLayered = vi
      .spyOn(LLMClient.prototype, 'streamLayered')
      .mockRejectedValueOnce(new Error('timeout'));
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const result = await service.run(payloadWithLastBarClose(4174), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(1);
    expect(tradeStreamLayered).toHaveBeenCalledTimes(1);
    expect(result.tradeAction).toBeUndefined();
  });

  it('returns do_nothing when account price deviation exceeds ATR tolerance', async () => {
    const client = {
      streamLayered: vi.fn(),
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);
    const marketInsight = {
      technical: {
        bias: 'bullish',
        confidence: 80,
        phase: 'trending',
        indicators_summary: 'trend',
        support_levels: [],
        resistance_levels: [],
        recommendation: 'none',
        rationale: 'trend',
      },
      wave: {
        wave_confirmation: 'partial',
        extension_wave: null,
        corrective_type: null,
        trend_strength: 'moderate',
        target_levels: { level_1_618: 4188, level_2_0: 4205 },
        confidence: 70,
        rationale: 'wave',
      },
      chanlun: {
        trend: 'up',
        strength: 'moderate',
        latest_signal: 'buy',
        hub_state: 'active',
        confidence: 70,
        rationale: 'chanlun',
      },
      harmonic: {
        detected_pattern: 'none',
        direction: 'neutral',
        timeframe: 'N/A',
        completion_pct: 0,
        confidence: 0,
        d_zone_price: 0,
        entry_zone: 'N/A',
        stop_loss: 0,
        take_profit_1: 0,
        take_profit_2: 0,
        rationale: 'none',
      },
      risk: {
        riskLevel: 'low',
        maxPositionSize: 0.1,
        suggestedSL: 4168,
        suggestedTP: 4188,
        warnings: [],
        addOn: false,
      },
      arbitration: {
        final_direction: 'buy',
        confidence: 80,
        primary_contradiction: 'none',
        phase: 'trend',
        reasoning: 'buy',
        action: 'open',
        united_front_analysis: 'aligned',
      },
      sr_levels: { support: [], resistance: [] },
      trend_bias: 'bullish',
      confidence: 80,
      trade_intent: {
        direction: 'buy',
        entry_trigger: 'market',
        entry_offset_atr: 0,
        stop_loss_atr: 1.5,
        take_profit_1_atr: 3,
        rationale: 'buy',
      },
    } satisfies MarketInsight;

    const actions = await service.decideAccountActions(
      marketInsight,
      [{
        accountId: '81124211',
        symbol: 'GOLDm#',
        payload: payloadWithLastBarClose(4176),
        aiSymbols: ['GOLDm#'],
        realtimePrice: 4176,
        atr: 4,
      }],
      4174,
      4,
      0.25,
    );

    expect(actions['GOLDm#']).toEqual({
      type: 'do_nothing',
      account_id: '81124211',
      reasoning: 'price.deviation_too_large',
    });
  });

  it('returns do_nothing when account ATR is unavailable', async () => {
    const client = {
      streamLayered: vi.fn(),
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const actions = await service.decideAccountActions(
      {} as MarketInsight,
      [{
        accountId: '81124211',
        symbol: 'GOLDm#',
        payload: payloadWithLastBarClose(4174),
        aiSymbols: ['GOLDm#'],
        realtimePrice: 4174,
        atr: 0,
      }],
      4174,
      0,
      0.25,
    );

    expect(actions['GOLDm#']).toEqual({
      type: 'do_nothing',
      account_id: '81124211',
      reasoning: 'price.atr_unavailable',
    });
    expect(client.streamLayered).not.toHaveBeenCalled();
  });

  it('does not include current price in the second-phase cacheable system block', async () => {
    const streamLayered = vi.fn().mockResolvedValueOnce({
      content: buySetupMarkdownResponse,
      cacheStats,
    });
    const tradeStreamLayered = vi.spyOn(LLMClient.prototype, 'streamLayered').mockResolvedValueOnce({
      content: '',
      cacheStats,
      toolUse: {
        id: 't1',
        name: 'do_nothing',
        input: { reason: 'test' },
      },
    });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'anthropic_explicit' as const, ttl: '1h' as const }),
      getModel: () => 'claude-sonnet-4-20250514',
    } as unknown as LlmClientService;
    const service = createService(client);

    await service.run(payloadWithLastBarClose(4174), 'XAUUSD');

    const secondCallSystemBlocks = tradeStreamLayered.mock.calls[0][0];
    expect(secondCallSystemBlocks).toHaveLength(2);
    expect(secondCallSystemBlocks[0]).toMatchObject({ cacheable: true });
    expect(secondCallSystemBlocks[1]).toMatchObject({ cacheable: true });
    // Neither cacheable system block should contain the current price
    expect(secondCallSystemBlocks[1].text).not.toContain('4174');
    expect(secondCallSystemBlocks[1].text).not.toContain('Current price');
  });

  function payloadWithHarmonicContext(score: number, completionPct: number): GoldbotPayload {
    const base = payloadWithLastBarClose(2335);
    return {
      ...base,
      harmonic_context: {
        h4_patterns: [],
        h1_patterns: [],
        m30_patterns: [],
        active_pattern: {
          type: 'bat',
          direction: 'bullish',
          timeframe: 'H1',
          score: score,
          completion_pct: completionPct,
          x_price: 2300,
          a_price: 2320,
          b_price: 2310,
          c_price: 2330,
          d_price: 2315,
          ab_ratio: 0.5,
          bc_ratio: 0.618,
          cd_ratio: 1.272,
          xd_ratio: 0.886,
          reason: 'Bullish bat pattern near D zone',
          prz_low: 2313,
          prz_high: 2317,
          stop_loss: 2308,
          target_1: 2325,
          target_2: 2335,
          confidence: 78,
          invalidated: false,
          status: 'completed',
        },
        direction_bias: 'bullish',
        score: score,
        summary: `Bullish bat detected, score=${score}`,
      },
    };
  }

  it('keeps harmonic volatile fields (score, completion_pct) out of semi-static layer', async () => {
    const streamLayered = vi.fn().mockResolvedValue({
      content: markdownResponse,
      cacheStats,
    });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    // Same closed bars, different harmonic score/completion_pct
    await service.run(payloadWithHarmonicContext(75, 90), 'XAUUSD');
    await service.run(payloadWithHarmonicContext(82, 95), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(2);
    const [, firstUserLayers] = streamLayered.mock.calls[0];
    const [, secondUserLayers] = streamLayered.mock.calls[1];

    // Semi-static layer (index 0) should be identical despite score/completion change
    expect(firstUserLayers[0].text).toBe(secondUserLayers[0].text);

    // Semi-static layer should not contain the volatile score value
    expect(firstUserLayers[0].text).not.toContain('"score":75');
    expect(firstUserLayers[0].text).not.toContain('"completion_pct":90');
    expect(firstUserLayers[0].text).not.toContain('"reason"');

    // Semi-static layer should contain stable fields
    expect(firstUserLayers[0].text).toContain('"type":"bat"');
    expect(firstUserLayers[0].text).toContain('"direction":"bullish"');
    expect(firstUserLayers[0].text).toContain('"x_price":2300');
    expect(firstUserLayers[0].text).toContain('"prz_low":2313');
    expect(firstUserLayers[0].text).toContain('"stop_loss":2308');
    expect(firstUserLayers[0].text).toContain('"target_1":2325');

    // Realtime layer should contain the volatile values
    expect(firstUserLayers[1].text).toContain('75');
    expect(secondUserLayers[1].text).toContain('82');
  });

  const structuredAnalysisInput = {
    technical: {
      bias: 'neutral',
      confidence: 45,
      phase: 'consolidation',
      indicators_summary: '震荡整理 (Consolidation)',
      support_levels: [],
      resistance_levels: [],
      recommendation: 'none',
      rationale: '观望 (Hold)',
    },
    wave: {
      wave_confirmation: 'partial',
      extension_wave: null,
      corrective_type: 'zigzag',
      trend_strength: 'moderate',
      target_levels: { level_1_618: 2380, level_2_0: 2420 },
      confidence: 45,
      rationale: '部分确认 (Partial)',
    },
    chanlun: {
      trend: 'range',
      strength: 'moderate',
      latest_signal: 'hold',
      hub_state: 'active',
      confidence: 45,
      rationale: '中枢震荡 (Range)',
    },
    risk: {
      riskLevel: 'medium',
      maxPositionSize: 0.1,
      suggestedSL: 2290,
      warnings: [],
      addOn: false,
    },
    arbitration: {
      final_direction: 'hold',
      confidence: 45,
      primary_contradiction: '',
      phase: 'consolidation',
      reasoning: '市场整理，观望。',
      action: 'hold',
      united_front_analysis: '观望 (Hold)',
    },
  };

  it('recovers via forced tool_use structured retry when both parse formats fail', async () => {
    const streamLayered = vi.fn()
      // First-phase analysis returns unparseable garbage (no markdown headers, no JSON)
      .mockResolvedValueOnce({ content: 'sorry, I cannot comply in the requested format', cacheStats })
      // Structured retry returns valid tool input
      .mockResolvedValueOnce({
        content: '',
        cacheStats,
        toolUse: { id: 't1', name: 'submit_comprehensive_analysis', input: structuredAnalysisInput },
      });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const result = await service.run(payloadWithLastBarClose(2335), 'XAUUSD');

    // Retry call is the second streamLayered invocation with forced tool choice
    expect(streamLayered).toHaveBeenCalledTimes(2);
    expect(streamLayered.mock.calls[1][2]).toMatchObject({
      toolChoice: { type: 'tool', name: 'submit_comprehensive_analysis' },
    });
    // Recovered result, not the confidence-0 fallback
    expect(result.technical.confidence).toBe(45);
    expect(result.arbitration.confidence).toBe(45);
    expect(result.arbitration.reasoning).toContain('市场整理');
  });

  it('falls back to neutral result when the structured retry also fails', async () => {
    const streamLayered = vi.fn()
      .mockResolvedValueOnce({ content: 'sorry, I cannot comply in the requested format', cacheStats })
      // Retry returns tool input that violates the schema
      .mockResolvedValueOnce({
        content: '',
        cacheStats,
        toolUse: { id: 't1', name: 'submit_comprehensive_analysis', input: { technical: { bias: 'sideways' } } },
      });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const result = await service.run(payloadWithLastBarClose(2335), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(2);
    expect(result.technical.confidence).toBe(0);
    expect(result.arbitration.final_direction).toBe('hold');
  });

  it('preserves explicit neutral theory sections and a hold recommendation when output and retry are unavailable', async () => {
    const streamLayered = vi.fn()
      .mockResolvedValueOnce({ content: '## TECHNICAL\n- Bias: neutral', cacheStats })
      .mockResolvedValueOnce({ content: '', cacheStats });
    const client = {
      streamLayered,
      invokeLayered: vi.fn(),
      getCacheStrategy: () => ({ type: 'auto_prefix' as const }),
      getModel: () => 'deepseek-v4-pro',
    } as unknown as LlmClientService;
    const service = createService(client);

    const result = await service.run(payloadWithLastBarClose(2335), 'XAUUSD');

    expect(streamLayered).toHaveBeenCalledTimes(2);
    expect(result.arbitration.dow_theory).toMatchObject({
      primary_trend: 'neutral',
      secondary_trend: 'neutral',
      short_term_trend: 'neutral',
      multi_tf_confirm: false,
    });
    expect(result.arbitration.wave_theory).toMatchObject({
      wave_direction: 'unclear',
      confidence: 0,
    });
    expect(result.arbitration.chanlun_theory).toMatchObject({
      trend: 'range',
      bi_direction: 'none',
      duan_direction: 'none',
      confidence: 0,
    });
    expect(result.arbitration.harmonic_theory).toMatchObject({
      pattern: 'none',
      direction: 'neutral',
      confidence: 0,
    });
    expect(result.arbitration.trade_recommendation).toMatchObject({
      direction: 'hold',
      rationale: expect.stringContaining('观望'),
    });
  });
});
