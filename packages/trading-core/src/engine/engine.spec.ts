import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EA_STRATEGY_NAMES } from '@gold-bot/shared-contracts';
import { analyze, createStrategyEngine } from './engine.js';

const replayFixtureRoot = join(import.meta.dirname, '../../../../tests/replay/testdata');

function readReplayFixture(name: string) {
  return JSON.parse(readFileSync(join(replayFixtureRoot, name), 'utf8')) as {
    account_id: string;
    current_price: number;
    bars: Record<string, Array<{ time?: string; open: number; high: number; low: number; close: number; volume?: number }>>;
  };
}

describe('strategy engine replay-backed slice', () => {
  it('returns a no-signal decision without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: 'XAUUSD',
      price: 3335.75,
      bars: {}
    });

    expect(result).toEqual({
      decision: 'no_signal',
      signal: null,
      logs: [],
      canProduceLiveCommands: false
    });
  });

  it('validates strategy outputs against the EA-approved strategy names', () => {
    const engine = createStrategyEngine();

    for (const strategy of EA_STRATEGY_NAMES) {
      expect(() => engine.validateStrategyName(strategy)).not.toThrow();
    }
    expect(() => engine.validateStrategyName('scale_in')).toThrow(/not an EA strategy name/);
    expect(() => engine.validateStrategyName('smc')).toThrow(/not an EA strategy name/);
  });

  it('returns the replay-backed pullback signal for the frozen Go oracle fixture', () => {
    const snapshot = readReplayFixture('account_90011087_snapshot.json');

    const result = analyze({
      accountId: snapshot.account_id,
      symbol: 'XAUUSD',
      price: snapshot.current_price,
      bars: snapshot.bars
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'pullback',
      side: 'BUY',
      entry: 3335.75,
      stopLoss: 3331.74,
      tp1: 3339.76,
      tp2: 3343.77,
      score: 6
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      message: '✅ 发出信号: BUY @ 3335.75 | SL=3331.74 | 策略=pullback | 评分=6'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed momentum scalp signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 100,
      bars: momentumScalpBuyBars()
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'momentum_scalp',
      side: 'BUY',
      entry: 100,
      stopLoss: 99.4,
      tp1: 100.75,
      tp2: 101.2,
      score: 10
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '动量剥头皮',
      message: '🟢 BUY 评分=10 | M15 ADX=33.0 | M5 MACDHist=0.81 | M1 RSI=49.0 | 成交量=1.62x | M15 ADX=33.0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps XAUUSD momentum scalp signals using Go gold thresholds', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: 'XAUUSD',
      price: 100,
      bars: momentumScalpBuyBars({
        m15Adx: 18.5,
        previousMacdHist: -0.2,
        macdHist: -0.1,
        rsi: 52,
        volume: 90
      })
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toMatchObject({
      strategy: 'momentum_scalp',
      side: 'BUY',
      entry: 100,
      stopLoss: 99.4,
      tp1: 100.75,
      tp2: 101.2,
      score: 6
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('boosts a pullback BUY signal when M15 confirms the entry', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 95,
      bars: {
        H1: pullbackBuyBars(),
        M15: pullbackM15ConfirmBars()
      }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95,
      stopLoss: 92,
      tp1: 98,
      tp2: 101,
      score: 10
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '趋势回调',
      message: '🟢 BUY 评分=9 | EMA20回调 dist=0.80 | MACD柱>0 | RSI=45.0<50 | ADX=35.0>30 | 连续2根回调到位'
    });
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'M15确认',
      message: '✅ pullback | M15确认: RSI=35.0<40(多头) | 评分+1→10'
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      message: '✅ 发出信号: BUY @ 95.00 | SL=92.00 | 策略=pullback | 评分=10'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('filters a pullback BUY signal when H4 is range-bound', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4RangeBars()
      }
    });

    expect(result).toEqual({
      decision: 'no_signal',
      signal: null,
      logs: expect.arrayContaining([
        {
          level: 'warn',
          strategy: 'H4过滤',
          message: 'H4=震荡(ADX=10.0<30), 过滤所有信号'
        }
      ]),
      canProduceLiveCommands: false
    });
  });

  it('filters a pullback BUY signal when H4 strong trend is opposite', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4StrongBearBars()
      }
    });

    expect(result).toEqual({
      decision: 'no_signal',
      signal: null,
      logs: expect.arrayContaining([
        {
          level: 'warn',
          strategy: 'H4过滤',
          message: 'H4=强空头,过滤掉 1 个逆势信号,保留 0 个'
        },
        {
          level: 'info',
          strategy: 'H4过滤',
          message: 'H4趋势过滤后无信号'
        }
      ]),
      canProduceLiveCommands: false
    });
  });

  it('maps the replay-backed breakout retest signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 102.2,
      bars: breakoutRetestBuyBars()
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'breakout_retest',
      side: 'BUY',
      entry: 102.2,
      stopLoss: 99,
      tp1: 106.2,
      tp2: 110.2,
      score: 10
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破回踩',
      message: '🟢 BUY 评分=10 | 阻力位=102.00 突破后回踩 dist=0.20 | 成交量确认 | MACD柱>0 | ADX=26.0 | RSI=58.0 | 回踩确认3根'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed breakout retest SELL signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 97.8,
      bars: breakoutRetestSellBars()
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'breakout_retest',
      side: 'SELL',
      entry: 97.8,
      stopLoss: 101,
      tp1: 93.8,
      tp2: 89.8,
      score: 9
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破回踩',
      message: '🔴 SELL 评分=9 | 支撑位=98.00 突破后回踩 dist=0.20 | 成交量确认 | MACD柱<0 | ADX=26.0 | RSI=42.0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps a fib-enhanced pullback BUY slice with fib786 stop loss', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: 'XAUUSD',
      price: 95,
      bars: {
        H1: pullbackFibBuyBars(),
        H4: pullbackFibH4BarsUp()
      }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95,
      stopLoss: 88,
      tp1: 98,
      tp2: 101,
      score: 10
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '趋势回调',
      message: '🟢 BUY 评分=10 | EMA20回调 dist=0.80 | MACD柱>0 | RSI=45.0<50 | ADX=35.0>30 | 连续2根回调到位'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed divergence signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 94,
      bars: { H1: divergenceBuyBars() }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'divergence',
      side: 'BUY',
      entry: 94,
      stopLoss: 91,
      tp1: 98,
      tp2: 102,
      score: 9
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: 'RSI背离',
      message: '🟢 BUY 评分=9 | 看涨背离: 价格新低93.00<95.00 RSI抬高35.0>30.0 | MACD背离确认 | 成交量萎缩 | StochK=0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed divergence SELL signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 106,
      bars: { H1: divergenceSellBars() }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'divergence',
      side: 'SELL',
      entry: 106,
      stopLoss: 109,
      tp1: 102,
      tp2: 98,
      score: 9
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: 'RSI背离',
      message: '🔴 SELL 评分=9 | 看跌背离: 价格新高107.00>105.00 RSI降低65.0<70.0 | MACD背离确认 | 成交量萎缩 | StochK=90'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed breakout pyramid signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 102,
      bars: { H1: breakoutPyramidBuySignalBars() }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'breakout_pyramid',
      side: 'BUY',
      entry: 102,
      stopLoss: 98,
      tp1: 106,
      tp2: 112,
      score: 9
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破加仓',
      message: '🟢 BUY 评分=9 | 收盘价突破布林上轨=101.00 | ADX=35.0>30 | RSI=60.0 | MACD柱>0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed breakout pyramid SELL signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 98,
      bars: { H1: breakoutPyramidSellSignalBars() }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'breakout_pyramid',
      side: 'SELL',
      entry: 98,
      stopLoss: 102,
      tp1: 94,
      tp2: 88,
      score: 9
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破加仓',
      message: '🔴 SELL 评分=9 | 收盘价突破布林下轨=99.00 | ADX=35.0>30 | RSI=40.0 | MACD柱<0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed counter pullback BUY signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 100.4,
      bars: { H1: counterPullbackBuyBars() },
      smc: {
        h1_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        h1_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }]
      }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'counter_pullback',
      side: 'BUY',
      entry: 100.4,
      stopLoss: 99,
      tp1: 104.4,
      tp2: 108.4,
      score: 7
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      message: '🟢 BUY 评分=7 | 看涨反转回调: CHoCH↑+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=44.0 | MACD>0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('maps the replay-backed counter pullback SELL signal without producing live commands', () => {
    const result = analyze({
      accountId: '90011087',
      symbol: '',
      price: 99.6,
      bars: { H1: counterPullbackSellBars() },
      smc: {
        h1_breaks: [{ index: 18, direction: 'DOWN', level: 99, type: 'CHoCH' }],
        h1_sweeps: [{ index: 17, level: 100, side: 'BEAR', reversed: true }]
      }
    });

    expect(result.decision).toBe('signal');
    expect(result.signal).toEqual({
      strategy: 'counter_pullback',
      side: 'SELL',
      entry: 99.6,
      stopLoss: 101,
      tp1: 95.6,
      tp2: 91.6,
      score: 7
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      message: '🔴 SELL 评分=7 | 看跌反转回调: CHoCH↓+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=56.0 | MACD<0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });
});

function momentumScalpBuyBars(
  options: { m15Adx?: number; previousMacdHist?: number; macdHist?: number; rsi?: number; volume?: number } = {}
) {
  const m15Adx = options.m15Adx ?? 33;
  const previousMacdHist = options.previousMacdHist ?? 0.73;
  const macdHist = options.macdHist ?? 0.81;
  const rsi = options.rsi ?? 49;
  const volume = options.volume ?? 130;

  return {
    M15: [
      { open: 96, high: 96, low: 96, close: 96, ema20: 96, ema50: 94, adx: 28 },
      { open: 97, high: 97, low: 97, close: 97, ema20: 97, ema50: 95, adx: m15Adx }
    ],
    M5: [
      { open: 98, high: 98, low: 98, close: 98, macd_hist: 0.1 },
      { open: 98.4, high: 98.4, low: 98.4, close: 98.4, macd_hist: 0.15 },
      { open: 98.8, high: 98.8, low: 98.8, close: 98.8, macd_hist: 0.21 },
      { open: 99, high: 99, low: 99, close: 99, macd_hist: 0.27 },
      { open: 99.2, high: 99.2, low: 99.2, close: 99.2, macd_hist: 0.34 },
      { open: 99.4, high: 99.4, low: 99.4, close: 99.4, macd_hist: 0.4 },
      { open: 99.5, high: 99.5, low: 99.5, close: 99.5, macd_hist: 0.47 },
      { open: 99.6, high: 99.6, low: 99.6, close: 99.6, macd_hist: 0.54 },
      { open: 99.7, high: 99.7, low: 99.7, close: 99.7, macd_hist: 0.6 },
      { open: 99.8, high: 99.8, low: 99.8, close: 99.8, macd_hist: 0.66 },
      { open: 99.9, high: 99.9, low: 99.9, close: 99.9, macd_hist: previousMacdHist },
      { open: 100, high: 100, low: 100, close: 100, macd_hist: macdHist }
    ],
    M1: Array.from({ length: 14 }, (_, index) => ({
      open: 99 + index * 0.02,
      high: 99 + index * 0.02,
      low: 99 + index * 0.02,
      close: 99 + index * 0.02,
      atr: 1.5,
      rsi: index === 12 ? 38 : index === 13 ? rsi : 44,
      volume: index === 13 ? volume : 90,
      vol_sma: 80
    }))
  };
}

function breakoutRetestBuyBars() {
  const bars = Array.from({ length: 55 }, (_, index) => ({
    time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr: 2,
    adx: 18,
    rsi: 50,
    ema20: 120,
    ema50: 119,
    macd_hist: 0
  }));

  for (let index = 0; index < 50; index += 1) {
    bars[index].high = 102;
  }
  const lastFive = [
    { high: 103.2, low: 101.7, close: 103 },
    { high: 102.8, low: 101.8, close: 102.5 },
    { high: 102.6, low: 101.9, close: 102.3 },
    { high: 102.5, low: 101.95, close: 102.25 },
    { high: 102.4, low: 102.0, close: 102.2 }
  ];
  for (const [offset, value] of lastFive.entries()) {
    const bar = bars[50 + offset];
    bar.high = value.high;
    bar.low = value.low;
    bar.close = value.close;
    bar.open = value.close;
    bar.atr = 2;
    bar.adx = offset === 4 ? 26 : 18;
    bar.rsi = offset === 4 ? 58 : 50;
    bar.ema20 = 120;
    bar.ema50 = 119;
    bar.macd_hist = offset === 4 ? 0.3 : 0;
    bar.volume = offset === 4 ? 160 : 100;
    bar.vol_sma = 100;
  }
  return { H1: bars };
}

function breakoutRetestSellBars() {
  const bars = Array.from({ length: 55 }, (_, index) => ({
    time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr: 2,
    adx: 18,
    rsi: 50,
    ema20: 119,
    ema50: 120,
    macd_hist: 0
  }));

  for (let index = 0; index < 50; index += 1) {
    bars[index].low = 98;
  }
  const lastFive = [
    { high: 98.3, low: 96.8, close: 97 },
    { high: 98.2, low: 97.2, close: 97.5 },
    { high: 98.1, low: 97.4, close: 97.7 },
    { high: 98.05, low: 97.55, close: 97.75 },
    { high: 98.0, low: 97.6, close: 97.8 }
  ];
  for (const [offset, value] of lastFive.entries()) {
    const bar = bars[50 + offset];
    bar.high = value.high;
    bar.low = value.low;
    bar.close = value.close;
    bar.open = value.close;
    bar.atr = 2;
    bar.adx = offset === 4 ? 26 : 18;
    bar.rsi = offset === 4 ? 42 : 50;
    bar.ema20 = 119;
    bar.ema50 = 120;
    bar.macd_hist = offset === 4 ? -0.3 : 0;
    bar.volume = offset === 4 ? 160 : 100;
    bar.vol_sma = 100;
  }
  return { H1: bars };
}

function pullbackFibBuyBars() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-15T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    atr: 2,
    adx: 35,
    rsi: 45,
    ema20: 95.8,
    ema50: 90,
    macd_hist: 1
  }));

  bars[48] = {
    ...bars[48],
    close: 95.2,
    open: 95.2
  };
  bars[49] = {
    ...bars[49],
    close: 95,
    open: 95,
    fib_382: 96,
    fib_618: 92,
    fib_786: 89
  };
  return bars;
}

function h4RangeBars() {
  return Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    adx: 10,
    ema20: 100,
    ema50: 99
  }));
}

function h4StrongBearBars() {
  return Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    adx: 35,
    ema20: 99,
    ema50: 100
  }));
}

function pullbackFibH4BarsUp() {
  return Array.from({ length: 5 }, (_, index) => ({
    time: `2026-04-15T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 90 + index,
    high: 100 + index,
    low: 88 + index,
    close: 95 + index,
    adx: 30,
    ema20: 110,
    ema50: 100
  }));
}

function pullbackBuyBars() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    atr: 2,
    adx: 35,
    rsi: 45,
    ema20: 95.8,
    ema50: 90,
    macd_hist: 1
  }));

  bars[48] = {
    ...bars[48],
    close: 95.2,
    open: 95.2
  };
  bars[49] = {
    ...bars[49],
    close: 95,
    open: 95
  };
  return bars;
}

function pullbackM15ConfirmBars() {
  return Array.from({ length: 14 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 95.5,
    low: 94.5,
    close: 95,
    atr: 2,
    rsi: index === 13 ? 35 : 45
  }));
}

function divergenceBuyBars() {
  const bars = Array.from({ length: 30 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 101,
    high: 102,
    low: 100,
    close: index < 15 ? 101 : 100,
    atr: 2,
    adx: 10,
    rsi: index < 15 ? 55 : 50,
    ema20: 120,
    ema50: 119,
    bb_upper: 130,
    bb_lower: 80,
    macd_hist: index < 15 ? 0.1 : 0.2,
    stoch_k: 0
  }));

  bars[5].close = 95;
  bars[5].rsi = 30;
  bars[5].macd_hist = -0.5;

  bars[25].close = 93;
  bars[25].rsi = 35;
  bars[25].macd_hist = -0.2;

  bars[28].macd_hist = 0.1;
  bars[29] = {
    ...bars[29],
    open: 94,
    high: 95,
    low: 93.5,
    close: 94,
    rsi: 38,
    macd_hist: 0.2,
    volume: 60,
    vol_sma: 100
  };
  return bars;
}

function divergenceSellBars() {
  const bars = Array.from({ length: 30 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 101,
    high: 102,
    low: 100,
    close: index < 15 ? 101 : 100,
    atr: 2,
    adx: 10,
    rsi: index < 15 ? 45 : 40,
    ema20: 120,
    ema50: 119,
    bb_upper: 130,
    bb_lower: 80,
    macd_hist: index < 15 ? 0.2 : 0.1,
    stoch_k: 50
  }));

  bars[5].close = 105;
  bars[5].rsi = 70;
  bars[5].macd_hist = 0.5;

  bars[25].close = 107;
  bars[25].rsi = 65;
  bars[25].macd_hist = 0.2;

  bars[28].macd_hist = 0.2;
  bars[29] = {
    ...bars[29],
    open: 106,
    high: 107,
    low: 105,
    close: 106,
    rsi: 62,
    macd_hist: 0.1,
    volume: 60,
    vol_sma: 100,
    stoch_k: 90
  };
  return bars;
}

function breakoutPyramidBuySignalBars() {
  const bars = Array.from({ length: 30 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    atr: 2,
    adx: 35,
    rsi: 60,
    ema20: 101,
    ema50: 99,
    bb_upper: 101,
    bb_lower: 99,
    macd_hist: 0.2
  }));
  bars[29] = {
    ...bars[29],
    open: 102,
    high: 102.4,
    low: 101.2,
    close: 102
  };
  return bars;
}

function breakoutPyramidSellSignalBars() {
  const bars = breakoutPyramidBuySignalBars();
  bars[29] = {
    ...bars[29],
    open: 98,
    high: 98.8,
    low: 97.6,
    close: 98,
    rsi: 40,
    ema20: 99,
    ema50: 101,
    macd_hist: -0.2
  };
  return bars;
}

function counterPullbackBuyBars() {
  return Array.from({ length: 20 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr: 2,
    adx: 10,
    rsi: index === 19 ? 44 : 50,
    ema20: 120,
    ema50: 119,
    bb_upper: 130,
    bb_lower: 80,
    macd_hist: index === 19 ? 0.1 : 0
  }));
}

function counterPullbackSellBars() {
  return Array.from({ length: 20 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr: 2,
    adx: 10,
    rsi: index === 19 ? 56 : 50,
    ema20: 119,
    ema50: 120,
    bb_upper: 130,
    bb_lower: 80,
    macd_hist: index === 19 ? -0.1 : 0
  }));
}
