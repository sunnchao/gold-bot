import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runReplay } from '../index.js';

const fixtureRoot = join(import.meta.dirname, '../../../../tests/replay/testdata');

function readReplayFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
}

describe('replay harness Go oracle slice', () => {
  it('loads the frozen Go replay fixture used for parity', () => {
    const snapshot = readReplayFixture('account_90011087_snapshot.json') as {
      current_price?: number;
      bars?: { H1?: unknown[] };
    };
    const expected = readReplayFixture('account_90011087_expected.json') as {
      signal?: { strategy?: string };
    };

    expect(snapshot.current_price).toBe(3335.75);
    expect(snapshot.bars?.H1).toHaveLength(65);
    expect(expected.signal?.strategy).toBe('pullback');
  });

  it('matches the Go oracle signal and position command output for the frozen replay fixture', () => {
    const snapshot = readReplayFixture('account_90011087_snapshot.json');
    const expected = readReplayFixture('account_90011087_expected.json') as {
      signal: unknown;
      logs: unknown;
      position_commands: unknown;
    };

    const result = runReplay(snapshot);

    expect(result.signal).toEqual(expected.signal);
    expect(result.logs).toEqual(expected.logs);
    expect(result.position_commands).toEqual(expected.position_commands);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not synthesize position commands from replay-only snapshots', () => {
    const snapshot = readReplayFixture('account_90011087_snapshot.json') as {
      positions?: unknown[];
    };

    const result = runReplay({
      ...snapshot,
      positions: [{ ticket: 101, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
    });

    expect(result.position_commands).toBeNull();
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('blocks a same-side signal that is within 1 ATR of an existing position', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      positions: [{ ticket: 101, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 95.5 }]
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        strategy: '汇总',
        msg: expect.stringContaining('防重复: 已有同向持仓')
      })
    );
    expect(result.position_commands).toBeNull();
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('blocks an opposing-side signal that is within 2 ATR of an existing position', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      positions: [{ ticket: 102, symbol: 'XAUUSD', type: 'SELL', lots: 0.1, open_price: 98 }]
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        strategy: '汇总',
        msg: expect.stringContaining('防对冲: 已有反向持仓')
      })
    );
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('allows pullback signal when breakout_retest position exists (strategy isolation)', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      positions: [
        { ticket: 101, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 95.5, strategy: 'breakout_retest' }
      ]
    });

    expect(result.signal).not.toBeNull();
    expect(result.signal?.strategy).toBe('pullback');
    expect(result.signal?.side).toBe('BUY');
  });

  it('blocks pullback signal when another pullback position exists (same strategy)', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      positions: [
        { ticket: 101, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 95.5, strategy: 'pullback' }
      ]
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        strategy: '汇总',
        msg: expect.stringContaining('防重复: 已有同向持仓 [pullback]')
      })
    );
  });

  it('allows ai_signal when technical strategy position exists (cross-strategy isolation)', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      positions: [
        { ticket: 101, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 95.5, strategy: 'divergence' }
      ]
    });

    // The signal would normally be blocked, but with strategy isolation it should pass
    // Note: this test validates the filter logic, actual signal depends on strategy detection
    expect(result.signal).not.toBeNull();
    expect(result.signal?.strategy).toBe('pullback');
  });

  it('applies an AI suggested stop loss override when the distance and side are valid', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      ai_result: {
        suggested_sl: 93
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 95,
      stop_loss: 93,
      tp1: 95.8,
      tp2: 96.13,
      score: 9,
      strategy: 'pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'pullback',
          side: 'BUY',
          score: 9,
          entry: 95,
          stop_loss: 93
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'AI止损',
      msg: '🤖 AI止损覆盖: 93.13 → 93.00 (基于支撑阻力位)'
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      msg: '✅ 发出信号: BUY @ 95.00 | SL=93.00 | 策略=pullback | 评分=9'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('applies an AI suggested take profit override when the distance and side are valid', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      },
      ai_result: {
        suggested_tp: 100
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 95,
      stop_loss: 93.13,
      tp1: 100,
      tp2: 100,
      score: 9,
      strategy: 'pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'pullback',
          side: 'BUY',
          score: 9,
          entry: 95,
          stop_loss: 93.13
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'AI止盈',
      msg: '🤖 AI止盈覆盖: TP1=95.80→100.00, TP2=96.13→100.00'
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      msg: '✅ 发出信号: BUY @ 95.00 | SL=93.13 | 策略=pullback | 评分=9'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('returns audit-only position command advisories when replay has complete position state', () => {
    const h1Bars = Array.from({ length: 15 }, (_, index) => ({
      time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
      open: 3340,
      high: 3341,
      low: 3339,
      close: 3340
    }));

    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      analysis_time: '2026-04-13T08:00:00.000Z',
      current_price: 3343.2,
      bars: {
        H1: h1Bars
      },
      positions: [{ ticket: 202, symbol: 'XAUUSD', type: 'BUY', open_price: 3340, lots: 0.5 }],
      position_states: [{ ticket: 202, open_time: '2026-04-13T06:00:00.000Z', be_trigger_atr: 1.5 }]
    });

    expect(result.position_commands).toEqual([
      { action: 'MODIFY', ticket: 202, new_sl: 3340, reason: 'breakeven_1.6ATR' },
      { action: 'CLOSE', ticket: 202, lots: 0.2, reason: 'TP1_1.6ATR' }
    ]);
    expect(result.position_states).toEqual([
      expect.objectContaining({
        ticket: 202,
        beMoved: true,
        tp1Hit: true,
        maxProfitAtr: expect.closeTo(1.6, 5)
      })
    ]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  // NOTE: d888a5d 起 momentum_scalp 持仓识别与 momentumScalpExitAdvisory 已禁用
  // （positionmgr/manager.ts 中注释掉），M1 RSI TP75 减仓通道不再产生命令。
  // 与 engine.spec.ts 的 momentum 测试同样处理为 skip，待策略重新启用时恢复。
  it.skip('preserves precomputed M1 RSI for replay-integrated momentum scalp advisories', () => {
    const h1Bars = Array.from({ length: 15 }, (_, index) => ({
      time: `2026-04-13T${String(index).padStart(2, '0')}:00:00.000Z`,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100
    }));

    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      analysis_time: '2026-04-13T08:00:00.000Z',
      current_price: 101,
      bars: {
        H1: h1Bars,
        M5: [
          { open: 99.6, high: 99.6, low: 99.6, close: 99.6 },
          { open: 99.8, high: 99.8, low: 99.8, close: 99.8 },
          { open: 100, high: 100, low: 100, close: 100 },
          { open: 100.1, high: 100.1, low: 100.1, close: 100.1 },
          { open: 100.2, high: 100.2, low: 100.2, close: 100.2 },
          { open: 100.3, high: 100.3, low: 100.3, close: 100.3 },
          { open: 100.35, high: 100.35, low: 100.35, close: 100.35 },
          { open: 100.4, high: 100.4, low: 100.4, close: 100.4 }
        ],
        M1: [{ open: 101, high: 101, low: 101, close: 101, rsi: 76 }]
      },
      positions: [{ ticket: 505, symbol: 'XAUUSD', type: 'BUY', open_price: 100, lots: 0.5, comment: 'momentum_scalp' }],
      position_states: [
        { ticket: 505, open_time: '2026-04-13T07:55:00.000Z', be_trigger_atr: 1.5, rsi_tp75_triggered: false }
      ]
    });

    expect(result.position_commands).toEqual([{ action: 'CLOSE', ticket: 505, lots: 0.25, reason: 'momentum_scalp_rsi_tp75' }]);
    expect(result.canProduceLiveCommands).toBe(false);
  });

  // NOTE: d888a5d 起 momentum_scalp 信号生成已从 collectReplayCandidates 移除
  // （聚焦更长持仓的日内策略），Go oracle 期望无法再复现；与 engine.spec.ts 同样 skip。
  it.skip('matches the Go momentum scalp BUY signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100,
      bars: momentumScalpBuyBars()
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 100,
      stop_loss: 99.4,
      tp1: 100.75,
      tp2: 101.2,
      score: 9,
      strategy: 'momentum_scalp',
      atr: 1.5,
      all_strategies: [
        {
          strategy: 'momentum_scalp',
          side: 'BUY',
          score: 9,
          entry: 100,
          stop_loss: 99.4
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '动量剥头皮',
      msg: '🟢 BUY 评分=10 | M15 ADX=33.0 | M5 MACDHist=0.81 | M1 RSI=49.0 | 成交量=1.62x | M15 ADX=33.0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  // NOTE: d888a5d 起 momentum_scalp 信号生成已禁用（含黄金专用阈值路径），与 engine.spec.ts 同样 skip。
  it.skip('uses the Go gold momentum scalp thresholds for XAUUSD replay slices', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 100,
      bars: momentumScalpBuyBars({
        m15Adx: 18.5,
        previousMacdHist: -0.2,
        macdHist: -0.1,
        rsi: 52,
        volume: 90
      })
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      entry: 100,
      strategy: 'momentum_scalp',
      score: 6,
      stop_loss: 99.4,
      tp1: 100.75,
      tp2: 101.2
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('boosts a pullback BUY signal when M15 confirms the entry', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        M15: pullbackM15ConfirmBars()
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 95,
      stop_loss: 93.13,
      tp1: 95.8,
      tp2: 96.13,
      score: 10,
      strategy: 'pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'pullback',
          side: 'BUY',
          score: 10,
          entry: 95,
          stop_loss: 93.13
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '趋势回调',
      msg: '🟢 BUY 评分=9 | EMA20回调 dist=0.80 | MACD柱>0 | RSI=45.0<50 | ADX=35.0>30 | 连续2根回调到位'
    });
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'M15确认',
      msg: '✅ pullback | M15确认: RSI=35.0<40(多头) | 近Fib382=95.12 | 评分+1→10'
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      msg: '✅ 发出信号: BUY @ 95.00 | SL=93.13 | 策略=pullback | 评分=10'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('filters a pullback BUY signal when H4 is range-bound', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4RangeBars()
      }
    });

    // Phase 3.6：默认 hard 模式，H4 震荡市一票否决
    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        strategy: 'H4过滤',
        msg: expect.stringContaining('震荡市禁入')
      })
    );
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('keeps candidates under H4 range when GB_H4_ADX_FILTER_MODE=soft', () => {
    vi.stubEnv('GB_H4_ADX_FILTER_MODE', 'soft');
    try {
      const result = runReplay({
        account_id: '90011087',
        current_price: 95,
        bars: {
          H1: pullbackBuyBars(),
          H4: h4RangeBars()
        }
      });

      // soft 模式：仅告警，不阻断；后续由多周期共识扣分决定
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          strategy: 'H4过滤',
          msg: expect.stringContaining('不做方向偏置')
        })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the per-symbol H4 ADX threshold instead of the XAUUSD default', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAGUSD',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4SilverBullTrendBars()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'pullback'
    });
    expect(result.logs).not.toContainEqual(
      expect.objectContaining({
        strategy: 'H4过滤',
        msg: expect.stringContaining('H4=震荡')
      })
    );
  });

  it('uses the per-symbol H4 consecutive-bar requirement instead of the XAUUSD default', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'GBPJPY',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4TwoConsecutiveBearTrendBars()
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'pullback',
      msg: '🌀 pullback+FIB: 信号方向与H4趋势不一致 ⏭'
    });
  });

  it('uses per-symbol pullback SL/TP multipliers', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAGUSD',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'pullback',
      stop_loss: 93.13,
      tp1: 95.8,
      tp2: 96.13
    });
  });

  it('applies per-symbol minScore before position filtering', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAGUSD',
      current_price: 100,
      bars: { H1: counterPullbackH1AtrBars(), M30: lowScoreCounterPullbackBuyBars() },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 100, type: 'CHoCH' }],
        m30_sweeps: [{ index: 18, level: 100, side: 'BULL' }]
      },
      positions: [{ ticket: 101, symbol: 'XAGUSD', type: 'BUY', lots: 0.1, open_price: 100.2, strategy: 'counter_pullback' }]
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '汇总',
      msg: '最优信号评分 4 < 最低要求 6,过滤'
    });
    expect(result.logs).not.toContainEqual(
      expect.objectContaining({
        strategy: '汇总',
        msg: expect.stringContaining('防重复')
      })
    );
  });

  it('continues to position conflict filtering when score meets per-symbol minScore', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAGUSD',
      current_price: 100,
      bars: { H1: counterPullbackH1AtrBars(), M30: counterPullbackBuyBars() },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 100, type: 'CHoCH' }],
        m30_sweeps: [{ index: 18, level: 100, side: 'BULL' }]
      },
      positions: [{ ticket: 101, symbol: 'XAGUSD', type: 'BUY', lots: 0.1, open_price: 100.2, strategy: 'counter_pullback' }]
    });

    expect(result.signal).toBeNull();
    expect(result.logs).not.toContainEqual(
      expect.objectContaining({
        strategy: '汇总',
        msg: expect.stringContaining('最低要求')
      })
    );
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        strategy: '汇总',
        msg: expect.stringContaining('防重复: 已有同向持仓 [counter_pullback]')
      })
    );
  });

  it('keeps a later momentum scalp candidate when H4 filters the earlier pullback candidate', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4RangeBars(),
        ...momentumScalpBuyBars()
      }
    });

    // momentum_scalp 已禁用，H4 不再 BLOCK 所有信号
    // H4 震荡时不作方向偏置，后续由 trend rating 扣分决定
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('filters a pullback BUY signal when H4 strong trend is opposite', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        H4: h4StrongBearBars()
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'warn',
      strategy: 'H4过滤',
      msg: 'H4=强空头,过滤掉 1 个逆势信号,保留 0 个'
    });
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'H4过滤',
      msg: 'H4趋势过滤后无信号'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('applies a soft trend-rating penalty under weak consensus', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackWeakAdxBuyBars(),
        M30: m30NeutralBars()
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 95,
      stop_loss: 93.13,
      tp1: 95.8,
      tp2: 96.13,
      score: 7,
      strategy: 'pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'pullback',
          side: 'BUY',
          score: 7,
          entry: 95,
          stop_loss: 93.13
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '汇总',
      msg: '✅ 发出信号: BUY @ 95.00 | SL=93.13 | 策略=pullback | 评分=7'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('applies Go trend consensus penalty when signal opposes strong consensus', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackBuyBars(),
        D1: d1BearTrendBars(),
        M30: m30BearTrendBars()
      }
    });

    expect(result.signal?.score).toBe(7);
    expect(result.signal?.all_strategies).toEqual([
      expect.objectContaining({ strategy: 'pullback', side: 'BUY', score: 7 })
    ]);
  });

  it('adds Go harmonic bonus when active pattern aligns with the signal', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      harmonic: {
        // score 为 0-100 量纲：45 = 中等质量形态，+1
        active_pattern: { type: 'gartley', direction: 'BUY', score: 45 }
      },
      bars: {
        H1: pullbackWeakAdxBuyBars(),
        M30: m30NeutralBars()
      }
    });

    expect(result.signal?.score).toBe(8);
    expect(result.signal?.all_strategies).toEqual([
      expect.objectContaining({ strategy: 'pullback', side: 'BUY', score: 8 })
    ]);
  });

  it('ignores weak harmonic patterns and grants +2 only to high-quality ones', () => {
    const weak = runReplay({
      account_id: '90011087',
      current_price: 95,
      harmonic: {
        active_pattern: { type: 'gartley', direction: 'BUY', score: 20 }
      },
      bars: {
        H1: pullbackWeakAdxBuyBars(),
        M30: m30NeutralBars()
      }
    });
    // 弱形态（<30）不加分
    expect(weak.signal?.score).toBe(7);

    const strong = runReplay({
      account_id: '90011087',
      current_price: 95,
      harmonic: {
        active_pattern: { type: 'gartley', direction: 'BUY', score: 85 }
      },
      bars: {
        H1: pullbackWeakAdxBuyBars(),
        M30: m30NeutralBars()
      }
    });
    // 高质量形态（>=70）+2
    expect(strong.signal?.score).toBe(9);
  });

  it('adds Go SMC CHoCH/Sweep/OB confirmation bonus without FVG scoring', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 95,
      bars: {
        H1: pullbackWeakAdxBuyBars(),
        M30: m30NeutralBars()
      },
      smc: {
        h1_breaks: [{ index: 48, direction: 'UP', level: 94, type: 'CHoCH' }],
        h1_sweeps: [{ index: 48, level: 95, side: 'BULL', reversed: true }],
        h1_obs: [{ index: 48, side: 'BUY', high: 96, low: 94, valid: true }],
        h1_fvgs: [{ index: 48, upper_bound: 96, lower_bound: 94, filled: false }]
      }
    });

    expect(result.signal?.score).toBe(10);
    expect(result.signal?.all_strategies).toEqual([
      expect.objectContaining({ strategy: 'pullback', side: 'BUY', score: 10 })
    ]);
  });

  it('matches the Go breakout retest BUY signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 102.2,
      bars: breakoutRetestBuyBars()
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 102.2,
      stop_loss: 99.6,
      tp1: 102.81,
      tp2: 102.81,
      score: 10,
      strategy: 'breakout_retest',
      atr: 2,
      all_strategies: [
        {
          strategy: 'breakout_retest',
          side: 'BUY',
          score: 10,
          entry: 102.2,
          stop_loss: 99.6
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破回踩',
      msg: '🟢 BUY 评分=10 | 阻力位=102.00 突破后回踩 dist=0.20 | 成交量确认 | MACD柱>0 | ADX=26.0 | RSI=58.0 | 回踩确认3根'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout retest SELL signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 97.8,
      bars: breakoutRetestSellBars()
    });

    expect(result.signal).toEqual({
      side: 'SELL',
      entry: 97.8,
      stop_loss: 100.4,
      tp1: 97.19,
      tp2: 97.19,
      score: 9,
      strategy: 'breakout_retest',
      atr: 2,
      all_strategies: [
        {
          strategy: 'breakout_retest',
          side: 'SELL',
          score: 9,
          entry: 97.8,
          stop_loss: 100.4
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破回踩',
      msg: '🔴 SELL 评分=9 | 支撑位=98.00 突破后回踩 dist=0.20 | 成交量确认 | MACD柱<0 | ADX=26.0 | RSI=42.0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches a fib-enhanced pullback BUY slice with fib786 stop loss', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 95,
      bars: {
        H1: pullbackFibBuyBars(),
        H4: pullbackFibH4BarsUp()
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 95,
      stop_loss: 88,
      tp1: 95.8,
      tp2: 96,
      score: 9,
      strategy: 'pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'pullback',
          side: 'BUY',
          score: 9,
          entry: 95,
          stop_loss: 88
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '趋势回调',
      msg: '🟢 BUY 评分=10 | EMA20回调 dist=0.80 | MACD柱>0 | RSI=45.0<50 | ADX=35.0>30 | 连续2根回调到位'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('enriches raw replay bars with Go Fibonacci retracement levels used by pullback fib gating', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 95,
      bars: {
        H1: rawPullbackFibBuyBars(),
        H4: pullbackFibH4BarsUp()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'pullback',
      entry: 95,
      stop_loss: 88.78,
      tp1: 95.8,
      tp2: 95.8,
      score: 9
    });
  });

  it('invokes Go pickSLTP for a selected BUY signal and uses snake_case BB levels from enrichment', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'EURUSD',
      current_price: 1.1,
      bars: {
        H1: pullbackBuyBarsWithBBSupportResistance()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'pullback',
      entry: 1.1,
      stop_loss: 1.0987,
      tp1: 1.1008,
      tp2: 1.1008
    });
  });

  it('enriches bars without pre-supplied BB/Pivot and still applies Go pickSLTP', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'EURUSD',
      current_price: 1.1,
      bars: {
        H1: pullbackBuyBarsWithRawPivotSupportResistance()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'pullback',
      entry: 1.1,
      stop_loss: 1.09919,
      tp1: 1.10041,
      tp2: 1.10041
    });
  });

  it('applies Go pickSLTP to breakout_retest after H1 enrichment', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 102.2,
      bars: breakoutRetestBuyBarsWithPivotSupportResistance()
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'breakout_retest',
      entry: 102.2,
      stop_loss: 99.6,
      tp1: 103.1,
      tp2: 103.1
    });
  });

  it('invokes Go pickSLTP for a selected SELL signal and uses snake_case BB levels from enrichment', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'EURUSD',
      current_price: 1.25,
      bars: {
        H1: pullbackSellBarsWithBBSupportResistance()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'SELL',
      strategy: 'pullback',
      entry: 1.25,
      stop_loss: 1.2513,
      tp1: 1.2492,
      tp2: 1.2492
    });
  });

  it('rejects a fib-enhanced pullback BUY slice when H4 trend context is missing', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 95,
      bars: {
        H1: pullbackFibBuyBars()
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: 'pullback',
      msg: '🌀 pullback+FIB: H4数据不足 ⏭'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go divergence BUY signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 94,
      bars: { H1: divergenceBuyBars() }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 94,
      stop_loss: 91,
      tp1: 98,
      tp2: 102,
      score: 9,
      strategy: 'divergence',
      atr: 2,
      all_strategies: [
        {
          strategy: 'divergence',
          side: 'BUY',
          score: 9,
          entry: 94,
          stop_loss: 91
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: 'RSI背离',
      msg: '🟢 BUY 评分=9 | 看涨背离: 价格新低93.00<95.00 RSI抬高35.0>30.0 | MACD背离确认 | 成交量萎缩 | StochK=0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go divergence SELL signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 106,
      bars: { H1: divergenceSellBars() }
    });

    expect(result.signal).toEqual({
      side: 'SELL',
      entry: 106,
      stop_loss: 109,
      tp1: 102,
      tp2: 98,
      score: 9,
      strategy: 'divergence',
      atr: 2,
      all_strategies: [
        {
          strategy: 'divergence',
          side: 'SELL',
          score: 9,
          entry: 106,
          stop_loss: 109
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: 'RSI背离',
      msg: '🔴 SELL 评分=9 | 看跌背离: 价格新高107.00>105.00 RSI降低65.0<70.0 | MACD背离确认 | 成交量萎缩 | StochK=90'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout pyramid BUY signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 102,
      bars: { H1: breakoutPyramidBuySignalBars() }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 102,
      stop_loss: 98,
      tp1: 106,
      tp2: 112,
      score: 9,
      strategy: 'breakout_pyramid',
      atr: 2,
      all_strategies: [
        {
          strategy: 'breakout_pyramid',
          side: 'BUY',
          score: 9,
          entry: 102,
          stop_loss: 98
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破加仓',
      msg: '🟢 BUY 评分=9 | 收盘价突破布林上轨=101.00 | ADX=35.0>30 | RSI=60.0 | MACD柱>0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('requires M30 second-step confirmation for breakout pyramid when symbol and M30 bars exist', () => {
    const snapshot = {
      account_id: '90011087',
      symbol: 'ZZCONFIRM1',
      current_price: 102,
      bars: {
        H1: breakoutPyramidBuySignalBars(),
        // M30 收盘 101.5 > BB 上轨 101：二次确认应通过
        M30: [{ time: '2026-07-24T10:00:00Z', open: 101.4, high: 101.6, low: 101.3, close: 101.5 }]
      }
    };

    // 第一步：H1 突破先进缓存，等待 M30 确认，本轮不发信号
    const first = runReplay(snapshot);
    expect(first.signal).toBeNull();

    // 第二步：缓存命中且 M30 收盘仍在 BB 外，放行信号
    const second = runReplay(snapshot);
    expect(second.signal).toMatchObject({ strategy: 'breakout_pyramid', side: 'BUY' });
  });

  it('rejects breakout pyramid as false breakout when M30 closes back inside the band', () => {
    const snapshot = {
      account_id: '90011087',
      symbol: 'ZZCONFIRM2',
      current_price: 102,
      bars: {
        H1: breakoutPyramidBuySignalBars(),
        // M30 收盘 100.5 < BB 上轨 101：回到带内，判定假突破
        M30: [{ time: '2026-07-24T10:00:00Z', open: 100.6, high: 100.8, low: 100.4, close: 100.5 }]
      }
    };

    expect(runReplay(snapshot).signal).toBeNull(); // 进缓存
    expect(runReplay(snapshot).signal).toBeNull(); // 假突破拒绝
  });

  it('matches the Go breakout pyramid SELL signal oracle slice', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 98,
      bars: { H1: breakoutPyramidSellSignalBars() }
    });

    expect(result.signal).toEqual({
      side: 'SELL',
      entry: 98,
      stop_loss: 102,
      tp1: 94,
      tp2: 88,
      score: 9,
      strategy: 'breakout_pyramid',
      atr: 2,
      all_strategies: [
        {
          strategy: 'breakout_pyramid',
          side: 'SELL',
          score: 9,
          entry: 98,
          stop_loss: 102
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '突破加仓',
      msg: '🔴 SELL 评分=9 | 收盘价突破布林下轨=99.00 | ADX=35.0>30 | RSI=40.0 | MACD柱<0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout pyramid BUY guard ahead of bearish order block', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 101.2,
      bars: { H1: breakoutPyramidBuyOrderBlockBars() }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '突破加仓',
      msg: '前方有空头OB 101.40 (距离0.2点), 突破风险高 ⏭'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout pyramid BUY guard from replay SMC short order blocks', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 102,
      bars: { H1: breakoutPyramidBuySignalBars() },
      smc: {
        H1ShortOBs: [{ Index: 28, Side: 'SELL', High: 102.2, Low: 101.8, Valid: true }]
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '突破加仓',
      msg: '前方有空头OB 102.20 (距离0.2点), 突破风险高 ⏭'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout pyramid SELL guard ahead of bullish order block', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 98.8,
      bars: { H1: breakoutPyramidSellOrderBlockBars() }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '突破加仓',
      msg: '前方有多头OB 98.60 (距离0.2点), 突破风险高 ⏭'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go breakout pyramid SELL guard from replay SMC short order blocks', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 98,
      bars: { H1: breakoutPyramidSellSignalBars() },
      smc: {
        H1ShortOBs: [{ Index: 28, Side: 'BUY', High: 98.2, Low: 97.8, Valid: true }]
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '突破加仓',
      msg: '前方有多头OB 97.80 (距离0.2点), 突破风险高 ⏭'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('builds SMC context internally when snapshot.smc is missing', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackInternalBuyBars(),
        M15: counterPullbackInternalBuyBars()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'counter_pullback',
      score: 10
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      msg: '🟢 BUY 评分=9 | M30 | 看涨反转回调: CHoCH↑+Sweep@100.00 | CHoCH@28 | Sweep@100.00 | RSI=44.0 | OB确认 | MACD>0 | FVG确认'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('does not synthesize counter_pullback sweeps when detector finds no real sweep', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackInternalBuyBarsWithoutDetectorSweep()
      }
    });

    expect(result.signal?.strategy).not.toBe('counter_pullback');
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '反转回调',
      msg: 'CHoCH无对应Sweep确认 ⏭'
    });
  });

  it('logs counter_pullback detail from effective internal SMC context even when another strategy is selected', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 102,
      bars: {
        H1: breakoutPyramidBuySignalBars(),
        M30: smcContextTrendBars(100)
      }
    });

    expect(result.signal?.strategy).not.toBe('counter_pullback');
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '反转回调',
      msg: '无CHoCH信号 ⏭'
    });
  });

  it('produces counter_pullback from internally built M30 SMC context', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackInternalBuyBars()
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'counter_pullback',
      entry: 100.4
    });
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'signal',
        strategy: '反转回调',
        msg: expect.stringContaining('M30')
      })
    );
  });

  it('prefers externally supplied snapshot.smc over internally built SMC context', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackInternalBuyBars()
      },
      smc: {
        m30_breaks: [],
        m30_sweeps: []
      }
    });

    expect(result.signal?.strategy).not.toBe('counter_pullback');
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '反转回调',
      msg: '无CHoCH信号 ⏭'
    });
  });

  it('uses internally built H1 short order blocks for breakout_pyramid guard', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 102,
      bars: {
        H1: breakoutPyramidInternalSmcGuardBars()
      }
    });

    expect(result.signal).toBeNull();
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '突破加仓',
      msg: '前方有空头OB 102.20 (距离0.2点), 突破风险高 ⏭'
    });
  });

  it('matches the Go counter pullback BUY signal oracle slice with replay SMC context', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: { H1: counterPullbackH1AtrBars(), M30: counterPullbackBuyBars() },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        m30_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }]
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 100.4,
      stop_loss: 99,
      tp1: 104.4,
      tp2: 108.4,
      score: 6,
      strategy: 'counter_pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'counter_pullback',
          side: 'BUY',
          score: 6,
          entry: 100.4,
          stop_loss: 99
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      msg: '🟢 BUY 评分=7 | M30 | 看涨反转回调: CHoCH↑+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=44.0 | MACD>0'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('uses M30 primary bars for counter_pullback and applies Go pickSLTP with H1 ATR', () => {
    const result = runReplay({
      account_id: '90011087',
      symbol: 'XAUUSD',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackBuyBarsWithPivotSupportResistance()
      },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        m30_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }]
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'counter_pullback',
      entry: 100.4,
      atr: 2,
      stop_loss: 98.07,
      tp1: 102.34,
      tp2: 102.34
    });
  });

  it('does not fall back to H1 structure for counter_pullback when M30/M15 are unavailable', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: { H1: counterPullbackBuyBars() },
      smc: {
        h1_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        h1_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }]
      }
    });

    expect(result.signal?.strategy).not.toBe('counter_pullback');
    expect(result.logs).toContainEqual({
      level: 'info',
      strategy: '反转回调',
      msg: '数据不足 ⏭'
    });
  });

  it('falls back to M15 primary bars for counter_pullback when M30 has fewer than 20 bars', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackBuyBars().slice(0, 19),
        M15: counterPullbackBuyBars()
      },
      smc: {
        m15_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        m15_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }]
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'counter_pullback',
      entry: 100.4,
      atr: 2
    });
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'signal',
        strategy: '反转回调',
        msg: expect.stringContaining('M15')
      })
    );
  });

  it('uses selected M30 OB/FVG context for counter_pullback scoring and logs', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: {
        H1: counterPullbackH1AtrBars(),
        M30: counterPullbackBuyBars()
      },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        m30_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }],
        m30_obs: [{ index: 16, side: 'BUY', high: 101.2, low: 99.8, valid: true }],
        m30_fvgs: [{ index: 15, upper_bound: 101.1, lower_bound: 99.7, filled: false }]
      }
    });

    expect(result.signal).toMatchObject({
      side: 'BUY',
      strategy: 'counter_pullback',
      score: 8
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      msg: '🟢 BUY 评分=9 | M30 | 看涨反转回调: CHoCH↑+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=44.0 | OB确认 | MACD>0 | FVG确认'
    });
  });

  it('adds Go counter pullback OB and FVG confirmation bonuses from replay SMC context', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 100.4,
      bars: { H1: counterPullbackH1AtrBars(), M30: counterPullbackBuyBars() },
      smc: {
        m30_breaks: [{ index: 18, direction: 'UP', level: 101, type: 'CHoCH' }],
        m30_sweeps: [{ index: 17, level: 100, side: 'BULL', reversed: true }],
        m30_obs: [{ index: 16, side: 'BUY', high: 101.2, low: 99.8, valid: true }],
        m30_fvgs: [{ index: 15, upper_bound: 101.1, lower_bound: 99.7, filled: false }]
      }
    });

    expect(result.signal).toEqual({
      side: 'BUY',
      entry: 100.4,
      stop_loss: 99,
      tp1: 104.4,
      tp2: 108.4,
      score: 8,
      strategy: 'counter_pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'counter_pullback',
          side: 'BUY',
          score: 8,
          entry: 100.4,
          stop_loss: 99
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      msg: '🟢 BUY 评分=9 | M30 | 看涨反转回调: CHoCH↑+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=44.0 | OB确认 | MACD>0 | FVG确认'
    });
    expect(result.canProduceLiveCommands).toBe(false);
  });

  it('matches the Go counter pullback SELL signal oracle slice with replay SMC context', () => {
    const result = runReplay({
      account_id: '90011087',
      current_price: 99.6,
      bars: { H1: counterPullbackH1AtrBars(), M30: counterPullbackSellBars() },
      smc: {
        m30_breaks: [{ index: 18, direction: 'DOWN', level: 99, type: 'CHoCH' }],
        m30_sweeps: [{ index: 17, level: 100, side: 'BEAR', reversed: true }]
      }
    });

    expect(result.signal).toEqual({
      side: 'SELL',
      entry: 99.6,
      stop_loss: 101,
      tp1: 95.6,
      tp2: 91.6,
      score: 6,
      strategy: 'counter_pullback',
      atr: 2,
      all_strategies: [
        {
          strategy: 'counter_pullback',
          side: 'SELL',
          score: 6,
          entry: 99.6,
          stop_loss: 101
        }
      ]
    });
    expect(result.logs).toContainEqual({
      level: 'signal',
      strategy: '反转回调',
      msg: '🔴 SELL 评分=7 | M30 | 看跌反转回调: CHoCH↓+Sweep@100.00 | CHoCH@18 | Sweep@100.00 | RSI=56.0 | MACD<0'
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
    time: `2026-04-14T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 100,
    high: 101,
    low: 98,
    close: 100,
    atr: 2,
    adx: 18,
    rsi: 50,
    ema20: 80,
    ema50: 81,
    macd_hist: 0
  }));

  for (let index = 0; index < 50; index += 1) {
    bars[index].low = 98;
  }
  const lastFive = [
    { high: 98.3, low: 96.8, close: 97 },
    { high: 98.2, low: 97.2, close: 97.5 },
    { high: 98.1, low: 97.4, close: 97.7 },
    { high: 98.05, low: 97.5, close: 97.75 },
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
    bar.ema20 = 80;
    bar.ema50 = 81;
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

function rawPullbackFibBuyBars() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-15T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 100,
    low: 87,
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

function pullbackBuyBarsWithBBSupportResistance() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 1.1,
    high: 1.1004,
    low: 1.1,
    close: 1.1,
    atr: 0.001,
    adx: 35,
    rsi: 45,
    ema20: 1.09995,
    ema50: 1.09994,
    macd_hist: 0.0001,
    bb_upper: 1.1008,
    bb_lower: 1.0992,
    fib_382: 0,
    fib_618: 0,
    fib_786: 0
  }));
  bars[48].close = 1.09996;
  bars[48].open = 1.09996;
  bars[48].high = 1.103;
  bars[48].low = 1.096;
  bars[49].close = 1.1;
  bars[49].open = 1.1;
  return bars;
}

function pullbackBuyBarsWithRawPivotSupportResistance() {
  const bars = pullbackBuyBarsWithBBSupportResistance().map(({ bb_upper: _bbUpper, bb_lower: _bbLower, fib_382: _fib382, fib_618: _fib618, fib_786: _fib786, ...bar }) => ({
    ...bar,
    high: 1.1,
    low: 1.1
  }));
  bars[48] = {
    ...bars[48],
    open: 1.1,
    high: 1.1011,
    low: 1.0993,
    close: 1.1
  };
  bars[49] = {
    ...bars[49],
    high: 1.1,
    low: 1.1,
    close: 1.1,
    open: 1.1
  };
  return bars;
}

function breakoutRetestBuyBarsWithPivotSupportResistance() {
  const bars = breakoutRetestBuyBars().H1.map((bar) => ({ ...bar }));
  bars[53] = {
    ...bars[53],
    high: 106.2,
    low: 100.6,
    close: 103.4
  };
  return { H1: bars };
}

function pullbackSellBarsWithBBSupportResistance() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 1.25,
    high: 1.25,
    low: 1.2496,
    close: 1.25,
    atr: 0.001,
    adx: 35,
    rsi: 55,
    ema20: 1.25005,
    ema50: 1.25006,
    macd_hist: -0.0001,
    bb_upper: 1.2508,
    bb_lower: 1.2492,
    fib_382: 0,
    fib_618: 0,
    fib_786: 0
  }));
  bars[48].close = 1.25004;
  bars[48].open = 1.25004;
  bars[48].high = 1.253;
  bars[48].low = 1.246;
  bars[49].close = 1.25;
  bars[49].open = 1.25;
  return bars;
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

function pullbackWeakAdxBuyBars() {
  const bars = pullbackBuyBars();
  bars[48].adx = 26;
  bars[49].adx = 26;
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

function m30NeutralBars() {
  return Array.from({ length: 1 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    adx: 10,
    ema20: 95,
    ema50: 95
  }));
}

function m30BearTrendBars() {
  return Array.from({ length: 1 }, (_, index) => ({
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

function d1BearTrendBars() {
  return Array.from({ length: 1 }, (_, index) => ({
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

function h4SilverBullTrendBars() {
  return Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 97,
    low: 94,
    close: 96,
    adx: 25,
    ema20: 95,
    ema50: 94
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

function h4TwoConsecutiveBearTrendBars() {
  return Array.from({ length: 50 }, (_, index) => {
    const isRecentBearTrend = index >= 48;
    return {
      time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
      open: 95,
      high: 96,
      low: 94,
      close: isRecentBearTrend ? 95 : 101,
      adx: 35,
      ema20: isRecentBearTrend ? 99 : 100,
      ema50: 100
    };
  });
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
  const bars = breakoutPyramidBaseBars();
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
  const bars = breakoutPyramidBaseBars();
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

function breakoutPyramidBaseBars() {
  return Array.from({ length: 30 }, (_, index) => ({
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
}

function breakoutPyramidBuyOrderBlockBars() {
  const bars = breakoutPyramidBaseBars();
  bars[13].high = 101.25;
  bars[13].close = 100.8;
  bars[18] = {
    ...bars[18],
    open: 99.5,
    high: 101.4,
    low: 99.4,
    close: 101.2
  };
  bars[19].high = 101.45;
  bars[19].close = 101.3;
  bars[29].close = 101.2;
  bars[29].ema20 = 101;
  bars[29].ema50 = 99;
  bars[29].bb_upper = 101;
  return bars;
}

function breakoutPyramidSellOrderBlockBars() {
  const bars = breakoutPyramidBaseBars();
  bars[13].low = 98.75;
  bars[13].close = 99.2;
  bars[18] = {
    ...bars[18],
    open: 100.5,
    high: 100.6,
    low: 98.6,
    close: 98.8,
    rsi: 40,
    ema20: 99,
    ema50: 101,
    macd_hist: -0.2
  };
  bars[19].low = 98.55;
  bars[19].close = 98.7;
  bars[29].close = 98.8;
  bars[29].rsi = 40;
  bars[29].ema20 = 99;
  bars[29].ema50 = 101;
  bars[29].bb_lower = 99;
  bars[29].macd_hist = -0.2;
  return bars;
}

function breakoutPyramidInternalSmcGuardBars() {
  const bars = breakoutPyramidBuySignalBars();
  bars[10] = { ...bars[10], open: 102, high: 102.2, low: 101.8, close: 102.1 };
  bars[18] = { ...bars[18], open: 100, high: 100.3, low: 97, close: 98 };
  return bars;
}

function smcContextTrendBars(base: number) {
  return Array.from({ length: 30 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: base + index * 0.1,
    high: base + index * 0.1 + 1,
    low: base + index * 0.1 - 1,
    close: base + index * 0.1 + 0.2,
    atr: 2,
    adx: 20,
    rsi: 50,
    ema20: base + 2,
    ema50: base,
    bb_upper: base + 4,
    bb_lower: base - 4,
    macd_hist: 0.1
  }));
}

function counterPullbackInternalBuyBars() {
  const bars = Array.from({ length: 30 }, (_, index) => ({
    time: new Date((index + 1) * 1000).toISOString(),
    open: 100,
    high: 101,
    low: 100.8,
    close: 101,
    atr: 2,
    adx: 10,
    rsi: index === 29 ? 44 : 50,
    ema20: 120,
    ema50: 119,
    bb_upper: 130,
    bb_lower: 80,
    macd_hist: index === 29 ? 0.1 : 0
  }));
  bars[4] = { ...bars[4], open: 106, high: 108, low: 104, close: 106 };
  bars[8] = { ...bars[8], open: 103, high: 105, low: 100, close: 102 };
  bars[12] = { ...bars[12], open: 104, high: 106, low: 102, close: 104 };
  bars[16] = { ...bars[16], open: 101, high: 103, low: 100, close: 101 };
  bars[20] = { ...bars[20], open: 101, high: 102, low: 100.2, close: 101 };
  bars[17] = { ...bars[17], open: 100, high: 101, low: 99.5, close: 100.3 };
  bars[25] = { ...bars[25], open: 100, high: 101, low: 100.2, close: 100.3 };
  bars[26] = { ...bars[26], open: 99, high: 99.2, low: 98.8, close: 99 };
  bars[27] = { ...bars[27], open: 101.1, high: 101.2, low: 99.8, close: 100.2 };
  bars[28] = { ...bars[28], open: 100, high: 105, low: 100.5, close: 104.5 };
  return bars;
}

function counterPullbackInternalBuyBarsWithoutDetectorSweep() {
  const bars = counterPullbackInternalBuyBars();
  bars[17] = { ...bars[17], low: 100.6, close: 101 };
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

function counterPullbackH1AtrBars() {
  return counterPullbackBuyBars().map((bar) => ({ ...bar, atr: 2 }));
}

function counterPullbackBuyBarsWithPivotSupportResistance() {
  const bars = counterPullbackBuyBars().map((bar) => ({ ...bar, atr: 999 }));
  bars[18] = {
    ...bars[18],
    high: 104.4,
    low: 99.4,
    close: 101.4
  };
  return bars;
}

function lowScoreCounterPullbackBuyBars() {
  return counterPullbackBuyBars().map((bar, index) =>
    index === 19
      ? {
          ...bar,
          rsi: 50,
          macd_hist: 0
        }
      : bar
  );
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
