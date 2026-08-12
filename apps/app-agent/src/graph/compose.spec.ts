import { describe, expect, it } from 'vitest';
import { composeFinalSignal } from './compose.js';
import type { AnalysisGraphStateType } from './state.js';
import type { TradeAction } from '../types/trade-action.js';

describe('composeFinalSignal AI order intent', () => {
  it('adds explicit market intent for current-price trade actions', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_market_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      stop_loss: 3330,
      take_profit_1: 3345,
      lots: 0.01,
      reason: '可以当前价入场 (enter at current price)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      entry_zone: { min: 3335.5, max: 3335.7 },
      execution_type: 'market',
      requested_order_type: 'market',
      reason_codes: expect.arrayContaining(['fc.place_market_order', 'order.market'])
    });
  });

  it('maps buy limit trade actions to BUY_LIMIT intent', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      entry_price: 3332.5,
      stop_loss: 3328,
      take_profit_1: 3344,
      lots: 0.01,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '回调到价格做多 (buy the pullback)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      entry_zone: { min: 3332.5, max: 3332.5 },
      execution_type: 'limit',
      requested_order_type: 'BUY_LIMIT',
      reason_codes: expect.arrayContaining(['fc.place_pending_order', 'order.BUY_LIMIT'])
    });
  });

  it('end-to-end: buy limit at 4145 produces BUY_LIMIT trade plan', () => {
    const state = stateWithTradeAction({
      type: 'place_pending_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      entry_price: 4145,
      stop_loss: 4125,
      take_profit_1: 4188,
      take_profit_2: 4205,
      lots: 0.05,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '等待回调至 4145 (Fib 0.382) 入场',
    });
    state.arbitration = {
      ...state.arbitration!,
      final_direction: 'buy',
      action: 'open',
      confidence: 75,
    };
    state.payload = {
      ...state.payload!,
      market: {
        ...state.payload!.market,
        symbol: 'XAUUSD',
        bid: 4174,
        ask: 4174.5,
      },
    };

    const signal = composeFinalSignal(state);
    const plan = signal?.trade_plan;

    expect(plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      execution_type: 'limit',
      requested_order_type: 'BUY_LIMIT',
      entry_zone: { min: 4145, max: 4145 },
      stop_loss: 4125,
      take_profit: [4188, 4205],
      max_lots: 0.05,
    });
    expect(new Date(plan!.expires_at).getTime() - Date.now()).toBeGreaterThan(4 * 3600 * 1000 - 1000);
  });

  it('maps sell limit trade actions to SELL_LIMIT intent', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'sell',
      entry_price: 3338.5,
      stop_loss: 3344,
      take_profit_1: 3322,
      lots: 0.01,
      order_type: 'limit',
      expiry_hours: 4,
      reason: '反弹到价格做空 (sell the rebound)'
    }));

    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'sell',
      entry_zone: { min: 3338.5, max: 3338.5 },
      execution_type: 'limit',
      requested_order_type: 'SELL_LIMIT',
      reason_codes: expect.arrayContaining(['fc.place_pending_order', 'order.SELL_LIMIT'])
    });
  });

  it('does not publish executable approve plans for pending stop trade actions', () => {
    const signal = composeFinalSignal(stateWithTradeAction({
      type: 'place_pending_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      entry_price: 3342,
      stop_loss: 3335,
      take_profit_1: 3358,
      lots: 0.01,
      order_type: 'stop',
      expiry_hours: 4,
      reason: '突破追多 disabled by design'
    }));

    expect(signal?.trade_plan).toBeUndefined();
  });

  it.each([
    'price.deviation_too_large',
    'account.symbol_not_loaded',
  ])('vetoes market-first open insights when account action is %s', (reasoning) => {
    const state = stateWithTradeAction({
      type: 'do_nothing',
      account_id: '90011087',
      reasoning,
    });
    const signal = composeFinalSignal({
      ...state,
      marketInsights: {
        XAUUSD: state.comprehensiveAnalysis as any,
      },
      accountActions: {
        XAUUSD: state.tradeAction!,
      },
      arbitration: {
        ...state.arbitration!,
        final_direction: 'buy',
        action: 'open',
        confidence: 80,
      },
    } as AnalysisGraphStateType);

    expect(signal?.arbitration).toMatchObject({
      direction: 'hold',
      action: 'hold',
    });
    expect(signal?.trade_plan).toBeUndefined();
    expect(signal?.dual_trade_plan).toBeUndefined();
  });

  it('allows market-first trade plans only from account-aware opening actions', () => {
    const signal = composeFinalSignal({
      ...stateWithTradeAction({
        type: 'place_market_order',
        account_id: '90011087',
        symbol: 'XAUUSD',
        side: 'buy',
        stop_loss: 3330,
        take_profit_1: 3345,
        lots: 0.01,
        reason: 'account approved',
      }),
      marketInsights: {
        XAUUSD: {} as any,
      },
      accountActions: {
        XAUUSD: {
          type: 'place_market_order',
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          stop_loss: 3330,
          take_profit_1: 3345,
          lots: 0.01,
          reason: 'account approved',
        },
      },
    } as AnalysisGraphStateType);

    expect(signal?.arbitration).toMatchObject({
      direction: 'buy',
      action: 'open',
    });
    expect(signal?.trade_plan).toMatchObject({
      mode: 'approve',
      side: 'buy',
      execution_type: 'market',
      requested_order_type: 'market',
    });
  });

  it('adds explicit market intent to dual approve trade plans', () => {
    const baseState = stateWithTradeAction({
      type: 'do_nothing',
      reason: 'dual arbitration falls back to dual_trade_plan'
    });
    const signal = composeFinalSignal({
      ...baseState,
      arbitration: {
        ...baseState.arbitration,
        final_direction: 'dual',
        action: 'open'
      },
      technicalAnalysis: {
        bias: 'neutral',
        confidence: 80,
        phase: 'trending',
        indicators_summary: 'dual setup around current price',
        support_levels: [
          { price: 3325, type: 'support', strength: 'strong', timeframe: 'H1', touches: 3 }
        ],
        resistance_levels: [
          { price: 3345, type: 'resistance', strength: 'strong', timeframe: 'H1', touches: 3 }
        ],
        recommendation: 'hold',
        rationale: 'both directions possible after trigger'
      }
    } as AnalysisGraphStateType);

    expect(signal?.trade_plan).toBeUndefined();
    expect(signal?.dual_trade_plan?.buy).toMatchObject({
      mode: 'approve',
      side: 'buy',
      entry_zone: { min: 3335.5, max: 3335.7 },
      execution_type: 'market',
      requested_order_type: 'market',
      reason_codes: expect.arrayContaining(['mode.approve', 'side.buy', 'order.market'])
    });
    expect(signal?.dual_trade_plan?.sell).toMatchObject({
      mode: 'approve',
      side: 'sell',
      entry_zone: { min: 3335.5, max: 3335.7 },
      execution_type: 'market',
      requested_order_type: 'market',
      reason_codes: expect.arrayContaining(['mode.approve', 'side.sell', 'order.market'])
    });
  });
});

function stateWithTradeAction(tradeAction: TradeAction): AnalysisGraphStateType {
  const side = tradeAction.type === 'do_nothing' ? 'hold' : tradeAction.side;
  return {
    accountId: '90011087',
    symbol: 'XAUUSD',
    timestamp: '2026-04-13T08:00:00.000Z',
    payload: {
      account: {
        account_id: '90011087',
        equity: 10000,
        balance: 10000,
        margin: 100,
        free_margin: 9900,
        currency: 'USD',
        leverage: 500
      },
      market: {
        symbol: 'XAUUSD',
        bid: 3335.5,
        ask: 3335.7,
        spread: 0.2
      },
      indicators: {},
      positions: [],
      market_status: {
        market_open: true,
        is_trade_allowed: true,
        tradeable: true
      },
      strategy_mapping: {}
    },
    arbitration: {
      final_direction: side === 'buy' ? 'buy' : side === 'sell' ? 'sell' : 'hold',
      confidence: 80,
      primary_contradiction: 'none',
      phase: 'markup',
      action: side === 'buy' || side === 'sell' ? 'open' : 'hold',
      reasoning: 'AI generated structured order intent',
      united_front_analysis: 'aligned',
      dow_theory: {
        primary_trend: side === 'sell' ? 'bearish' : 'bullish',
        primary_phase: side === 'sell' ? 'distribution' : 'markup',
        secondary_trend: side === 'sell' ? 'bearish' : 'bullish',
        short_term_trend: side === 'sell' ? 'bearish' : 'bullish',
        multi_tf_confirm: true,
        rationale: 'trend aligned'
      },
      wave_theory: {
        current_wave: '3',
        wave_direction: side === 'sell' ? 'impulse_down' : 'impulse_up',
        wave_count: 'impulse',
        next_target: 'target',
        confidence: 80,
        rationale: 'wave aligned'
      },
      chanlun_theory: {
        trend: side === 'sell' ? 'down' : 'up',
        bi_direction: side === 'sell' ? 'down' : 'up',
        duan_direction: side === 'sell' ? 'down' : 'up',
        zhongshu_state: 'none',
        buy_sell_point: side === 'sell' ? 'sell_2' : 'buy_2',
        confidence: 80,
        rationale: 'chanlun aligned'
      },
      harmonic_theory: {
        pattern: 'none',
        direction: side === 'sell' ? 'bearish' : 'bullish',
        confidence: 0,
        rationale: 'no harmonic conflict'
      }
    },
    riskAssessment: {
      riskLevel: 'medium',
      maxPositionSize: 0.01,
      suggestedSL: 3330,
      suggestedTP: 3345,
      warnings: [],
      addOn: false
    },
    tradeAction,
    logs: [],
    errors: []
  } as unknown as AnalysisGraphStateType;
}
