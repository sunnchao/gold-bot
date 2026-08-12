import { describe, expect, it, vi } from 'vitest';
import { WorkflowNodesService } from './workflow-nodes.service.js';
import { MarketInsightCacheService } from './market-insight-cache.service.js';
import type { GoldbotPayload } from '../types/goldbot.js';
import type { MarketInsight } from '../types/comprehensive.js';
import type { AppConfigService } from '../config/app-config.service.js';

function payload(symbol: string, bid = 3335, ask = 3335.2): GoldbotPayload {
  return {
    account: {
      account_id: '81124211',
      equity: 10000,
      balance: 10000,
      margin: 0,
      free_margin: 10000,
      currency: 'USD',
      leverage: 500,
    },
    market: { symbol, bid, ask, spread: ask - bid },
    indicators: {},
    positions: [],
    market_status: { market_open: true, is_trade_allowed: true, tradeable: true },
    strategy_mapping: {},
    bars: {
      H1: [{ time: '1', open: bid - 1, high: bid + 2, low: bid - 2, close: bid, atr: 4 }],
    },
  };
}

const insight = {
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
    target_levels: { level_1_618: 3340, level_2_0: 3350 },
    confidence: 60,
    rationale: 'wave',
  },
  chanlun: {
    trend: 'up',
    strength: 'moderate',
    latest_signal: 'buy',
    hub_state: 'active',
    confidence: 60,
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
    suggestedSL: 3328,
    suggestedTP: 3345,
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

describe('WorkflowNodesService market-first mode', () => {
  it('uses the shared cache only for shared BAR views', async () => {
    const config = {
      marketFirstEnabled: true,
      marketInsightTtlMs: 600000,
      priceDeviationToleranceAtr: 0.25,
    } as AppConfigService;
    const cache = new MarketInsightCacheService(config);
    const fallbackInsight = {
      ...insight,
      confidence: 55,
      trend_bias: 'neutral',
      arbitration: {
        ...insight.arbitration,
        final_direction: 'hold',
        action: 'hold',
        reasoning: 'fallback account-local bars',
      },
    } satisfies MarketInsight;
    const analyst = {
      runMarketInsight: vi.fn(async (barView) => barView.useShared ? insight : fallbackInsight),
      decideAccountActions: vi.fn(async (_insight, views) => ({
        [views[0].symbol]: {
          type: 'do_nothing',
          account_id: views[0].accountId,
          reasoning: 'test',
        },
      })),
    };
    const service = new WorkflowNodesService(
      {} as any,
      analyst as any,
      {} as any,
      { instance: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any,
      config,
      undefined,
      cache,
    );

    const result = await service.comprehensiveAnalysis({
      accountId: '81124211',
      symbol: 'GOLDm#',
      symbols: ['GOLDm#', 'XAUUSD'],
      timestamp: '2026-08-12T00:00:00.000Z',
      payloads: {
        'GOLDm#': payload('GOLDm#'),
        XAUUSD: payload('XAUUSD'),
      },
      barViews: {
        'GOLDm#': {
          canonicalSymbol: 'XAUUSD',
          sourceAccount: '90011087',
          sourceSymbol: 'XAUUSD',
          useShared: true,
          payload: payload('XAUUSD'),
          benchmarkPrice: 3335.1,
          atr: 4,
        },
        XAUUSD: {
          canonicalSymbol: 'XAUUSD',
          sourceAccount: '90011087',
          sourceSymbol: 'XAUUSD',
          useShared: false,
          payload: payload('XAUUSD'),
          benchmarkPrice: 3335.1,
          atr: 4,
        },
      },
      accountViews: {
        'GOLDm#': {
          accountId: '81124211',
          symbol: 'GOLDm#',
          payload: payload('GOLDm#'),
          aiSymbols: ['GOLDm#', 'XAUUSD'],
          realtimePrice: 3335.1,
          atr: 4,
        },
        XAUUSD: {
          accountId: '81124211',
          symbol: 'XAUUSD',
          payload: payload('XAUUSD'),
          aiSymbols: ['GOLDm#', 'XAUUSD'],
          realtimePrice: 3335.1,
          atr: 4,
        },
      },
      logs: [],
      errors: [],
    } as any);

    expect(analyst.runMarketInsight).toHaveBeenCalledTimes(2);
    expect(analyst.decideAccountActions).toHaveBeenCalledTimes(2);
    expect(result.marketInsights).toEqual({
      'GOLDm#': insight,
      XAUUSD: fallbackInsight,
    });
    expect(cache.get('XAUUSD')?.insight).toBe(insight);
  });

  it('does not write fallback BAR insights into the shared market cache', async () => {
    const config = {
      marketFirstEnabled: true,
      marketInsightTtlMs: 600000,
      priceDeviationToleranceAtr: 0.25,
    } as AppConfigService;
    const cache = new MarketInsightCacheService(config);
    const fallbackInsight = {
      ...insight,
      confidence: 45,
      arbitration: {
        ...insight.arbitration,
        final_direction: 'hold',
        action: 'hold',
        reasoning: 'account fallback',
      },
    } satisfies MarketInsight;
    const analyst = {
      runMarketInsight: vi.fn(async () => fallbackInsight),
      decideAccountActions: vi.fn(async (_insight, views) => ({
        [views[0].symbol]: {
          type: 'do_nothing',
          account_id: views[0].accountId,
          reasoning: 'test',
        },
      })),
    };
    const service = new WorkflowNodesService(
      {} as any,
      analyst as any,
      {} as any,
      { instance: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any,
      config,
      undefined,
      cache,
    );

    await service.comprehensiveAnalysis({
      accountId: '81124211',
      symbol: 'GOLDm#',
      symbols: ['GOLDm#'],
      timestamp: '2026-08-12T00:00:00.000Z',
      payloads: {
        'GOLDm#': payload('GOLDm#'),
      },
      barViews: {
        'GOLDm#': {
          canonicalSymbol: 'XAUUSD',
          sourceAccount: '81124211',
          sourceSymbol: 'GOLDm#',
          useShared: false,
          payload: payload('GOLDm#'),
          benchmarkPrice: 3335.1,
          atr: 4,
        },
      },
      accountViews: {
        'GOLDm#': {
          accountId: '81124211',
          symbol: 'GOLDm#',
          payload: payload('GOLDm#'),
          aiSymbols: ['GOLDm#'],
          realtimePrice: 3335.1,
          atr: 4,
        },
      },
      logs: [],
      errors: [],
    } as any);

    expect(analyst.runMarketInsight).toHaveBeenCalledTimes(1);
    expect(cache.get('XAUUSD')).toBeUndefined();
  });
});
