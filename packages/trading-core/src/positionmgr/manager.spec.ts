import { describe, expect, it } from 'vitest';
import {
  evaluatePositionBreakeven,
  evaluatePositionDynamicTrailing,
  evaluatePositionKeyLevels,
  evaluatePositionManagerCommands,
  evaluatePositionMomentumScalpExits,
  evaluatePositionTP1,
  evaluatePositionTP2,
  evaluatePositionTrendReversal,
  evaluatePositionTimeStops,
  summarizePositions
} from '../index.js';

describe('position manager summary parity slice', () => {
  it('normalizes symbols and summarizes open buy/sell exposure without live commands', () => {
    const summary = summarizePositions({
      accountId: '90011087',
      symbol: 'GOLDm#',
      positions: [
        { ticket: 101, symbol: 'GOLDm#', type: 'BUY', lots: 0.2, openPrice: 3330, profit: 12.5, strategy: 'pullback' },
        { ticket: 102, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, openPrice: 3340, profit: -1.25, strategy: 'pullback' },
        { ticket: 103, symbol: 'XAUUSD', type: 'SELL', lots: 0.05, openPrice: 3350, profit: 2.75, strategy: 'ai_signal' },
        { ticket: 104, symbol: 'GBPJPY', type: 'BUY', lots: 0.4, openPrice: 190.12, profit: 4.5, strategy: 'range' },
        { ticket: 0, symbol: 'XAUUSD', type: 'BUY', lots: 1, openPrice: 3330, profit: 100 },
        { ticket: 105, symbol: 'XAUUSD', type: 'SELL', lots: 0, openPrice: 3350, profit: 100 }
      ]
    });

    expect(summary).toMatchObject({
      accountId: '90011087',
      symbol: 'XAUUSD',
      totalOpenPositions: 3,
      buyLots: 0.3,
      sellLots: 0.05,
      netLots: 0.25,
      netSide: 'BUY',
      floatingProfit: 14,
      canProduceLiveCommands: false
    });
    expect(summary.weightedAverageEntry).toBeCloseTo(3333.333333, 6);
    expect(summary.byStrategy).toEqual([
      { strategy: 'ai_signal', positions: 1, buyLots: 0, sellLots: 0.05, netLots: -0.05, floatingProfit: 2.75 },
      { strategy: 'pullback', positions: 2, buyLots: 0.3, sellLots: 0, netLots: 0.3, floatingProfit: 11.25 }
    ]);
  });

  it('reports flat exposure when buy and sell lots offset', () => {
    const summary = summarizePositions({
      symbol: 'GBPJPYm#',
      positions: [
        { ticket: 201, symbol: 'GBPJPY', type: 'BUY', lots: 0.1, openPrice: 190.1 },
        { ticket: 202, symbol: 'GBPJPY', type: 'SELL', lots: 0.1, openPrice: 190.3 }
      ]
    });

    expect(summary.netSide).toBe('FLAT');
    expect(summary.netLots).toBe(0);
  });
});

describe('position manager time-stop advisory parity slice', () => {
  const now = '2026-04-13T08:00:00.000Z';
  const h1Bars = [{}, {}, {}, {}, {}];

  it('returns no advisories for invalid snapshots', () => {
    const result = evaluatePositionTimeStops({
      now,
      currentPrice: 3340.8,
      currentAtr: 0,
      h1Bars,
      positions: [{ ticket: 101, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 101, openTime: '2026-04-11T07:00:00.000Z' }]
    });

    expect(result).toEqual({ advisories: [], canProduceLiveCommands: false });
  });

  it('mirrors the Go 48h full-close time stop', () => {
    const result = evaluatePositionTimeStops({
      now,
      currentPrice: 3340.8,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [{ ticket: 101, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 101, openTime: '2026-04-11T07:00:00.000Z' }]
    });

    expect(result).toEqual({
      advisories: [{ action: 'CLOSE', ticket: 101, lots: 0.5, reason: 'time_48h_0.4ATR' }],
      canProduceLiveCommands: false
    });
  });

  it('mirrors the Go 72h partial close and tiny-lot fallback', () => {
    const result = evaluatePositionTimeStops({
      now,
      currentPrice: 3342,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 201, type: 'BUY', lots: 0.5, openPrice: 3340 },
        { ticket: 202, type: 'BUY', lots: 0.05, openPrice: 3340 }
      ],
      states: [
        { ticket: 201, openTime: '2026-04-10T07:00:00.000Z' },
        { ticket: 202, openTime: '2026-04-10T07:00:00.000Z' }
      ]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 201, lots: 0.25, reason: 'time_72h_1.0ATR' },
      { action: 'CLOSE', ticket: 202, lots: 0.05, reason: 'time_72h_1.0ATR' }
    ]);
  });

  it('mirrors the Go 24h low-volatility time stop', () => {
    const result = evaluatePositionTimeStops({
      now,
      currentPrice: 3340.05,
      currentAtr: 1,
      avgAtr: 2,
      h1Bars,
      positions: [{ ticket: 301, type: 'BUY', lots: 0.4, openPrice: 3340 }],
      states: [{ ticket: 301, openTime: '2026-04-12T07:00:00.000Z' }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 301, lots: 0.4, reason: 'time_24h_0.1ATR_lowvol' }]);
  });

  it('does not emit a 72h advisory when TP2 has already hit', () => {
    const result = evaluatePositionTimeStops({
      now,
      currentPrice: 3342,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [{ ticket: 401, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 401, openTime: '2026-04-10T07:00:00.000Z', tp2Hit: true }]
    });

    expect(result.advisories).toEqual([]);
  });
});

describe('position manager breakeven advisory parity slice', () => {
  it('mirrors the Go breakeven MODIFY advisory and state update without live commands', () => {
    const result = evaluatePositionBreakeven({
      currentPrice: 3343.2,
      currentAtr: 2,
      positions: [{ ticket: 703, type: 'BUY', lots: 0.5, openPrice: 3340, sl: 0 }],
      states: [{ ticket: 703, beTriggerAtr: 1.5, bestSl: 0 }]
    });

    expect(result.advisories).toEqual([{ action: 'MODIFY', ticket: 703, newSL: 3340, reason: 'breakeven_1.6ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 703,
        beTriggerAtr: 1.5,
        beMoved: true,
        bestSl: 3340
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('allows BUY breakeven when tracked BestSL is polluted but current SL is still worse', () => {
    const result = evaluatePositionBreakeven({
      currentPrice: 3344,
      currentAtr: 2,
      positions: [{ ticket: 705, type: 'BUY', lots: 0.5, openPrice: 3340, sl: 3338 }],
      states: [{ ticket: 705, beTriggerAtr: 1.5, bestSl: 3342 }]
    });

    expect(result.advisories).toEqual([{ action: 'MODIFY', ticket: 705, newSL: 3340, reason: 'breakeven_2.0ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 705,
        beMoved: true,
        bestSl: 3340
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not move BUY stop loss backward when current position SL is already better', () => {
    const result = evaluatePositionBreakeven({
      currentPrice: 3344,
      currentAtr: 2,
      positions: [{ ticket: 701, type: 'BUY', lots: 0.5, openPrice: 3340, sl: 3342 }],
      states: [{ ticket: 701, beTriggerAtr: 1.5, bestSl: 3342 }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 701,
        beMoved: false,
        bestSl: 3342
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not move SELL stop loss backward when current position SL is already better', () => {
    const result = evaluatePositionBreakeven({
      currentPrice: 3336,
      currentAtr: 2,
      positions: [{ ticket: 702, type: 'SELL', lots: 0.5, openPrice: 3340, sl: 3338 }],
      states: [{ ticket: 702, beTriggerAtr: 1.5, bestSl: 3338 }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 702,
        beMoved: false,
        bestSl: 3338
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('treats a zero breakeven trigger as the Go default instead of moving immediately', () => {
    const result = evaluatePositionBreakeven({
      currentPrice: 3341,
      currentAtr: 2,
      positions: [{ ticket: 704, type: 'BUY', lots: 0.5, openPrice: 3340, sl: 0 }],
      states: [{ ticket: 704, beTriggerAtr: 0, bestSl: 0 }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 704,
        beTriggerAtr: 1.5,
        beMoved: false,
        bestSl: 0
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

describe('position manager TP1 advisory parity slice', () => {
  it('mirrors the Go TP1 CLOSE advisory and state update without live commands', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3343.2,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 803, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 803, beMoved: true, tp1Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 803, lots: 0.2, reason: 'TP1_1.6ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 803,
        beMoved: true,
        tp1Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not TP1 before breakeven has moved', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3345,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 804, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 804, beMoved: false, tp1Hit: false }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 804,
        beMoved: false,
        tp1Hit: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not TP1 twice for an already-hit state', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3345,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 805, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 805, beMoved: true, tp1Hit: true }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 805,
        beMoved: true,
        tp1Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go early BUY TP1 RSI reversal trigger', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3341.8,
      currentAtr: 2,
      h1Bars: [{}, {}, { rsi: 61 }, { rsi: 70 }, { rsi: 54 }],
      positions: [{ ticket: 806, type: 'BUY', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 806, beMoved: true, tp1Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 806, lots: 0.12, reason: 'TP1_0.9ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 806,
        beMoved: true,
        tp1Hit: true
      })
    ]);
  });

  it('mirrors the Go early SELL TP1 RSI reversal trigger', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3338.2,
      currentAtr: 2,
      h1Bars: [{}, {}, { rsi: 39 }, { rsi: 30 }, { rsi: 46 }],
      positions: [{ ticket: 807, type: 'SELL', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 807, beMoved: true, tp1Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 807, lots: 0.12, reason: 'TP1_0.9ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 807,
        beMoved: true,
        tp1Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go TP1 tiny-lot full-close fallback', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3345,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 808, type: 'BUY', lots: 0.01, openPrice: 3340 }],
      states: [{ ticket: 808, beMoved: true, tp1Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 808, lots: 0.01, reason: 'TP1_2.5ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 808,
        beMoved: true,
        tp1Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors Go same-side TP1 group coordination without live commands', () => {
    const result = evaluatePositionTP1({
      currentPrice: 3343,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [
        { ticket: 809, type: 'BUY', lots: 0.5, openPrice: 3340 },
        { ticket: 810, type: 'BUY', lots: 0.3, openPrice: 3342.4 }
      ],
      states: [
        { ticket: 809, beMoved: true, tp1Hit: false },
        { ticket: 810, beMoved: true, tp1Hit: false }
      ]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 809, lots: 0.2, reason: 'TP1_1.5ATR' },
      { action: 'CLOSE', ticket: 810, lots: 0.12, reason: 'group_tp1_BUY' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 809, beMoved: true, tp1Hit: true }),
      expect.objectContaining({ ticket: 810, beMoved: true, tp1Hit: true })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

describe('position manager TP2 advisory parity slice', () => {
  it('mirrors the Go TP2 CLOSE advisory and state update without live commands', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3346.4,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 903, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 903, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 903, lots: 0.2, reason: 'TP2_3.2ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 903,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not TP2 before TP1 has hit', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3348,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 904, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 904, tp1Hit: false, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 904,
        tp1Hit: false,
        tp2Hit: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not TP2 twice for an already-hit state', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3348,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 905, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 905, tp1Hit: true, tp2Hit: true }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 905,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go early BUY TP2 weakness trigger', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3344.4,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        {},
        { macdHist: 0.9, rsi: 64, adx: 34 },
        { macdHist: 0.4, rsi: 58, adx: 30 }
      ],
      positions: [{ ticket: 906, type: 'BUY', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 906, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 906, lots: 0.12, reason: 'TP2_2.2ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 906,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('accepts Go JSON macd_hist bars for early BUY TP2 weakness', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3344.4,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        {},
        { macd_hist: 0.9, rsi: 64, adx: 34 },
        { macd_hist: 0.4, rsi: 62, adx: 30 }
      ],
      positions: [{ ticket: 909, type: 'BUY', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 909, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 909, lots: 0.12, reason: 'TP2_2.2ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 909,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go early SELL TP2 weakness trigger', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3335.6,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        {},
        { macdHist: -0.9, rsi: 36, adx: 34 },
        { macdHist: -0.4, rsi: 42, adx: 30 }
      ],
      positions: [{ ticket: 907, type: 'SELL', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 907, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 907, lots: 0.12, reason: 'TP2_2.2ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 907,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go TP2 tiny-lot full-close fallback', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3348,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 908, type: 'BUY', lots: 0.01, openPrice: 3340 }],
      states: [{ ticket: 908, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 908, lots: 0.01, reason: 'TP2_4.0ATR' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 908,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors Go same-side TP2 group coordination without live commands', () => {
    const result = evaluatePositionTP2({
      currentPrice: 3346,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [
        { ticket: 909, type: 'BUY', lots: 0.5, openPrice: 3340 },
        { ticket: 910, type: 'BUY', lots: 0.3, openPrice: 3342.4 }
      ],
      states: [
        { ticket: 909, tp1Hit: true, tp2Hit: false },
        { ticket: 910, tp1Hit: true, tp2Hit: false }
      ]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 909, lots: 0.2, reason: 'TP2_3.0ATR' },
      { action: 'CLOSE', ticket: 910, lots: 0.12, reason: 'group_tp2_BUY' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 909, tp1Hit: true, tp2Hit: true }),
      expect.objectContaining({ ticket: 910, tp1Hit: true, tp2Hit: true })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

describe('position manager key-level advisory parity slice', () => {
  it('mirrors the Go first key-level partial close and TP1 state update without live commands', () => {
    const result = evaluatePositionKeyLevels({
      currentPrice: 3349.8,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 1003, type: 'BUY', lots: 0.5, openPrice: 3347 }],
      states: [{ ticket: 1003, tp1Hit: false, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1003, lots: 0.2, reason: 'key_level_3350' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1003,
        tp1Hit: true,
        tp2Hit: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go second key-level partial close and TP2 state update', () => {
    const result = evaluatePositionKeyLevels({
      currentPrice: 3349.8,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 1004, type: 'BUY', lots: 0.5, openPrice: 3345.6 }],
      states: [{ ticket: 1004, tp1Hit: true, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1004, lots: 0.2, reason: 'key_level2_3350' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1004,
        tp1Hit: true,
        tp2Hit: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not emit a key-level advisory when price is not near the level', () => {
    const result = evaluatePositionKeyLevels({
      currentPrice: 3349.5,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 1005, type: 'BUY', lots: 0.5, openPrice: 3347 }],
      states: [{ ticket: 1005, tp1Hit: false, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1005,
        tp1Hit: false,
        tp2Hit: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go SELL key-level selection below price', () => {
    const result = evaluatePositionKeyLevels({
      currentPrice: 3300.2,
      currentAtr: 2,
      h1Bars: [{}, {}, {}, {}, {}],
      positions: [{ ticket: 1006, type: 'SELL', lots: 0.3, openPrice: 3302.4 }],
      states: [{ ticket: 1006, tp1Hit: false, tp2Hit: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1006, lots: 0.12, reason: 'key_level_3300' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1006,
        tp1Hit: true,
        tp2Hit: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

describe('position manager trend-reversal advisory parity slice', () => {
  it('mirrors the Go BUY trend-reversal full close without live commands', () => {
    const result = evaluatePositionTrendReversal({
      currentPrice: 3338.8,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        { macdHist: -0.2, rsi: 44, adx: 24, ema20: 3339.6, ema50: 3340.2 },
        { macdHist: -0.62, rsi: 38, adx: 18, ema20: 3339.4, ema50: 3340.4 }
      ],
      positions: [{ ticket: 1103, type: 'BUY', lots: 0.5, openPrice: 3338 }],
      states: [{ ticket: 1103, beMoved: true }]
    });

    expect(result).toEqual({
      advisories: [
        {
          action: 'CLOSE',
          ticket: 1103,
          lots: 0.5,
          reason: 'reversal_s8_MACD=-0.62<-0.5且价格<EMA20 RSI=38<40 ADX=18<20 EMA死叉确认(2根)'
        }
      ],
      canProduceLiveCommands: false
    });
  });

  it('mirrors the Go SELL trend-reversal full close', () => {
    const result = evaluatePositionTrendReversal({
      currentPrice: 3341.2,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        { macdHist: 0.2, rsi: 56, adx: 23, ema20: 3340.6, ema50: 3339.8 },
        { macdHist: 0.67, rsi: 63, adx: 17, ema20: 3340.8, ema50: 3339.7 }
      ],
      positions: [{ ticket: 1104, type: 'SELL', lots: 0.3, openPrice: 3342 }],
      states: [{ ticket: 1104, beMoved: true }]
    });

    expect(result.advisories).toEqual([
      {
        action: 'CLOSE',
        ticket: 1104,
        lots: 0.3,
        reason: 'reversal_s8_MACD=0.67>0.5且价格>EMA20 RSI=63>60 ADX=17<20 EMA金叉确认(2根)'
      }
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not emit trend-reversal before breakeven has moved', () => {
    const result = evaluatePositionTrendReversal({
      currentPrice: 3338.8,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        { macdHist: 0.2, rsi: 44, adx: 24, ema20: 3339.6, ema50: 3340.2 },
        { macdHist: -0.62, rsi: 38, adx: 18, ema20: 3339.4, ema50: 3340.4 }
      ],
      positions: [{ ticket: 1105, type: 'BUY', lots: 0.5, openPrice: 3338 }],
      states: [{ ticket: 1105, beMoved: false }]
    });

    expect(result).toEqual({ advisories: [], canProduceLiveCommands: false });
  });

  it('does not emit trend-reversal below the Go score threshold', () => {
    const result = evaluatePositionTrendReversal({
      currentPrice: 3338.8,
      currentAtr: 2,
      h1Bars: [
        {},
        {},
        { macdHist: -0.2, rsi: 44, adx: 24, ema20: 3340.4, ema50: 3339.6 },
        { macdHist: -0.62, rsi: 45, adx: 24, ema20: 3339.4, ema50: 3339 }
      ],
      positions: [{ ticket: 1106, type: 'BUY', lots: 0.5, openPrice: 3338 }],
      states: [{ ticket: 1106, beMoved: true }]
    });

    expect(result).toEqual({ advisories: [], canProduceLiveCommands: false });
  });
});

describe('position manager dynamic-trailing advisory parity slice', () => {
  it('mirrors the Go TP1 dynamic trailing full close without live commands', () => {
    const result = evaluatePositionDynamicTrailing({
      currentPrice: 3343,
      currentAtr: 2,
      positions: [{ ticket: 1203, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 1203, tp1Hit: true, tp2Hit: false, maxProfitAtr: 4 }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1203, lots: 0.5, reason: 'trail_tp1_dd2.5' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1203,
        tp1Hit: true,
        tp2Hit: false,
        maxProfitAtr: 4
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go TP2 dynamic trailing full close with snake_case state', () => {
    const result = evaluatePositionDynamicTrailing({
      currentPrice: 3336.6,
      currentAtr: 2,
      positions: [{ ticket: 1204, type: 'SELL', lots: 0.3, openPrice: 3340 }],
      states: [{ ticket: 1204, tp1_hit: true, tp2_hit: true, max_profit_atr: 4 }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1204, lots: 0.3, reason: 'trail_tp2_dd2.3' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1204,
        tp1Hit: true,
        tp2Hit: true,
        maxProfitAtr: 4
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not emit dynamic trailing before TP1 has hit', () => {
    const result = evaluatePositionDynamicTrailing({
      currentPrice: 3343,
      currentAtr: 2,
      positions: [{ ticket: 1205, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 1205, tp1Hit: false, tp2Hit: false, maxProfitAtr: 4 }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1205,
        tp1Hit: false,
        tp2Hit: false,
        maxProfitAtr: 4
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('refreshes MaxProfitATR before evaluating drawdown', () => {
    const result = evaluatePositionDynamicTrailing({
      currentPrice: 3346,
      currentAtr: 2,
      positions: [{ ticket: 1206, type: 'BUY', lots: 0.5, openPrice: 3340 }],
      states: [{ ticket: 1206, tp1Hit: true, tp2Hit: false, maxProfitAtr: 2 }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1206,
        tp1Hit: true,
        tp2Hit: false,
        maxProfitAtr: 3
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

describe('position manager momentum-scalp exit advisory parity slice', () => {
  const now = '2026-04-13T08:00:00.000Z';
  const bullishM5Bars = [
    { close: 99.6 },
    { close: 99.8 },
    { close: 100.0 },
    { close: 100.1 },
    { close: 100.2 },
    { close: 100.3 },
    { close: 100.35 },
    { close: 100.4 }
  ];

  it('mirrors the Go momentum scalp time stop before indicator exits', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 100.15,
      currentAtr: 1,
      m5Bars: bullishM5Bars,
      m1Bars: [{ rsi: 82 }],
      positions: [{ ticket: 1303, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'bot momentum_scalp entry' }],
      states: [{ ticket: 1303, openTime: '2026-04-13T07:39:00.000Z' }]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 1303, lots: 0.5, reason: 'momentum_scalp_time_stop_0.2ATR' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1303,
        rsiTp75Triggered: false
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go one-time RSI 75 partial close and state update', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 101,
      currentAtr: 1,
      m5Bars: bullishM5Bars,
      m1Bars: [{ rsi: 76 }],
      positions: [{ ticket: 1304, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'momentum_scalp' }],
      states: [{ ticket: 1304, openTime: '2026-04-13T07:55:00.000Z', rsiTp75Triggered: false }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1304, lots: 0.25, reason: 'momentum_scalp_rsi_tp75' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1304,
        rsiTp75Triggered: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not repeat the RSI 75 partial close once state is triggered', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 101,
      currentAtr: 1,
      m5Bars: bullishM5Bars,
      m1Bars: [{ rsi: 76 }],
      positions: [{ ticket: 1305, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'momentum_scalp' }],
      states: [{ ticket: 1305, openTime: '2026-04-13T07:55:00.000Z', rsiTp75Triggered: true }]
    });

    expect(result.advisories).toEqual([]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1305,
        rsiTp75Triggered: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go RSI extreme full close', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 101.2,
      currentAtr: 1,
      m5Bars: bullishM5Bars,
      m1Bars: [{ rsi: 82 }],
      positions: [{ ticket: 1306, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'momentum_scalp' }],
      states: [{ ticket: 1306, openTime: '2026-04-13T07:55:00.000Z', rsiTp75Triggered: true }]
    });

    expect(result.advisories).toEqual([{ action: 'CLOSE', ticket: 1306, lots: 0.5, reason: 'momentum_scalp_rsi_extreme' }]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 1306,
        rsiTp75Triggered: true
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('mirrors the Go M5 EMA structure-break full close', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 100.9,
      currentAtr: 1,
      m5Bars: [
        { close: 100.8 },
        { close: 100.7 },
        { close: 100.6 },
        { close: 100.5 },
        { close: 100.4 },
        { close: 100.3 },
        { close: 100.2 },
        { close: 100.1 }
      ],
      m1Bars: [{ rsi: 60 }],
      positions: [{ ticket: 1307, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'momentum_scalp' }],
      states: [{ ticket: 1307, openTime: '2026-04-13T07:55:00.000Z' }]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 1307, lots: 0.5, reason: 'momentum_scalp_m5_structure_break' }
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not run momentum scalp exits for non-scalp comments', () => {
    const result = evaluatePositionMomentumScalpExits({
      now,
      currentPrice: 100.15,
      currentAtr: 1,
      m5Bars: bullishM5Bars,
      m1Bars: [{ rsi: 82 }],
      positions: [{ ticket: 1308, type: 'BUY', lots: 0.5, openPrice: 100, comment: 'GB_pullback_S7', strategy: 'momentum_scalp' }],
      states: [{ ticket: 1308, openTime: '2026-04-13T07:39:00.000Z' }]
    });

    expect(result).toEqual({ advisories: [], nextStates: [], canProduceLiveCommands: false });
  });
});

describe('position manager Analyze orchestration parity slice', () => {
  const now = '2026-04-13T08:00:00.000Z';
  const h1Bars = [
    { ema20: 3341, ema50: 3337, rsi: 65, adx: 32, macdHist: 0.6, atr: 2 },
    { ema20: 3341.5, ema50: 3337.5, rsi: 63, adx: 31, macdHist: 0.5, atr: 2 },
    { ema20: 3342, ema50: 3338, rsi: 60, adx: 30, macdHist: 0.4, atr: 2 },
    { ema20: 3342.5, ema50: 3338.5, rsi: 58, adx: 31, macdHist: 0.3, atr: 2 },
    { ema20: 3343, ema50: 3339, rsi: 56, adx: 29, macdHist: 0.2, atr: 2 }
  ];

  it('lets breakeven and TP1 fire in the same per-position pass', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3343.2,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [{ ticket: 202, type: 'BUY', openPrice: 3340, lots: 0.5 }],
      states: [{ ticket: 202, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5 }]
    });

    expect(result.advisories).toEqual([
      { action: 'MODIFY', ticket: 202, newSL: 3340, reason: 'breakeven_1.6ATR' },
      { action: 'CLOSE', ticket: 202, lots: 0.2, reason: 'TP1_1.6ATR' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 202,
        beMoved: true,
        tp1Hit: true,
        bestSl: 3340
      })
    ]);
    expect(result.nextStates[0]?.maxProfitAtr).toBeCloseTo(1.6);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('emits direct breakeven against own SL when same-side BestSL is polluted', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3343.2,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 606, type: 'BUY', openPrice: 3340, lots: 0.5, sl: 3338 },
        { ticket: 607, type: 'BUY', openPrice: 3342, lots: 0.3, sl: 3342 }
      ],
      states: [
        { ticket: 606, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, beMoved: false, bestSl: 3342 },
        { ticket: 607, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, beMoved: true, bestSl: 3342 }
      ]
    });

    expect(result.advisories).toContainEqual(
      { action: 'MODIFY', ticket: 606, newSL: 3340, reason: 'breakeven_1.6ATR' }
    );
    expect(result.nextStates).toContainEqual(
      expect.objectContaining({ ticket: 606, beMoved: true })
    );
  });

  it('re-emits breakeven when beMoved is stale and EA SL is still below open', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3343.2,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [{ ticket: 608, type: 'BUY', openPrice: 3340, lots: 0.5, sl: 3338 }],
      states: [
        { ticket: 608, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, be_moved: true, bestSl: 3340 }
      ]
    });

    expect(result.advisories).toContainEqual(
      { action: 'MODIFY', ticket: 608, newSL: 3340, reason: 'breakeven_1.6ATR' }
    );
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 608, beMoved: true, be_moved: true, bestSl: 3340 })
    ]);
  });

  it('short-circuits later rules when momentum scalp time stop wins', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 100.15,
      currentAtr: 1,
      avgAtr: 1,
      h1Bars,
      m5Bars: [
        { close: 99.6 },
        { close: 99.8 },
        { close: 100 },
        { close: 100.1 },
        { close: 100.2 },
        { close: 100.3 },
        { close: 100.35 },
        { close: 100.4 }
      ],
      m1Bars: [{ rsi: 82 }],
      positions: [{ ticket: 404, type: 'BUY', openPrice: 100, lots: 0.5, comment: 'bot momentum_scalp entry' }],
      states: [{ ticket: 404, openTime: '2026-04-13T07:39:00.000Z', beTriggerAtr: 1.5 }]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 404, lots: 0.5, reason: 'momentum_scalp_time_stop_0.2ATR' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({
        ticket: 404,
        rsiTp75Triggered: false,
        maxProfitAtr: 0.15000000000000568
      })
    ]);
  });

  it('runs same-side TP1 coordination after the per-position pass', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3343,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 901, type: 'BUY', openPrice: 3330, lots: 0.5, sl: 3330 },
        { ticket: 902, type: 'BUY', openPrice: 3342, lots: 0.3, sl: 3342 }
      ],
      states: [
        { ticket: 901, openTime: '2026-04-13T05:00:00.000Z', beTriggerAtr: 1.5, beMoved: true, bestSl: 3330 },
        { ticket: 902, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, beMoved: true, bestSl: 3342 }
      ]
    });

    expect(result.advisories).toEqual([
      { action: 'CLOSE', ticket: 901, lots: 0.2, reason: 'TP1_6.5ATR' },
      { action: 'CLOSE', ticket: 902, lots: 0.12, reason: 'group_tp1_BUY' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 901, tp1Hit: true }),
      expect.objectContaining({ ticket: 902, tp1Hit: true })
    ]);
  });

  it('runs same-side breakeven coordination after direct breakeven moves', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3343.2,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 1001, type: 'BUY', openPrice: 3330, lots: 0.5 },
        { ticket: 1002, type: 'BUY', openPrice: 3340, lots: 0.3 }
      ],
      states: [
        { ticket: 1001, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, bestSl: 0 },
        { ticket: 1002, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, bestSl: 0 }
      ]
    });

    expect(result.advisories).toEqual([
      { action: 'MODIFY', ticket: 1001, newSL: 3330, reason: 'breakeven_6.6ATR' },
      { action: 'CLOSE', ticket: 1001, lots: 0.2, reason: 'TP1_6.6ATR' },
      { action: 'MODIFY', ticket: 1002, newSL: 3340, reason: 'breakeven_1.6ATR' },
      { action: 'CLOSE', ticket: 1002, lots: 0.12, reason: 'TP1_1.6ATR' },
      { action: 'MODIFY', ticket: 1001, newSL: 3340, reason: 'group_be_BUY' }
    ]);
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 1001, beMoved: true, tp1Hit: true, bestSl: 3340 }),
      expect.objectContaining({ ticket: 1002, beMoved: true, tp1Hit: true, bestSl: 3340 })
    ]);
  });

  it('tightens stop loss when a favorable add-on position is detected', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3345,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 2001, type: 'BUY', openPrice: 3330, lots: 0.5, sl: 3328 },
        { ticket: 2002, type: 'BUY', openPrice: 3340, lots: 0.3, sl: 3338 }
      ],
      states: [
        { ticket: 2001, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, beMoved: false, bestSl: 3328 }
      ]
    });

    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'MODIFY', ticket: 2001, newSL: 3340, reason: 'group_favorable_addon_BUY' })
    );
    expect(result.nextStates).toEqual([
      expect.objectContaining({ ticket: 2001, bestSl: 3340 }),
      expect.objectContaining({ ticket: 2002, bestSl: 3340 })
    ]);
  });

  it('tightens stop loss to group avg entry when adverse add-on detected', () => {
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3320,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        { ticket: 3001, type: 'BUY', openPrice: 3330, lots: 0.1, sl: 3328, profit: -10 },
        { ticket: 3002, type: 'BUY', openPrice: 3325, lots: 0.06, sl: 3323, profit: -5 }
      ],
      states: [
        { ticket: 3001, openTime: '2026-04-13T06:00:00.000Z', beTriggerAtr: 1.5, beMoved: false, bestSl: 3328 }
      ]
    });

    const groupAvgEntry = (3330 * 0.1 + 3325 * 0.06) / 0.16;
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'MODIFY', ticket: 3001, newSL: expect.closeTo(groupAvgEntry, 0.01), reason: 'group_adverse_reanchor_BUY' })
    );
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'MODIFY', ticket: 3002, newSL: expect.closeTo(groupAvgEntry, 0.01), reason: 'group_adverse_reanchor_BUY' })
    );
    expect(result.nextStates[0].groupAvgEntry).toBeCloseTo(groupAvgEntry, 2);
    expect(result.nextStates[0].addOnCount).toBe(0);
    expect(result.nextStates[1].addOnCount).toBe(1);
  });

  it('does not trigger adverse reanchor when net loss is below 6% of equity', () => {
    const equity = 10000;
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3300,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      equity,
      positions: [
        { ticket: 4001, type: 'BUY', openPrice: 3330, lots: 0.1, sl: 3328, profit: -300 },
        { ticket: 4002, type: 'BUY', openPrice: 3320, lots: 0.06, sl: 3318, profit: -120 },
        { ticket: 4003, type: 'BUY', openPrice: 3310, lots: 0.04, sl: 3308, profit: -40 }
      ],
      states: [
        { ticket: 4001, openTime: '2026-04-13T06:00:00.000Z', addOnCount: 0 },
        { ticket: 4002, openTime: '2026-04-13T06:30:00.000Z', addOnCount: 1 },
        { ticket: 4003, openTime: '2026-04-13T07:00:00.000Z', addOnCount: 2 }
      ]
    });

    const closeAdvisories = result.advisories.filter((a) => a.action === 'CLOSE' && a.reason.startsWith('adverse_group_exit'));
    expect(closeAdvisories).toHaveLength(0);
  });

  it('closes all positions when net loss reaches 6% threshold', () => {
    const equity = 10000;
    const result = evaluatePositionManagerCommands({
      now,
      currentPrice: 3290,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      equity,
      positions: [
        { ticket: 5001, type: 'BUY', openPrice: 3330, lots: 0.1, sl: 3328, profit: -400 },
        { ticket: 5002, type: 'BUY', openPrice: 3320, lots: 0.06, sl: 3318, profit: -180 },
        { ticket: 5003, type: 'BUY', openPrice: 3310, lots: 0.04, sl: 3308, profit: -80 }
      ],
      states: [
        { ticket: 5001, openTime: '2026-04-13T06:00:00.000Z', addOnCount: 0 },
        { ticket: 5002, openTime: '2026-04-13T06:30:00.000Z', addOnCount: 1 },
        { ticket: 5003, openTime: '2026-04-13T07:00:00.000Z', addOnCount: 2 }
      ]
    });

    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'CLOSE', ticket: 5001, lots: 0.1, reason: expect.stringMatching(/adverse_group_exit_\d+\.\d+pct/) })
    );
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'CLOSE', ticket: 5002, lots: 0.06 })
    );
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ action: 'CLOSE', ticket: 5003, lots: 0.04 })
    );
  });
});

describe('position manager pending vs market separation', () => {
  const h1Bars = Array.from({ length: 6 }, (_, index) => ({
    time: `2026-04-13T0${index}:00:00.000Z`,
    open: 3340,
    high: 3342,
    low: 3338,
    close: 3340,
    atr: 2,
    ema20: 3340,
    ema50: 3335,
    rsi: 50,
    adx: 25,
    macdHist: 0
  }));

  it('excludes pending orders from open position summary', () => {
    const summary = summarizePositions({
      accountId: '90011087',
      symbol: 'XAGUSD',
      positions: [
        {
          ticket: 42275433,
          symbol: 'XAGUSD',
          type: 'SELL_LIMIT',
          order_class: 'pending',
          lots: 0.05,
          openPrice: 59.5,
          profit: 0,
          strategy: 'ai_signal'
        },
        {
          ticket: 99,
          symbol: 'XAGUSD',
          type: 'SELL',
          order_class: 'market',
          lots: 0.02,
          openPrice: 59.1,
          profit: 1.2,
          strategy: 'ai_signal'
        }
      ]
    });

    expect(summary.totalOpenPositions).toBe(1);
    expect(summary.sellLots).toBe(0.02);
  });

  it('does not run trail/tp close on pending orders', () => {
    const result = evaluatePositionManagerCommands({
      now: '2026-04-13T08:00:00.000Z',
      currentPrice: 58.4,
      currentAtr: 0.5,
      avgAtr: 0.5,
      h1Bars,
      positions: [
        {
          ticket: 42275433,
          type: 'SELL_LIMIT',
          order_class: 'pending',
          lots: 0.05,
          openPrice: 59.5,
          open_price: 59.5,
          sl: 59.5,
          tp: 57.0,
          profit: 0,
          strategy: 'ai_signal'
        }
      ],
      states: [
        {
          ticket: 42275433,
          tp1Hit: true,
          tp2Hit: true,
          maxProfitAtr: 3.6,
          beMoved: true,
          openTime: '2026-04-12T23:00:00.000Z'
        }
      ]
    });

    expect(result.advisories.filter((a) => a.action === 'CLOSE')).toEqual([]);
    expect(result.advisories.filter((a) => a.action === 'MODIFY')).toEqual([]);
  });

  it('cancels pending order when market price has reached its TP', () => {
    const result = evaluatePositionManagerCommands({
      now: '2026-04-13T08:00:00.000Z',
      currentPrice: 58.36,
      currentAtr: 0.5,
      avgAtr: 0.5,
      h1Bars,
      positions: [
        {
          ticket: 42275433,
          type: 'SELL_LIMIT',
          order_class: 'pending',
          lots: 0.05,
          openPrice: 59.5,
          open_price: 59.5,
          sl: 59.5,
          tp: 58.36,
          profit: 0,
          strategy: 'ai_signal'
        }
      ],
      states: []
    });

    expect(result.advisories).toEqual([
      {
        action: 'CANCEL_PENDING',
        ticket: 42275433,
        reason: 'pending_tp_reached_58.36'
      }
    ]);
  });

  it('infers pending from type when order_class is missing', () => {
    const result = evaluatePositionManagerCommands({
      now: '2026-04-13T08:00:00.000Z',
      currentPrice: 3350,
      currentAtr: 2,
      avgAtr: 2,
      h1Bars,
      positions: [
        {
          ticket: 88,
          type: 'BUY_STOP',
          lots: 0.1,
          openPrice: 3340,
          tp: 3350,
          profit: 0
        }
      ]
    });

    expect(result.advisories).toEqual([
      {
        action: 'CANCEL_PENDING',
        ticket: 88,
        reason: 'pending_tp_reached_3350'
      }
    ]);
  });
});
