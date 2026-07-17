import { adx, atr, bollinger, ema, fibonacci, isPriceInFibZone, macd, pivotPoints, rsi } from '../indicators/index.js';
import {
  evaluatePositionManagerCommands,
  type PositionManagerCommandAdvisory,
  type PositionManagerPosition,
  type PositionManagerState
} from '../positionmgr/manager.js';
import { getStrategyConfigBySymbol, type StrategyConfig } from '../engine/config.js';
import { pickSLTP } from './sr-sltp.js';
import { applyFibExtensionTP } from './fib-extension.js';
import { checkScaleIn } from './scale-in.js';
import { calculateSMCBonus } from './smc-scoring.js';
import { confirmBreakoutPyramid } from './breakout-cache.js';
import { buildSMCContext } from '../smc/index.js';
import type { SMCContext } from '../smc/index.js';
import { buildContext as buildHarmonicContext } from '../harmonic/index.js';
import type { HarmonicContext, HarmonicPattern } from '../harmonic/index.js';

export type ReplayRawBar = {
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema20?: number;
  ema50?: number;
  atr?: number;
  rsi?: number;
  macd_hist?: number;
  macdHist?: number;
  adx?: number;
  ADX?: number;
  bb_upper?: number;
  bb_lower?: number;
  bbUpper?: number;
  bbLower?: number;
  BBUpper?: number;
  BBLower?: number;
  stoch_k?: number;
  stochK?: number;
  StochK?: number;
  vol_sma?: number;
  volSMA?: number;
  VolSMA?: number;
  fib_382?: number;
  fib382?: number;
  Fib382?: number;
  fib_618?: number;
  fib618?: number;
  Fib618?: number;
  fib_786?: number;
  fib786?: number;
  Fib786?: number;
  pp?: number;
  r1?: number;
  r2?: number;
  s1?: number;
  s2?: number;
};

export type ReplaySnapshot = {
  account_id: string;
  symbol?: string;
  analysis_time?: string;
  current_price?: number;
  bars: Record<string, ReplayRawBar[]>;
  smc?: ReplaySmcContext;
  harmonic?: ReplayHarmonicContext;
  ai_result?: ReplayAIResult;
  positions?: unknown[];
  position_states?: unknown[];
  account?: {
    equity?: number;
    balance?: number;
  };
};

type ReplayAIResult = {
  suggested_sl?: number;
  suggested_tp?: number;
};

export type ReplayStructureBreak = {
  index: number;
  direction: 'UP' | 'DOWN';
  level: number;
  type: 'BOS' | 'CHoCH';
};

export type ReplayLiquiditySweep = {
  index: number;
  level: number;
  side: 'BULL' | 'BEAR';
  reversed?: boolean;
};

export type ReplayOrderBlock = {
  index: number;
  side: 'BUY' | 'SELL';
  high: number;
  low: number;
  valid: boolean;
};

export type ReplayFVG = {
  index: number;
  upper_bound: number;
  lower_bound: number;
  filled: boolean;
};

export type ReplaySmcContext = {
  h4_breaks?: ReplayStructureBreak[];
  h4_sweeps?: ReplayLiquiditySweep[];
  h4_obs?: ReplayOrderBlock[];
  h1_breaks: ReplayStructureBreak[];
  h1_sweeps: ReplayLiquiditySweep[];
  h1_obs?: ReplayOrderBlock[];
  h1_short_obs?: ReplayOrderBlock[];
  h1_fvgs?: ReplayFVG[];
  m30_breaks?: ReplayStructureBreak[];
  m30_sweeps?: ReplayLiquiditySweep[];
  m30_obs?: ReplayOrderBlock[];
  m30_fvgs?: ReplayFVG[];
  m15_breaks?: ReplayStructureBreak[];
  m15_sweeps?: ReplayLiquiditySweep[];
  m15_obs?: ReplayOrderBlock[];
  m15_fvgs?: ReplayFVG[];
};

export type ReplayHarmonicPattern = Pick<HarmonicPattern, 'type' | 'direction' | 'score'>;

export type ReplayHarmonicContext = {
  active_pattern?: ReplayHarmonicPattern | null;
};

type ReplayStrategyName = 'pullback' | 'breakout_retest' | 'divergence' | 'counter_pullback' | 'breakout_pyramid' | 'scale_in';
type CounterPullbackTimeframe = 'm30' | 'm15';
// NOTE: 'momentum_scalp' disabled for intraday trading focus

export type ReplaySignal = {
  side: 'BUY' | 'SELL';
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  score: number;
  strategy: ReplayStrategyName;
  atr: number;
  all_strategies: Array<{
    strategy: ReplayStrategyName;
    side: 'BUY' | 'SELL';
    score: number;
    entry: number;
    stop_loss: number;
  }>;
};

export type ReplayLog = {
  level: 'debug' | 'info' | 'warn' | 'error' | 'signal';
  strategy: string;
  msg: string;
};

export type ReplayResult = {
  signal: ReplaySignal | null;
  logs: ReplayLog[];
  position_commands: ReplayPositionCommand[] | null;
  position_states: PositionManagerState[] | null;
  canProduceLiveCommands: false;
};

type EnrichedReplayBar = ReplayRawBar & {
  ema20: number;
  ema50: number;
  atr: number;
  rsi: number;
  macd_hist: number;
  macdHist: number;
  adx: number;
  bb_upper: number;
  bb_lower: number;
  stoch_k: number;
  stochK: number;
  vol_sma?: number;
  volSMA?: number;
  fib382?: number;
  fib618?: number;
  fib786?: number;
  pp?: number;
  r1?: number;
  r2?: number;
  s1?: number;
  s2?: number;
};

export type ReplayPositionCommand = {
  action: 'CLOSE' | 'MODIFY' | 'CANCEL_PENDING';
  ticket: number;
  lots?: number;
  new_sl?: number;
  reason: string;
};

type ReplayTraditionalConfig = {
  pullback: {
    minAdx: number;
    rsiOverbought: number;
    rsiOversold: number;
    distAtr: number;
    adxBonus: number;
    slAtr: number;
    tp1Atr: number;
    tp2Atr: number;
  };
  breakoutRetest: {
    lookback: number;
    confirmWindow: number;
    distAtr: number;
    slAtr: number;
    tp1Atr: number;
    tp2Atr: number;
  };
  divergence: {
    windowRecent: number;
    windowPrev: number;
    rsiBullThresh: number;
    rsiBearThresh: number;
    slAtr: number;
    tp1Atr: number;
    tp2Atr: number;
  };
  breakoutPyramid: {
    minAdx: number;
    slAtr: number;
  };
  srMinDistATR: number;
  srMaxDistATR: number;
  srBufferATR: number;
  pullbackFibEnabled: boolean;
  minScore: number;
  h4ADXThreshold: number;
  h4RequireConsecutive: number;
};

function replayTraditionalConfig(cfg: StrategyConfig): ReplayTraditionalConfig {
  return {
    pullback: {
      minAdx: cfg.pullbackMinADX,
      rsiOverbought: cfg.pullbackRSIOverbought,
      rsiOversold: cfg.pullbackRSIOversold,
      distAtr: cfg.pullbackDistATR,
      adxBonus: cfg.pullbackADXBonus,
      slAtr: cfg.pullbackSLATR,
      tp1Atr: cfg.pullbackTP1ATR,
      tp2Atr: cfg.pullbackTP2ATR
    },
    breakoutRetest: {
      lookback: cfg.breakoutRetestLookback,
      confirmWindow: cfg.breakoutRetestConfirmWindow,
      distAtr: cfg.breakoutRetestDistATR,
      slAtr: cfg.breakoutRetestSLATR,
      tp1Atr: cfg.breakoutRetestTP1ATR,
      tp2Atr: cfg.breakoutRetestTP2ATR
    },
    divergence: {
      windowRecent: cfg.divergenceWindowRecent,
      windowPrev: cfg.divergenceWindowPrev,
      rsiBullThresh: cfg.divergenceRSIBullThresh,
      rsiBearThresh: cfg.divergenceRSIBearThresh,
      slAtr: cfg.divergenceSLATR,
      tp1Atr: cfg.divergenceTP1ATR,
      tp2Atr: cfg.divergenceTP2ATR
    },
    breakoutPyramid: {
      minAdx: cfg.breakoutPyramidMinADX,
      slAtr: cfg.breakoutPyramidSLATR
    },
    srMinDistATR: cfg.srMinDistATR,
    srMaxDistATR: cfg.srMaxDistATR,
    srBufferATR: cfg.srBufferATR,
    pullbackFibEnabled: cfg.pullbackFib.retracementEnabled,
    minScore: cfg.minScore,
    h4ADXThreshold: cfg.h4ADXThreshold,
    h4RequireConsecutive: cfg.h4RequireConsecutive
  };
}

type MomentumScalpConfig = {
  minAdx: number;
  emaPeriod1: number;
  emaPeriod2: number;
  emaPeriod3: number;
  rsiBullThresh: number;
  rsiBearThresh: number;
  rsiCrossoverBull: number;
  rsiCrossoverBear: number;
  slAtr: number;
  tp1Atr: number;
  tp2Atr: number;
  volConfirm: number;
  minScore: number;
};

const defaultMomentumScalpConfig: MomentumScalpConfig = {
  minAdx: 20,
  emaPeriod1: 5,
  emaPeriod2: 8,
  emaPeriod3: 12,
  rsiBullThresh: 45,
  rsiBearThresh: 55,
  rsiCrossoverBull: 48,
  rsiCrossoverBear: 52,
  slAtr: 0.4,
  tp1Atr: 0.5,
  tp2Atr: 0.8,
  volConfirm: 1.05,
  minScore: 7
} as const;

export function runReplay(raw: unknown): ReplayResult {
  const snapshot = normalizeReplaySnapshot(raw);
  const strategyConfig = getStrategyConfigBySymbol(baseSymbol(snapshot.symbol));
  const traditionalConfig = replayTraditionalConfig(strategyConfig);
  const enrichedD1 = enrichBars(snapshot.bars.D1 ?? []);
  const enrichedH1 = enrichBars(snapshot.bars.H1 ?? []);
  const enrichedH4 = enrichBars(snapshot.bars.H4 ?? []);
  const enrichedM30 = enrichBars(snapshot.bars.M30 ?? []);
  const enrichedM15 = enrichBars(snapshot.bars.M15 ?? []);
  const enrichedM5 = enrichBars(snapshot.bars.M5 ?? []);
  const enrichedM1 = enrichBars(snapshot.bars.M1 ?? []);
  const smcContext = snapshot.smc ?? buildReplaySmcContext(enrichedH4, enrichedH1, enrichedM30, enrichedM15);
  const harmonicContext = snapshot.harmonic ?? replayHarmonicFromCoreContext(buildHarmonicContext(enrichedH4, enrichedH1, enrichedM30));
  const currentPrice = snapshot.current_price ?? enrichedH1[enrichedH1.length - 1]?.close ?? 0;
  const momentumConfig = momentumScalpConfigForSymbol(snapshot.symbol);
  const pricePrecision = roundingPrecisionForSymbol(snapshot.symbol);
  const positions = normalizePositionManagerPositions(snapshot.positions ?? []);
  const candidates = collectReplayCandidates(
    enrichedH1,
    enrichedH4,
    enrichedM30,
    enrichedM15,
    enrichedM5,
    enrichedM1,
    currentPrice,
    smcContext,
    traditionalConfig,
    momentumConfig,
    pricePrecision,
    snapshot.symbol ?? '',
    positions,
    snapshot.ai_result
  );
  const h4FilterResult = applyH4FilterToCandidates(candidates, enrichedH4, traditionalConfig);
  const trendRatedCandidates = h4FilterResult.candidates.map((candidate) =>
    applyTrendRatingPenalty(candidate, enrichedH4, enrichedH1, enrichedM30)
  ).filter((candidate): candidate is ReplaySignal => candidate != null);
  const m15BoostedCandidates = trendRatedCandidates
    .map((candidate) => applyM15ConfirmationBoost(candidate, enrichedM15, currentPrice))
    .filter((candidate): candidate is ReplaySignal => candidate != null);
  const boostedCandidates = m15BoostedCandidates.map((candidate) =>
    applyContextScoringBonuses(candidate, harmonicContext, smcContext, currentPrice, enrichedH1.length - 1)
  );
  const boostedSignal = selectHighestScore(boostedCandidates);
  const rawSignal = selectRawCandidateFor(boostedSignal, candidates);
  const selectedSignal = boostedSignal == null ? null : withAllStrategies(boostedSignal, boostedCandidates);
  const minScoreResult = applyMinScoreFilter(selectedSignal, traditionalConfig.minScore);
  const positionFilterResult = applyPositionConflictFilter(minScoreResult.signal, positions);
  const aiStopLossResult = applyAIStopLossOverride(positionFilterResult.signal, snapshot.ai_result);
  const aiTakeProfitResult = applyAITakeProfitOverride(aiStopLossResult.signal, snapshot.ai_result);
  const positionReview = evaluateReplayPositionCommands(snapshot, enrichedH1, currentPrice);

  return {
    signal: aiTakeProfitResult.signal,
    logs: buildReplayLogs(
      snapshot,
      enrichedH1,
      enrichedH4,
      enrichedM30,
      enrichedM15,
      enrichedM5,
      enrichedM1,
      currentPrice,
      rawSignal,
      boostedSignal,
      aiTakeProfitResult.signal,
      h4FilterResult.logs,
      minScoreResult.logs,
      positionFilterResult.logs,
      [...aiStopLossResult.logs, ...aiTakeProfitResult.logs],
      momentumConfig,
      traditionalConfig,
      smcContext,
      smcContext
    ),
    position_commands: positionReview.commands.length === 0 ? null : positionReview.commands,
    position_states: positionReview.states,
    canProduceLiveCommands: false
  };
}

function collectReplayCandidates(
  h1: EnrichedReplayBar[],
  h4: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[],
  m5: EnrichedReplayBar[],
  m1: EnrichedReplayBar[],
  price: number,
  smc: ReplaySmcContext | undefined,
  traditionalConfig: ReplayTraditionalConfig,
  momentumConfig: MomentumScalpConfig,
  pricePrecision: number,
  symbol: string,
  positions: PositionManagerPosition[],
  aiResult?: ReplayAIResult
): ReplaySignal[] {
  return [
    evaluatePullbackSignal(h1, h4, price, pricePrecision, traditionalConfig),
    evaluateBreakoutRetestSignal(h1, price, pricePrecision, traditionalConfig),
    evaluateDivergenceSignal(h1, price, pricePrecision, traditionalConfig),
    evaluateCounterPullbackSignal(h1, m30, m15, price, smc, pricePrecision, traditionalConfig),
    evaluateBreakoutPyramidSignal(h1, price, smc, pricePrecision, traditionalConfig),
    // TODO: Add scale_in strategy integration
    // evaluateScaleInSignal(h1, price, positions, pricePrecision, symbol),
    // NOTE: momentum_scalp strategy disabled for intraday trading focus
    // evaluateMomentumScalpSignal(m15, m5, m1, price, momentumConfig, pricePrecision)
  ].filter((signal): signal is ReplaySignal => signal != null);
}

function applyH4FilterToCandidates(
  candidates: ReplaySignal[],
  h4: EnrichedReplayBar[],
  config: ReplayTraditionalConfig
): { candidates: ReplaySignal[]; logs: ReplayLog[] } {
  if (candidates.length === 0) {
    return { candidates, logs: [] };
  }

  const filter = h4FilterDecision(h4, config);
  // 日内交易：H4 ADX 不足时不再一票否决，降级为倾向性过滤
  if (filter.direction === 'BLOCK') {
    const logs: ReplayLog[] = [
      {
        level: 'warn',
        strategy: 'H4过滤',
        msg: `H4=震荡(ADX=${formatFixed(filter.adx, 1)}<${formatFixed(config.h4ADXThreshold, 0)}), 不做方向偏置, 后续由多周期共识扣分决定`
      }
    ];
    return { candidates, logs };
  }

  if (filter.direction === '') {
    return { candidates, logs: [] };
  }

  const kept = candidates.filter((candidate) => candidate.side === filter.direction);
  const filtered = candidates.length - kept.length;
  if (filtered === 0) {
    return { candidates, logs: [] };
  }

  const logs: ReplayLog[] = [
    {
      level: 'warn',
      strategy: 'H4过滤',
      msg: `H4=${filter.trend},过滤掉 ${filtered} 个逆势信号,保留 ${kept.length} 个`
    }
  ];
  if (kept.length === 0) {
    logs.push({
      level: 'info',
      strategy: 'H4过滤',
      msg: 'H4趋势过滤后无信号'
    });
  }
  return { candidates: kept, logs };
}

function applyMinScoreFilter(signal: ReplaySignal | null, minScore: number): { signal: ReplaySignal | null; logs: ReplayLog[] } {
  if (signal == null) {
    return { signal, logs: [] };
  }
  if (signal.score >= minScore) {
    return { signal, logs: [] };
  }
  return {
    signal: null,
    logs: [
      {
        level: 'info',
        strategy: '汇总',
        msg: `最优信号评分 ${signal.score} < 最低要求 ${minScore},过滤`
      }
    ]
  };
}

function selectHighestScore(candidates: ReplaySignal[]): ReplaySignal | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
}

function selectRawCandidateFor(signal: ReplaySignal | null, candidates: ReplaySignal[]): ReplaySignal | null {
  if (signal == null) {
    return null;
  }
  return candidates.find((candidate) => candidate.strategy === signal.strategy && candidate.side === signal.side) ?? signal;
}

function withAllStrategies(signal: ReplaySignal, candidates: ReplaySignal[]): ReplaySignal {
  return {
    ...signal,
    all_strategies: candidates.map((candidate) => ({
      strategy: candidate.strategy,
      side: candidate.side,
      score: candidate.score,
      entry: candidate.entry,
      stop_loss: candidate.stop_loss
    }))
  };
}

function normalizeReplaySnapshot(raw: unknown): ReplaySnapshot {
  const record = asRecord(raw);
  const bars = asRecord(record.bars);
  return {
    account_id: stringField(record, 'account_id'),
    symbol: optionalStringField(record, 'symbol'),
    analysis_time: optionalStringField(record, 'analysis_time'),
    current_price: optionalNumberField(record, 'current_price'),
    bars: Object.fromEntries(Object.entries(bars).map(([timeframe, value]) => [timeframe, normalizeBars(value)])),
    smc: normalizeReplaySmc(record.smc),
    harmonic: normalizeReplayHarmonic(record.harmonic ?? record.harmonic_context ?? record.harmonicContext),
    ai_result: normalizeReplayAIResult(record.ai_result ?? record.aiResult),
    positions: Array.isArray(record.positions) ? record.positions : [],
    position_states: Array.isArray(record.position_states) ? record.position_states : []
  };
}

function buildReplaySmcContext(
  h4: EnrichedReplayBar[],
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[]
): ReplaySmcContext {
  const ctx = buildSMCContext(h4, h1, m30, m15);
  return replaySmcFromCoreContext(ctx);
}

function replaySmcFromCoreContext(ctx: SMCContext): ReplaySmcContext {
  return {
    h4_breaks: ctx.h4Breaks,
    h4_sweeps: ctx.h4Sweeps,
    h4_obs: ctx.h4OBs.map(replayOrderBlockFromCore),
    h1_breaks: ctx.h1Breaks,
    h1_sweeps: ctx.h1Sweeps,
    h1_obs: ctx.h1OBs.map(replayOrderBlockFromCore),
    h1_short_obs: ctx.h1ShortOBs.map(replayOrderBlockFromCore),
    h1_fvgs: ctx.h1FVGs.map(replayFVGFromCore),
    m30_breaks: ctx.m30Breaks,
    m30_sweeps: ctx.m30Sweeps,
    m30_obs: ctx.m30OBs.map(replayOrderBlockFromCore),
    m30_fvgs: ctx.m30FVGs.map(replayFVGFromCore),
    m15_breaks: ctx.m15Breaks,
    m15_sweeps: ctx.m15Sweeps,
    m15_obs: ctx.m15OBs.map(replayOrderBlockFromCore),
    m15_fvgs: ctx.m15FVGs.map(replayFVGFromCore)
  };
}

function replayHarmonicFromCoreContext(ctx: HarmonicContext): ReplayHarmonicContext {
  return {
    active_pattern: ctx.activePattern == null ? null : {
      type: ctx.activePattern.type,
      direction: ctx.activePattern.direction,
      score: ctx.activePattern.score
    }
  };
}

function replayOrderBlockFromCore(ob: SMCContext['h1OBs'][number]): ReplayOrderBlock {
  return {
    index: ob.index,
    side: ob.side,
    high: ob.high,
    low: ob.low,
    valid: ob.valid
  };
}

function replayFVGFromCore(fvg: SMCContext['h1FVGs'][number]): ReplayFVG {
  return {
    index: fvg.startIndex,
    upper_bound: fvg.upperBound,
    lower_bound: fvg.lowerBound,
    filled: fvg.filled
  };
}

function normalizeReplayAIResult(value: unknown): ReplayAIResult | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value);
  return {
    suggested_sl: optionalNumberField(record, 'suggested_sl') ?? optionalNumberField(record, 'suggestedSL')
      ,
    suggested_tp: optionalNumberField(record, 'suggested_tp') ?? optionalNumberField(record, 'suggestedTP')
  };
}

function normalizeReplayHarmonic(value: unknown): ReplayHarmonicContext | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value);
  const active = record.active_pattern ?? record.activePattern ?? record.ActivePattern;
  if (active == null) {
    return { active_pattern: null };
  }
  const activeRecord = asRecord(active);
  const direction = optionalStringField(activeRecord, 'direction') ?? optionalStringField(activeRecord, 'Direction') ?? '';
  const type = optionalStringField(activeRecord, 'type') ?? optionalStringField(activeRecord, 'Type') ?? '';
  const score = optionalNumberField(activeRecord, 'score') ?? optionalNumberField(activeRecord, 'Score') ?? 0;
  return {
    active_pattern: { type, direction, score }
  };
}

function normalizeReplaySmc(value: unknown): ReplaySmcContext | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value);
  return {
    h4_breaks: normalizeStructureBreaks(record.h4_breaks ?? record.h4Breaks ?? record.H4Breaks),
    h4_sweeps: normalizeLiquiditySweeps(record.h4_sweeps ?? record.h4Sweeps ?? record.H4Sweeps),
    h4_obs: normalizeOrderBlocks(record.h4_obs ?? record.h4OBs ?? record.H4OBs),
    h1_breaks: normalizeStructureBreaks(record.h1_breaks ?? record.h1Breaks ?? record.H1Breaks),
    h1_sweeps: normalizeLiquiditySweeps(record.h1_sweeps ?? record.h1Sweeps ?? record.H1Sweeps),
    h1_obs: normalizeOrderBlocks(record.h1_obs ?? record.h1OBs ?? record.H1OBs),
    h1_short_obs: normalizeOrderBlocks(record.h1_short_obs ?? record.h1ShortOBs ?? record.H1ShortOBs),
    h1_fvgs: normalizeFVGs(record.h1_fvgs ?? record.h1FVGs ?? record.H1FVGs),
    m30_breaks: normalizeStructureBreaks(record.m30_breaks ?? record.m30Breaks ?? record.M30Breaks),
    m30_sweeps: normalizeLiquiditySweeps(record.m30_sweeps ?? record.m30Sweeps ?? record.M30Sweeps),
    m30_obs: normalizeOrderBlocks(record.m30_obs ?? record.m30OBs ?? record.M30OBs ?? record.m30_order_blocks ?? record.m30OrderBlocks ?? record.M30OrderBlocks),
    m30_fvgs: normalizeFVGs(record.m30_fvgs ?? record.m30FVGs ?? record.M30FVGs ?? record.m30_fair_value_gaps ?? record.m30FairValueGaps ?? record.M30FairValueGaps),
    m15_breaks: normalizeStructureBreaks(record.m15_breaks ?? record.m15Breaks ?? record.M15Breaks),
    m15_sweeps: normalizeLiquiditySweeps(record.m15_sweeps ?? record.m15Sweeps ?? record.M15Sweeps),
    m15_obs: normalizeOrderBlocks(record.m15_obs ?? record.m15OBs ?? record.M15OBs ?? record.m15_order_blocks ?? record.m15OrderBlocks ?? record.M15OrderBlocks),
    m15_fvgs: normalizeFVGs(record.m15_fvgs ?? record.m15FVGs ?? record.M15FVGs ?? record.m15_fair_value_gaps ?? record.m15FairValueGaps ?? record.M15FairValueGaps)
  };
}

function normalizeStructureBreaks(value: unknown): ReplayStructureBreak[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const direction = optionalStringField(record, 'direction') ?? optionalStringField(record, 'Direction');
    const type = optionalStringField(record, 'type') ?? optionalStringField(record, 'Type');
    if ((direction !== 'UP' && direction !== 'DOWN') || (type !== 'BOS' && type !== 'CHoCH')) {
      return [];
    }
    return [
      {
        index: numberField(record, 'index') || numberField(record, 'Index'),
        direction,
        level: optionalNumberField(record, 'level') ?? optionalNumberField(record, 'Level') ?? 0,
        type
      }
    ];
  });
}

function normalizeLiquiditySweeps(value: unknown): ReplayLiquiditySweep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const side = optionalStringField(record, 'side') ?? optionalStringField(record, 'Side');
    if (side !== 'BULL' && side !== 'BEAR') {
      return [];
    }
    return [
      {
        index: numberField(record, 'index') || numberField(record, 'Index'),
        level: optionalNumberField(record, 'level') ?? optionalNumberField(record, 'Level') ?? 0,
        side,
        reversed: optionalBooleanField(record, 'reversed') ?? optionalBooleanField(record, 'Reversed')
      }
    ];
  });
}

function normalizeOrderBlocks(value: unknown): ReplayOrderBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const side = optionalStringField(record, 'side') ?? optionalStringField(record, 'Side');
    if (side !== 'BUY' && side !== 'SELL') {
      return [];
    }
    return [
      {
        index: numberField(record, 'index') || numberField(record, 'Index'),
        side,
        high: optionalNumberField(record, 'high') ?? optionalNumberField(record, 'High') ?? 0,
        low: optionalNumberField(record, 'low') ?? optionalNumberField(record, 'Low') ?? 0,
        valid: optionalBooleanField(record, 'valid') ?? optionalBooleanField(record, 'Valid') ?? false
      }
    ];
  });
}

function normalizeFVGs(value: unknown): ReplayFVG[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      index: numberField(record, 'index') || numberField(record, 'Index') || numberField(record, 'start_index') || numberField(record, 'StartIndex'),
      upper_bound: optionalNumberField(record, 'upper_bound') ?? optionalNumberField(record, 'upperBound') ?? optionalNumberField(record, 'UpperBound') ?? 0,
      lower_bound: optionalNumberField(record, 'lower_bound') ?? optionalNumberField(record, 'lowerBound') ?? optionalNumberField(record, 'LowerBound') ?? 0,
      filled: optionalBooleanField(record, 'filled') ?? optionalBooleanField(record, 'Filled') ?? false
    };
  });
}

function normalizeBars(value: unknown): ReplayRawBar[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      time: optionalStringField(record, 'time'),
      open: numberField(record, 'open'),
      high: numberField(record, 'high'),
      low: numberField(record, 'low'),
      close: numberField(record, 'close'),
      volume: optionalNumberField(record, 'volume'),
      ema20: optionalNumberField(record, 'ema20'),
      ema50: optionalNumberField(record, 'ema50'),
      atr: optionalNumberField(record, 'atr'),
      rsi: optionalNumberField(record, 'rsi'),
      macd_hist: optionalNumberField(record, 'macd_hist'),
      macdHist: optionalNumberField(record, 'macdHist'),
      adx: optionalNumberField(record, 'adx'),
      ADX: optionalNumberField(record, 'ADX'),
      bb_upper: optionalNumberField(record, 'bb_upper'),
      bb_lower: optionalNumberField(record, 'bb_lower'),
      bbUpper: optionalNumberField(record, 'bbUpper'),
      bbLower: optionalNumberField(record, 'bbLower'),
      BBUpper: optionalNumberField(record, 'BBUpper'),
      BBLower: optionalNumberField(record, 'BBLower'),
      stoch_k: optionalNumberField(record, 'stoch_k'),
      stochK: optionalNumberField(record, 'stochK'),
      StochK: optionalNumberField(record, 'StochK'),
      vol_sma: optionalNumberField(record, 'vol_sma'),
      volSMA: optionalNumberField(record, 'volSMA'),
      VolSMA: optionalNumberField(record, 'VolSMA'),
      fib_382: optionalNumberField(record, 'fib_382'),
      fib382: optionalNumberField(record, 'fib382'),
      Fib382: optionalNumberField(record, 'Fib382'),
      fib_618: optionalNumberField(record, 'fib_618'),
      fib618: optionalNumberField(record, 'fib618'),
      Fib618: optionalNumberField(record, 'Fib618'),
      fib_786: optionalNumberField(record, 'fib_786'),
      fib786: optionalNumberField(record, 'fib786'),
      Fib786: optionalNumberField(record, 'Fib786'),
      pp: optionalNumberField(record, 'pp') ?? optionalNumberField(record, 'PP'),
      r1: optionalNumberField(record, 'r1') ?? optionalNumberField(record, 'R1'),
      r2: optionalNumberField(record, 'r2') ?? optionalNumberField(record, 'R2'),
      s1: optionalNumberField(record, 's1') ?? optionalNumberField(record, 'S1'),
      s2: optionalNumberField(record, 's2') ?? optionalNumberField(record, 'S2')
    };
  });
}

function enrichBars(bars: ReplayRawBar[]): EnrichedReplayBar[] {
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atr14 = atr(highs, lows, closes, 14);
  const rsi14 = rsi(closes, 14);
  const macdResult = macd(closes);
  const adx14 = adx(highs, lows, closes, 14);
  const bb20 = bollinger(closes, 20, 2);

  return bars.map((bar, index) => {
    const fibWindow = Math.min(50, bars.length);
    const start = Math.max(0, index - fibWindow);
    const windowHighs = highs.slice(start, index + 1);
    const windowLows = lows.slice(start, index + 1);
    const fib = fibonacci(windowHighs, windowLows, windowHighs.length);
    const pivot = index > 0 ? pivotPoints(bars[index - 1].high, bars[index - 1].low, bars[index - 1].close) : undefined;

    return {
      ...bar,
      ema20: bar.ema20 ?? ema20[index],
      ema50: bar.ema50 ?? ema50[index],
      atr: bar.atr ?? atr14[index],
      rsi: bar.rsi ?? rsi14[index],
      macd_hist: bar.macd_hist ?? bar.macdHist ?? macdResult.histogram[index],
      macdHist: bar.macdHist ?? bar.macd_hist ?? macdResult.histogram[index],
      adx: bar.adx ?? bar.ADX ?? adx14[index],
      bb_upper: bar.bb_upper ?? bar.bbUpper ?? bar.BBUpper ?? bb20.upper[index],
      bb_lower: bar.bb_lower ?? bar.bbLower ?? bar.BBLower ?? bb20.lower[index],
      stoch_k: bar.stoch_k ?? bar.stochK ?? bar.StochK ?? 0,
      stochK: bar.stochK ?? bar.stoch_k ?? bar.StochK ?? 0,
      vol_sma: bar.vol_sma ?? bar.volSMA ?? bar.VolSMA,
      volSMA: bar.volSMA ?? bar.vol_sma ?? bar.VolSMA,
      fib382: bar.fib382 ?? bar.fib_382 ?? bar.Fib382 ?? fib.fib382,
      fib618: bar.fib618 ?? bar.fib_618 ?? bar.Fib618 ?? fib.fib618,
      fib786: bar.fib786 ?? bar.fib_786 ?? bar.Fib786 ?? fib.fib786,
      pp: bar.pp ?? pivot?.pp,
      r1: bar.r1 ?? pivot?.r1,
      r2: bar.r2 ?? pivot?.r2,
      s1: bar.s1 ?? pivot?.s1,
      s2: bar.s2 ?? pivot?.s2
    };
  });
}

type ReplayPositionReview = {
  commands: ReplayPositionCommand[];
  states: PositionManagerState[] | null;
};

function evaluateReplayPositionCommands(snapshot: ReplaySnapshot, enrichedH1: EnrichedReplayBar[], currentPrice: number): ReplayPositionReview {
  if ((snapshot.positions?.length ?? 0) === 0) {
    return { commands: [], states: [] };
  }
  if (enrichedH1.length < 5 || currentPrice <= 0) {
    return { commands: [], states: null };
  }

  const currentAtr = enrichedH1[enrichedH1.length - 1]?.atr ?? 0;
  if (currentAtr <= 0 || Number.isNaN(currentAtr)) {
    return { commands: [], states: null };
  }

  const result = evaluatePositionManagerCommands({
    now: snapshot.analysis_time,
    currentPrice,
    currentAtr,
    avgAtr: averageAtr(enrichedH1),
    h1Bars: enrichedH1,
    m5Bars: snapshot.bars.M5 ?? [],
    m1Bars: snapshot.bars.M1 ?? [],
    positions: normalizePositionManagerPositions(snapshot.positions ?? []),
    states: normalizePositionManagerStates(snapshot.position_states ?? []),
    equity: snapshot.account?.equity ?? 0
  });

  return {
    commands: result.advisories.map(toReplayPositionCommand),
    states: result.nextStates
  };
}

function averageAtr(h1Bars: EnrichedReplayBar[]): number {
  const atrValues = h1Bars
    .slice(-20)
    .map((bar) => bar.atr)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (atrValues.length === 0) {
    return 0;
  }
  return atrValues.reduce((sum, value) => sum + value, 0) / atrValues.length;
}

function normalizePositionManagerPositions(values: unknown[]): PositionManagerPosition[] {
  return values.map((value) => {
    const record = asRecord(value);
    return {
      ticket: optionalNumberField(record, 'ticket'),
      symbol: optionalStringField(record, 'symbol'),
      type: optionalStringField(record, 'type'),
      order_class: optionalStringField(record, 'order_class') ?? optionalStringField(record, 'orderClass'),
      orderClass: optionalStringField(record, 'orderClass') ?? optionalStringField(record, 'order_class'),
      lots: optionalNumberField(record, 'lots'),
      openPrice: optionalNumberField(record, 'openPrice'),
      open_price: optionalNumberField(record, 'open_price'),
      sl: optionalNumberField(record, 'sl'),
      tp: optionalNumberField(record, 'tp'),
      profit: optionalNumberField(record, 'profit'),
      comment: optionalStringField(record, 'comment'),
      strategy: optionalStringField(record, 'strategy'),
      magic: optionalNumberField(record, 'magic')
    };
  });
}

function normalizePositionManagerStates(values: unknown[]): PositionManagerState[] {
  return values.map((value) => {
    const record = asRecord(value);
    return {
      ticket: numberField(record, 'ticket'),
      openTime: optionalStringField(record, 'openTime'),
      open_time: optionalStringField(record, 'open_time'),
      tp1Hit: optionalBooleanField(record, 'tp1Hit'),
      tp1_hit: optionalBooleanField(record, 'tp1_hit'),
      tp2Hit: optionalBooleanField(record, 'tp2Hit'),
      tp2_hit: optionalBooleanField(record, 'tp2_hit'),
      rsiTp75Triggered: optionalBooleanField(record, 'rsiTp75Triggered'),
      rsi_tp75_triggered: optionalBooleanField(record, 'rsi_tp75_triggered'),
      beMoved: optionalBooleanField(record, 'beMoved'),
      be_moved: optionalBooleanField(record, 'be_moved'),
      maxProfitAtr: optionalNumberField(record, 'maxProfitAtr'),
      max_profit_atr: optionalNumberField(record, 'max_profit_atr'),
      beTriggerAtr: optionalNumberField(record, 'beTriggerAtr'),
      be_trigger_atr: optionalNumberField(record, 'be_trigger_atr'),
      bestSl: optionalNumberField(record, 'bestSl'),
      best_sl: optionalNumberField(record, 'best_sl'),
      addOnCount: optionalNumberField(record, 'addOnCount'),
      add_on_count: optionalNumberField(record, 'add_on_count'),
      lastAddOnTime: optionalStringField(record, 'lastAddOnTime'),
      last_add_on_time: optionalStringField(record, 'last_add_on_time'),
      lastAddOnPrice: optionalNumberField(record, 'lastAddOnPrice'),
      last_add_on_price: optionalNumberField(record, 'last_add_on_price'),
      groupId: optionalStringField(record, 'groupId'),
      group_id: optionalStringField(record, 'group_id'),
      groupAvgEntry: optionalNumberField(record, 'groupAvgEntry'),
      group_avg_entry: optionalNumberField(record, 'group_avg_entry'),
      groupBestSl: optionalNumberField(record, 'groupBestSl'),
      group_best_sl: optionalNumberField(record, 'group_best_sl'),
      trailingClosed: optionalBooleanField(record, 'trailingClosed'),
      trailing_closed: optionalBooleanField(record, 'trailing_closed')
    };
  });
}

function toReplayPositionCommand(advisory: PositionManagerCommandAdvisory): ReplayPositionCommand {
  if (advisory.action === 'MODIFY') {
    return {
      action: advisory.action,
      ticket: advisory.ticket,
      new_sl: advisory.newSL,
      reason: advisory.reason
    };
  }
  if (advisory.action === 'CANCEL_PENDING') {
    return {
      action: 'CANCEL_PENDING',
      ticket: advisory.ticket,
      reason: advisory.reason
    };
  }
  // CLOSE variants
  return {
    action: 'CLOSE',
    ticket: advisory.ticket,
    lots: 'lots' in advisory ? advisory.lots : undefined,
    reason: advisory.reason
  };
}

function buildReplayLogs(
  snapshot: ReplaySnapshot,
  h1: EnrichedReplayBar[],
  h4: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[],
  m5: EnrichedReplayBar[],
  m1: EnrichedReplayBar[],
  price: number,
  rawSignal: ReplaySignal | null,
  boostedSignal: ReplaySignal | null,
  finalSignal: ReplaySignal | null,
  h4FilterLogs: ReplayLog[],
  minScoreFilterLogs: ReplayLog[],
  positionFilterLogs: ReplayLog[],
  aiOverrideLogs: ReplayLog[],
  momentumConfig: MomentumScalpConfig,
  traditionalConfig: ReplayTraditionalConfig,
  smc: ReplaySmcContext | undefined,
  counterLogSmc: ReplaySmcContext | undefined
): ReplayLog[] {
  if (price <= 0) {
    return [];
  }
  if (h1.length === 0 /* && rawSignal?.strategy !== 'momentum_scalp' */) {
    return [];
  }

  const logs: ReplayLog[] = [];
  if (h1.length > 0) {
    logs.push(
      marketLog(h1, h4, price, traditionalConfig),
      pullbackLog(h1, h4, price, traditionalConfig),
      breakoutRetestLog(h1, price, rawSignal, traditionalConfig),
      divergenceLog(h1, rawSignal, traditionalConfig),
      ...counterPullbackLogs(counterLogSmc, h1, m30, m15, price, rawSignal),
      breakoutPyramidLog(h1, price, rawSignal, smc, traditionalConfig),
      scaleInLog(snapshot.positions ?? [])
    );
  }
  logs.push(momentumScalpLog(m15, m5, m1, price, rawSignal, momentumConfig));
  logs.push(...h4FilterLogs);
  logs.push(...minScoreFilterLogs);
  logs.push(...positionFilterLogs);
  logs.push(...aiOverrideLogs);

  if (rawSignal != null && boostedSignal != null && m15.length >= 14) {
    logs.push(m15ConfirmationLog(rawSignal, boostedSignal, m15, price));
  }
  if (finalSignal != null) {
    logs.push({
      level: 'signal',
      strategy: '汇总',
      msg: `✅ 发出信号: ${finalSignal.side} @ ${formatFixed(finalSignal.entry, 2)} | SL=${formatFixed(finalSignal.stop_loss, 2)} | 策略=${finalSignal.strategy} | 评分=${finalSignal.score}`
    });
  }
  return logs;
}

function marketLog(h1: EnrichedReplayBar[], h4: EnrichedReplayBar[], price: number, config: ReplayTraditionalConfig): ReplayLog {
  const last = h1[h1.length - 1];
  const h4Adx = h4[h4.length - 1]?.adx ?? 0;
  return {
    level: 'info',
    strategy: '市场',
    msg:
      `Price=${formatFixed(price, 2)} | ATR=${formatFixed(last.atr, 2)} | RSI=${formatFixed(last.rsi, 1)} | ` +
      `ADX=${formatFixed(last.adx, 1)} | EMA趋势(H1)=${last.ema20 > last.ema50 ? '多头' : '空头'} | ` +
      `H4=${h4TrendLabel(h4, config)}(ADX=${formatFixed(h4Adx, 1)}) | MACD柱=${formatFixed(last.macd_hist, 2)}`
  };
}

function h4TrendLabel(h4: EnrichedReplayBar[], config: ReplayTraditionalConfig): string {
  if (h4.length < 20) {
    return '未知';
  }
  const last = h4[h4.length - 1];
  if (last.adx < config.h4ADXThreshold) {
    return '震荡';
  }
  const recent = h4.slice(-config.h4RequireConsecutive);
  if (recent.every((bar) => bar.ema20 > bar.ema50)) {
    return '强多头';
  }
  if (recent.every((bar) => bar.ema20 < bar.ema50)) {
    return '强空头';
  }
  return '趋势不明';
}

function h4FilterDecision(
  h4: EnrichedReplayBar[],
  config: ReplayTraditionalConfig
): { trend: string; direction: '' | 'BUY' | 'SELL' | 'BLOCK'; adx: number } {
  if (h4.length < 50) {
    return { trend: '未知', direction: '', adx: 0 };
  }

  const last = h4[h4.length - 1];
  const adxValue = last.adx;
  if (adxValue < config.h4ADXThreshold) {
    return { trend: '震荡', direction: 'BLOCK', adx: adxValue };
  }

  let direction: '' | 'BUY' | 'SELL' = '';
  let consecutive = 0;
  const barsToCheck = Math.min(config.h4RequireConsecutive, h4.length);
  for (let index = h4.length - 1; index >= h4.length - barsToCheck; index -= 1) {
    const bar = h4[index];
    if (bar.ema20 > bar.ema50 && bar.close > bar.ema20) {
      if (direction === '' || direction === 'BUY') {
        direction = 'BUY';
        consecutive += 1;
      }
    } else if (bar.ema20 < bar.ema50 && bar.close < bar.ema20) {
      if (direction === '' || direction === 'SELL') {
        direction = 'SELL';
        consecutive += 1;
      }
    } else {
      break;
    }
  }

  if (consecutive >= config.h4RequireConsecutive) {
    return { trend: direction === 'BUY' ? '强多头' : '强空头', direction, adx: adxValue };
  }
  return { trend: '趋势不明', direction: '', adx: adxValue };
}

function pullbackLog(h1: EnrichedReplayBar[], h4: EnrichedReplayBar[], price: number, config: ReplayTraditionalConfig): ReplayLog {
  const last = h1[h1.length - 1];
  const dist = Math.abs(price - last.ema20);
  const threshold = last.atr * config.pullback.distAtr;
  const nearEma = isNearEma20(h1, threshold);
  const name = '趋势回调';

  if (last.adx < config.pullback.minAdx) {
    return { level: 'info', strategy: name, msg: `ADX=${formatFixed(last.adx, 1)} < ${formatFixed(config.pullback.minAdx, 0)},趋势不明显 ⏭` };
  }
  if (last.ema20 > last.ema50 && price > last.ema50) {
    if (!nearEma && dist >= threshold) {
      return {
        level: 'info',
        strategy: name,
        msg: `多头趋势 | 价格距EMA20=${formatFixed(dist, 2)} > ${formatFixed(threshold, 2)},未回调到位 ⏭`
      };
    }
    if (last.rsi >= config.pullback.rsiOverbought) {
      return { level: 'info', strategy: name, msg: `多头趋势 | RSI=${formatFixed(last.rsi, 1)} ≥ ${formatFixed(config.pullback.rsiOverbought, 0)},超买 ⏭` };
    }
    const fibGate = evaluatePullbackFibGate('BUY', last, h4, price, 2, config.pullbackFibEnabled);
    if (fibGate.rejectLog != null) {
      return fibGate.rejectLog;
    }
    const score = Math.min(pullbackScore('BUY', last, nearEma, config) + fibGate.scoreBonus, 10);
    const details: string[] = [];
    if (last.macd_hist > 0) {
      details.push('MACD柱>0');
    }
    if (last.rsi < 50) {
      details.push(`RSI=${formatFixed(last.rsi, 1)}<50`);
    }
    if (last.adx > config.pullback.adxBonus) {
      details.push(`ADX=${formatFixed(last.adx, 1)}>${formatFixed(config.pullback.adxBonus, 0)}`);
    }
    if (nearEma) {
      details.push('连续2根回调到位');
    }
    return { level: 'signal', strategy: name, msg: `🟢 BUY 评分=${score} | EMA20回调 dist=${formatFixed(dist, 2)} | ${details.join(' | ')}` };
  }

  if (last.ema20 < last.ema50 && price < last.ema50) {
    if (!nearEma && dist >= threshold) {
      return {
        level: 'info',
        strategy: name,
        msg: `空头趋势 | 价格距EMA20=${formatFixed(dist, 2)} > ${formatFixed(threshold, 2)},未回调到位 ⏭`
      };
    }
    if (last.rsi <= config.pullback.rsiOversold) {
      return { level: 'info', strategy: name, msg: `空头趋势 | RSI=${formatFixed(last.rsi, 1)} ≤ ${formatFixed(config.pullback.rsiOversold, 0)},超卖 ⏭` };
    }
    const fibGate = evaluatePullbackFibGate('SELL', last, h4, price, 2, config.pullbackFibEnabled);
    if (fibGate.rejectLog != null) {
      return fibGate.rejectLog;
    }
    const score = Math.min(pullbackScore('SELL', last, nearEma, config) + fibGate.scoreBonus, 10);
    const details: string[] = [];
    if (last.macd_hist < 0) {
      details.push('MACD柱<0');
    }
    if (last.rsi > 50) {
      details.push(`RSI=${formatFixed(last.rsi, 1)}>50`);
    }
    if (last.adx > config.pullback.adxBonus) {
      details.push(`ADX=${formatFixed(last.adx, 1)}>${formatFixed(config.pullback.adxBonus, 0)}`);
    }
    if (nearEma) {
      details.push('连续2根回调到位');
    }
    return { level: 'signal', strategy: name, msg: `🔴 SELL 评分=${score} | EMA20回调 dist=${formatFixed(dist, 2)} | ${details.join(' | ')}` };
  }

  return {
    level: 'info',
    strategy: name,
    msg: `EMA20=${formatFixed(last.ema20, 2)} vs EMA50=${formatFixed(last.ema50, 2)} | 价格=${formatFixed(price, 2)} 不符合回调条件 ⏭`
  };
}

function evaluatePullbackFibGate(
  side: 'BUY' | 'SELL',
  last: EnrichedReplayBar,
  h4: EnrichedReplayBar[],
  price: number,
  pricePrecision: number,
  enabled: boolean
): {
  scoreBonus: number;
  stopLoss?: number;
  rejectLog?: ReplayLog;
} {
  if (!enabled) {
    return { scoreBonus: 0 };
  }
  const fib = explicitPullbackFib(last);
  if (fib == null) {
    return { scoreBonus: 0 };
  }

  if (h4.length === 0) {
    return {
      scoreBonus: 0,
      rejectLog: { level: 'info', strategy: 'pullback', msg: '🌀 pullback+FIB: H4数据不足 ⏭' }
    };
  }

  const h4Last = h4[h4.length - 1];
  const fibTrend = h4Last.ema20 < h4Last.ema50 ? 'DOWN' : 'UP';
  if ((side === 'BUY' && fibTrend !== 'UP') || (side === 'SELL' && fibTrend !== 'DOWN')) {
    return {
      scoreBonus: 0,
      rejectLog: { level: 'info', strategy: 'pullback', msg: '🌀 pullback+FIB: 信号方向与H4趋势不一致 ⏭' }
    };
  }

  if (!isPriceInFibZone(price, fib.fib382, fib.fib618, last.atr, 0.5)) {
    return {
      scoreBonus: 0,
      rejectLog: {
        level: 'info',
        strategy: 'pullback',
        msg: `🌀 pullback+FIB: 价格 ${formatFixed(price, 2)} 不在回撤区 [${formatFixed(fib.fib382, 2)}-${formatFixed(fib.fib618, 2)}] ⏭`
      }
    };
  }

  return {
    scoreBonus: 1,
    stopLoss: roundToPrecision(side === 'BUY' ? fib.fib786 - last.atr * 0.5 : fib.fib786 + last.atr * 0.5, pricePrecision)
  };
}

function explicitPullbackFib(last: EnrichedReplayBar): { fib382: number; fib618: number; fib786: number } | undefined {
  if (
    last.fib382 != null &&
    Number.isFinite(last.fib382) &&
    last.fib618 != null &&
    Number.isFinite(last.fib618) &&
    last.fib786 != null &&
    Number.isFinite(last.fib786)
  ) {
    return {
      fib382: last.fib382,
      fib618: last.fib618,
      fib786: last.fib786
    };
  }
  return undefined;
}

function breakoutRetestLog(
  h1: EnrichedReplayBar[],
  price: number,
  signal: ReplaySignal | null | undefined,
  config: ReplayTraditionalConfig
): ReplayLog {
  const name = '突破回踩';
  const lookback = config.breakoutRetest.lookback;
  if (h1.length < lookback + 5) {
    return { level: 'info', strategy: name, msg: `数据不足 ${h1.length}/${lookback + 5} ⏭` };
  }

  const recent = h1.slice(h1.length - lookback - 5, h1.length - 5);
  const last5 = h1.slice(-5);
  const resistance = Math.max(...recent.map((bar) => bar.high));
  const support = Math.min(...recent.map((bar) => bar.low));
  const brokeUp = Math.max(...last5.map((bar) => bar.high)) > resistance;
  const brokeDown = Math.min(...last5.map((bar) => bar.low)) < support;
  const threshold = h1[h1.length - 1].atr * config.breakoutRetest.distAtr;
  const distRes = Math.abs(price - resistance);
  const distSup = Math.abs(price - support);

  if (signal?.strategy === 'breakout_retest') {
    const last = h1[h1.length - 1];
    const detail = breakoutRetestDetails(signal.side, last, countBreakoutRetestTouches(h1, signal.side, resistance, support, threshold, config));
    if (signal.side === 'BUY') {
      return {
        level: 'signal',
        strategy: name,
        msg: `🟢 BUY 评分=${signal.score} | 阻力位=${formatFixed(resistance, 2)} 突破后回踩 dist=${formatFixed(distRes, 2)} | ${detail.join(' | ')}`
      };
    }
    return {
      level: 'signal',
      strategy: name,
      msg: `🔴 SELL 评分=${signal.score} | 支撑位=${formatFixed(support, 2)} 突破后回踩 dist=${formatFixed(distSup, 2)} | ${detail.join(' | ')}`
    };
  }

  let msg = `阻力=${formatFixed(resistance, 2)} 支撑=${formatFixed(support, 2)}`;
  if (brokeUp) {
    msg += ` | 上破✓ 但回踩距离=${formatFixed(distRes, 2)} > ${formatFixed(threshold, 2)}`;
  } else if (brokeDown) {
    msg += ` | 下破✓ 但回踩距离=${formatFixed(distSup, 2)} > ${formatFixed(threshold, 2)}`;
  } else {
    msg += ' | 未突破 ⏭';
  }
  return { level: 'info', strategy: name, msg };
}

function divergenceLog(h1: EnrichedReplayBar[], signal: ReplaySignal | null | undefined, config: ReplayTraditionalConfig): ReplayLog {
  const name = 'RSI背离';
  if (h1.length < 30) {
    return { level: 'info', strategy: name, msg: '数据不足 ⏭' };
  }

  const last = h1[h1.length - 1];
  const stats = divergenceStats(h1, config);
  if (stats == null) {
    return { level: 'info', strategy: name, msg: '数据不足检测背离 ⏭' };
  }
  const bullDiv = stats.recentLow < stats.previousLow && stats.recentRsiLow > stats.previousRsiLow;
  const bearDiv = stats.recentHigh > stats.previousHigh && stats.recentRsiHigh < stats.previousRsiHigh;

  if (signal?.strategy === 'divergence' && signal.side === 'BUY') {
    return {
      level: 'signal',
      strategy: name,
      msg:
        `🟢 BUY 评分=${signal.score} | 看涨背离: 价格新低${formatFixed(stats.recentLow, 2)}<${formatFixed(stats.previousLow, 2)} ` +
        `RSI抬高${formatFixed(stats.recentRsiLow, 1)}>${formatFixed(stats.previousRsiLow, 1)} | ${divergenceBuyDetails(h1, stats).join(' | ')}`
    };
  }
  if (signal?.strategy === 'divergence' && signal.side === 'SELL') {
    return {
      level: 'signal',
      strategy: name,
      msg:
        `🔴 SELL 评分=${signal.score} | 看跌背离: 价格新高${formatFixed(stats.recentHigh, 2)}>${formatFixed(stats.previousHigh, 2)} ` +
        `RSI降低${formatFixed(stats.recentRsiHigh, 1)}<${formatFixed(stats.previousRsiHigh, 1)} | ${divergenceSellDetails(h1, stats).join(' | ')}`
    };
  }

  let msg = `RSI=${formatFixed(last.rsi, 1)}`;
  if (bullDiv) {
    msg += ` | 看涨背离检测到但RSI=${formatFixed(last.rsi, 1)} ≥ ${formatFixed(config.divergence.rsiBullThresh, 0)}`;
  } else if (bearDiv) {
    msg += ` | 看跌背离检测到但RSI=${formatFixed(last.rsi, 1)} ≤ ${formatFixed(config.divergence.rsiBearThresh, 0)}`;
  } else {
    msg += ' | 无背离 ⏭';
  }
  return { level: 'info', strategy: name, msg };
}

type DivergenceStats = {
  recentLow: number;
  previousLow: number;
  recentRsiLow: number;
  previousRsiLow: number;
  recentHigh: number;
  previousHigh: number;
  recentRsiHigh: number;
  previousRsiHigh: number;
  recentMacdLow: number;
  previousMacdLow: number;
  recentMacdHigh: number;
  previousMacdHigh: number;
};

function divergenceStats(h1: EnrichedReplayBar[], config: ReplayTraditionalConfig): DivergenceStats | null {
  const needed = config.divergence.windowRecent + config.divergence.windowPrev;
  if (h1.length < needed) {
    return null;
  }
  const recent = h1.slice(-config.divergence.windowRecent);
  const previous = h1.slice(-needed, -config.divergence.windowRecent);
  return {
    recentLow: Math.min(...recent.map((bar) => bar.close)),
    previousLow: Math.min(...previous.map((bar) => bar.close)),
    recentRsiLow: Math.min(...recent.map((bar) => bar.rsi)),
    previousRsiLow: Math.min(...previous.map((bar) => bar.rsi)),
    recentHigh: Math.max(...recent.map((bar) => bar.close)),
    previousHigh: Math.max(...previous.map((bar) => bar.close)),
    recentRsiHigh: Math.max(...recent.map((bar) => bar.rsi)),
    previousRsiHigh: Math.max(...previous.map((bar) => bar.rsi)),
    recentMacdLow: Math.min(...recent.map((bar) => bar.macd_hist)),
    previousMacdLow: Math.min(...previous.map((bar) => bar.macd_hist)),
    recentMacdHigh: Math.max(...recent.map((bar) => bar.macd_hist)),
    previousMacdHigh: Math.max(...previous.map((bar) => bar.macd_hist))
  };
}

function counterPullbackLogs(
  smc: ReplaySmcContext | undefined,
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[],
  price: number,
  signal?: ReplaySignal | null
): ReplayLog[] {
  if (smc == null && signal?.strategy !== 'counter_pullback') {
    return [];
  }
  return [counterPullbackLog(smc, h1, m30, m15, price, signal)];
}

function counterPullbackLog(
  smc: ReplaySmcContext | undefined,
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[],
  price: number,
  signal?: ReplaySignal | null
): ReplayLog {
  const name = '反转回调';
  const context = selectCounterPullbackContext(m30, m15);
  if (context == null || h1.length === 0) {
    return { level: 'info', strategy: name, msg: '数据不足 ⏭' };
  }
  const { bars: signalBars, timeframe } = context;

  const recentChoch = recentCounterPullbackChoch(smc, timeframe);
  if (recentChoch == null) {
    return { level: 'info', strategy: name, msg: '无CHoCH信号 ⏭' };
  }

  const lastBarIndex = signalBars.length - 1;
  if (lastBarIndex - recentChoch.index > 10) {
    return { level: 'info', strategy: name, msg: `CHoCH在${lastBarIndex - recentChoch.index}根前,太旧 ⏭` };
  }

  const recentSweep = recentCounterPullbackSweep(smc, recentChoch, timeframe);
  if (recentSweep == null) {
    return { level: 'info', strategy: name, msg: 'CHoCH无对应Sweep确认 ⏭' };
  }

  const last = signalBars[signalBars.length - 1];
  const atrValue = h1[h1.length - 1].atr;
  const timeframeLabel = timeframe.toUpperCase();
  if (recentChoch.direction === 'UP' && recentSweep.side === 'BULL') {
    const pullbackZone = recentSweep.level + atrValue * 0.5;
    if (price > pullbackZone) {
      return {
        level: 'info',
        strategy: name,
        msg: `${timeframeLabel} | 看涨CHoCH+Sweep | 价格${formatFixed(price, 2)} > 回调区${formatFixed(pullbackZone, 2)},未到位 ⏭`
      };
    }
    const score = counterPullbackScore('BUY', last, smc, timeframe, price, atrValue);
    return {
      level: 'signal',
      strategy: name,
      msg: `🟢 BUY 评分=${score} | ${timeframeLabel} | 看涨反转回调: CHoCH↑+Sweep@${formatFixed(recentSweep.level, 2)} | ${counterPullbackDetails('BUY', recentChoch, recentSweep, last, smc, timeframe, price, atrValue).join(' | ')}`
    };
  }

  if (recentChoch.direction === 'DOWN' && recentSweep.side === 'BEAR') {
    const pullbackZone = recentSweep.level - atrValue * 0.5;
    if (price < pullbackZone) {
      return {
        level: 'info',
        strategy: name,
        msg: `${timeframeLabel} | 看跌CHoCH+Sweep | 价格${formatFixed(price, 2)} < 回调区${formatFixed(pullbackZone, 2)},未到位 ⏭`
      };
    }
    const score = counterPullbackScore('SELL', last, smc, timeframe, price, atrValue);
    return {
      level: 'signal',
      strategy: name,
      msg: `🔴 SELL 评分=${score} | ${timeframeLabel} | 看跌反转回调: CHoCH↓+Sweep@${formatFixed(recentSweep.level, 2)} | ${counterPullbackDetails('SELL', recentChoch, recentSweep, last, smc, timeframe, price, atrValue).join(' | ')}`
    };
  }

  return { level: 'info', strategy: name, msg: '无CHoCH+Sweep组合 ⏭' };
}

function breakoutPyramidLog(
  h1: EnrichedReplayBar[],
  price: number,
  signal: ReplaySignal | null | undefined,
  smc: ReplaySmcContext | undefined,
  config: ReplayTraditionalConfig
): ReplayLog {
  const name = '突破加仓';
  if (h1.length < 30) {
    return { level: 'info', strategy: name, msg: '数据不足 ⏭' };
  }
  const last = h1[h1.length - 1];
  if (last.adx < config.breakoutPyramid.minAdx) {
    return { level: 'info', strategy: name, msg: `ADX=${formatFixed(last.adx, 1)} < ${formatFixed(config.breakoutPyramid.minAdx, 0)},趋势不够强 ⏭` };
  }

  if (signal?.strategy === 'breakout_pyramid') {
    const details = breakoutPyramidDetails(signal.side, last);
    if (signal.side === 'BUY') {
      return {
        level: 'signal',
        strategy: name,
        msg: `🟢 BUY 评分=${signal.score} | 收盘价突破布林上轨=${formatFixed(last.bb_upper, 2)} | ${details.join(' | ')}`
      };
    }
    return {
      level: 'signal',
      strategy: name,
      msg: `🔴 SELL 评分=${signal.score} | 收盘价突破布林下轨=${formatFixed(last.bb_lower, 2)} | ${details.join(' | ')}`
    };
  }

  if (last.close > last.bb_upper && last.ema20 > last.ema50) {
    const blockedOb = breakoutPyramidBlockingOrderBlock(h1, 'BUY', smc);
    if (blockedOb != null) {
      return {
        level: 'info',
        strategy: name,
        msg: `前方有空头OB ${formatFixed(blockedOb.high, 2)} (距离${formatFixed(blockedOb.high - last.close, 1)}点), 突破风险高 ⏭`
      };
    }
  }

  if (last.close < last.bb_lower && last.ema20 < last.ema50) {
    const blockedOb = breakoutPyramidBlockingOrderBlock(h1, 'SELL', smc);
    if (blockedOb != null) {
      return {
        level: 'info',
        strategy: name,
        msg: `前方有多头OB ${formatFixed(blockedOb.low, 2)} (距离${formatFixed(last.close - blockedOb.low, 1)}点), 突破风险高 ⏭`
      };
    }
  }

  let msg = `BB=[${formatFixed(last.bb_lower, 2)}, ${formatFixed(last.bb_upper, 2)}] Price=${formatFixed(price, 2)}`;
  if (price > last.bb_upper) {
    msg += ' | 突破上轨但EMA20<EMA50趋势不一致';
  } else if (price < last.bb_lower) {
    msg += ' | 突破下轨但EMA20>EMA50趋势不一致';
  } else {
    msg += ' | 在通道内 ⏭';
  }
  return { level: 'info', strategy: name, msg };
}

function breakoutPyramidBlockingOrderBlock(
  h1: EnrichedReplayBar[],
  side: 'BUY' | 'SELL',
  smc?: ReplaySmcContext
): BreakoutPyramidOrderBlock | undefined {
  const last = h1[h1.length - 1];
  if (side === 'BUY') {
    return breakoutPyramidShortOrderBlocks(h1, smc, 'SELL', 'BULL').find(
      (ob) => ob.valid && ob.high > last.bb_upper && ob.high < last.bb_upper + last.atr * 2
    );
  }
  return breakoutPyramidShortOrderBlocks(h1, smc, 'BUY', 'BEAR').find(
    (ob) => ob.valid && ob.low < last.bb_lower && ob.low > last.bb_lower - last.atr * 2
  );
}

function breakoutPyramidShortOrderBlocks(
  h1: EnrichedReplayBar[],
  smc: ReplaySmcContext | undefined,
  obSide: 'BUY' | 'SELL',
  trendDirection: 'BULL' | 'BEAR'
): BreakoutPyramidOrderBlock[] {
  const smcBlocks = (smc?.h1_short_obs ?? []).filter((ob) => ob.side === obSide);
  return [...smcBlocks, ...breakoutPyramidContinuationOrderBlocks(h1, obSide, 20, trendDirection)];
}

type BreakoutPyramidOrderBlock = {
  index: number;
  side: 'BUY' | 'SELL';
  high: number;
  low: number;
  valid: boolean;
};

type BreakoutPyramidStructureBreak = {
  index: number;
  direction: 'UP' | 'DOWN';
};

function breakoutPyramidContinuationOrderBlocks(
  bars: EnrichedReplayBar[],
  side: 'BUY' | 'SELL',
  lookback: number,
  trendDirection: 'BULL' | 'BEAR'
): BreakoutPyramidOrderBlock[] {
  if (bars.length === 0) {
    return [];
  }
  const resolvedLookback = lookback <= 0 || lookback > bars.length ? bars.length : lookback;
  const start = bars.length - resolvedLookback;
  const breaks = breakoutPyramidStructureBreaks(bars, resolvedLookback, trendDirection);
  const seen = new Set<number>();
  const blocks: BreakoutPyramidOrderBlock[] = [];

  for (let index = breaks.length - 1; index >= 0; index -= 1) {
    const brk = breaks[index];
    let obIndex = -1;
    if (side === 'SELL' && brk.direction === 'UP') {
      obIndex = breakoutPyramidDirectionalCandle(bars, brk.index, start, true);
    } else if (side === 'BUY' && brk.direction === 'DOWN') {
      obIndex = breakoutPyramidDirectionalCandle(bars, brk.index, start, false);
    }
    if (obIndex < 0 || seen.has(obIndex)) {
      continue;
    }
    seen.add(obIndex);

    const block: BreakoutPyramidOrderBlock = {
      index: obIndex,
      side,
      high: bars[obIndex].high,
      low: bars[obIndex].low,
      valid: true
    };
    block.valid = breakoutPyramidOrderBlockStillValid(bars, block);
    blocks.push(block);
  }

  return blocks;
}

function breakoutPyramidStructureBreaks(
  bars: EnrichedReplayBar[],
  lookback: number,
  trendDirection: 'BULL' | 'BEAR'
): BreakoutPyramidStructureBreak[] {
  if (bars.length < 3) {
    return [];
  }
  const resolvedLookback = lookback <= 0 || lookback > bars.length ? bars.length : lookback;
  const start = bars.length - resolvedLookback;
  const { swingHighs, swingLows } = breakoutPyramidSwingPoints(bars.slice(start), 3, 3);
  for (const swing of swingHighs) {
    swing.index += start;
  }
  for (const swing of swingLows) {
    swing.index += start;
  }

  if (swingHighs.length > 0 || swingLows.length > 0) {
    const swingBreaks = breakoutPyramidBreaksFromSwings(bars, start, swingHighs, swingLows);
    if (swingHighs.length === 0 || swingLows.length === 0) {
      const seen = new Set(swingBreaks.map((event) => `${event.index}-${event.direction}`));
      for (const event of breakoutPyramidBreaksFromRecentExtremes(bars, start)) {
        const key = `${event.index}-${event.direction}`;
        if (!seen.has(key)) {
          swingBreaks.push(event);
        }
      }
    }
    return swingBreaks.filter((event) => breakoutPyramidClassifyBreak(event.direction, trendDirection) === 'BOS');
  }

  return breakoutPyramidBreaksFromRecentExtremes(bars, start).filter(
    (event) => breakoutPyramidClassifyBreak(event.direction, trendDirection) === 'BOS'
  );
}

function breakoutPyramidSwingPoints(
  bars: EnrichedReplayBar[],
  left: number,
  right: number
): {
  swingHighs: Array<{ index: number; price: number }>;
  swingLows: Array<{ index: number; price: number }>;
} {
  const resolvedLeft = Math.max(left, 1);
  const resolvedRight = Math.max(right, 1);
  const swingHighs: Array<{ index: number; price: number }> = [];
  const swingLows: Array<{ index: number; price: number }> = [];
  if (bars.length < resolvedLeft + resolvedRight + 1) {
    return { swingHighs, swingLows };
  }

  for (let index = resolvedLeft; index < bars.length - resolvedRight; index += 1) {
    let isSwingHigh = true;
    let isSwingLow = true;
    for (let other = index - resolvedLeft; other <= index + resolvedRight; other += 1) {
      if (other === index) {
        continue;
      }
      if (bars[other].high >= bars[index].high) {
        isSwingHigh = false;
      }
      if (bars[other].low <= bars[index].low) {
        isSwingLow = false;
      }
      if (!isSwingHigh && !isSwingLow) {
        break;
      }
    }
    if (isSwingHigh) {
      swingHighs.push({ index, price: bars[index].high });
    }
    if (isSwingLow) {
      swingLows.push({ index, price: bars[index].low });
    }
  }

  return { swingHighs, swingLows };
}

function breakoutPyramidBreaksFromSwings(
  bars: EnrichedReplayBar[],
  start: number,
  swingHighs: Array<{ index: number; price: number }>,
  swingLows: Array<{ index: number; price: number }>
): BreakoutPyramidStructureBreak[] {
  const events: BreakoutPyramidStructureBreak[] = [];
  let highCursor = 0;
  let lowCursor = 0;

  for (let index = start; index < bars.length; index += 1) {
    while (highCursor < swingHighs.length && swingHighs[highCursor].index < index) {
      highCursor += 1;
    }
    while (lowCursor < swingLows.length && swingLows[lowCursor].index < index) {
      lowCursor += 1;
    }

    if (highCursor > 0) {
      const level = swingHighs[highCursor - 1].price;
      if (bars[index].close > level && (index === 0 || bars[index - 1].close <= level)) {
        events.push({ index, direction: 'UP' });
      }
    }
    if (lowCursor > 0) {
      const level = swingLows[lowCursor - 1].price;
      if (bars[index].close < level && (index === 0 || bars[index - 1].close >= level)) {
        events.push({ index, direction: 'DOWN' });
      }
    }
  }

  return events;
}

function breakoutPyramidBreaksFromRecentExtremes(bars: EnrichedReplayBar[], start: number): BreakoutPyramidStructureBreak[] {
  const events: BreakoutPyramidStructureBreak[] = [];
  const windowSize = 5;

  for (let index = start + windowSize; index < bars.length; index += 1) {
    let recentHigh = 0;
    let recentLow = Number.MAX_VALUE;
    let recentHighIndex = -1;
    let recentLowIndex = -1;

    for (let lookbackIndex = index - windowSize; lookbackIndex < index; lookbackIndex += 1) {
      if (lookbackIndex < start) {
        continue;
      }
      if (bars[lookbackIndex].high > recentHigh) {
        recentHigh = bars[lookbackIndex].high;
        recentHighIndex = lookbackIndex;
      }
      if (bars[lookbackIndex].low < recentLow) {
        recentLow = bars[lookbackIndex].low;
        recentLowIndex = lookbackIndex;
      }
    }

    if (recentHighIndex >= 0 && bars[index].close > recentHigh && (index === 0 || bars[index - 1].close <= recentHigh)) {
      events.push({ index, direction: 'UP' });
    }
    if (recentLowIndex >= 0 && bars[index].close < recentLow && (index === 0 || bars[index - 1].close >= recentLow)) {
      events.push({ index, direction: 'DOWN' });
    }
  }

  return events;
}

function breakoutPyramidClassifyBreak(direction: 'UP' | 'DOWN', trendDirection: 'BULL' | 'BEAR'): 'BOS' | 'CHoCH' {
  if (trendDirection === 'BULL') {
    return direction === 'UP' ? 'BOS' : 'CHoCH';
  }
  return direction === 'DOWN' ? 'BOS' : 'CHoCH';
}

function breakoutPyramidDirectionalCandle(bars: EnrichedReplayBar[], beforeIndex: number, start: number, bullish: boolean): number {
  const resolvedBeforeIndex = Math.min(beforeIndex, bars.length);
  const resolvedStart = Math.max(start, 0);
  for (let index = resolvedBeforeIndex - 1; index >= resolvedStart; index -= 1) {
    const body = Math.abs(bars[index].close - bars[index].open);
    const range = bars[index].high - bars[index].low;
    if (range <= 0 || body <= range * 0.6) {
      continue;
    }
    if (bullish && bars[index].close > bars[index].open) {
      return index;
    }
    if (!bullish && bars[index].close < bars[index].open) {
      return index;
    }
  }
  return -1;
}

function breakoutPyramidOrderBlockStillValid(bars: EnrichedReplayBar[], ob: BreakoutPyramidOrderBlock): boolean {
  for (let index = ob.index + 1; index < bars.length; index += 1) {
    if (ob.side === 'BUY' && bars[index].close < ob.low) {
      return false;
    }
    if (ob.side === 'SELL' && bars[index].close > ob.high) {
      return false;
    }
  }
  return true;
}

function scaleInLog(positions: unknown[]): ReplayLog {
  if (positions.length === 0) {
    return { level: 'info', strategy: '浮亏加仓', msg: '➕ 无同向浮亏持仓 ⏭' };
  }
  return { level: 'info', strategy: '浮亏加仓', msg: '➕ 浮亏加仓未触发 ⏭' };
}

function momentumScalpLog(
  m15: EnrichedReplayBar[],
  m5: EnrichedReplayBar[],
  m1: EnrichedReplayBar[],
  price: number,
  signal: ReplaySignal | null,
  momentumConfig: MomentumScalpConfig
): ReplayLog {
  // NOTE: momentum_scalp strategy disabled for intraday trading focus
  if (m5.length < 12) {
    return { level: 'info', strategy: '动量剥头皮', msg: `M5数据不足: ${m5.length}/12 ⏭` };
  }
  return { level: 'info', strategy: '动量剥头皮', msg: '动量剥头皮策略已禁用 ⏭' };
  /*
  // @ts-expect-error momentum_scalp disabled
  if (signal?.strategy === 'momentum_scalp') {
    return momentumScalpSignalLog(m15, m5, m1, signal.side, momentumConfig);
  }
  ...
  */
}

function m15ConfirmationLog(rawSignal: ReplaySignal, finalSignal: ReplaySignal, m15: EnrichedReplayBar[], price: number): ReplayLog {
  const outcome = m15ConfirmationOutcome(rawSignal, m15, price);
  if (outcome.confirmed) {
    return {
      level: 'info',
      strategy: 'M15确认',
      msg: `✅ ${rawSignal.strategy} | ${outcome.detail} | 评分+1→${finalSignal.score}`
    };
  }
  return {
    level: 'info',
    strategy: 'M15确认',
    msg: `⏭ ${rawSignal.strategy} | ${outcome.detail}`
  };
}

function m15ConfirmationOutcome(signal: ReplaySignal, m15: EnrichedReplayBar[], price: number): { confirmed: boolean; detail: string } {
  const last = m15[m15.length - 1];
  let confirmed = false;
  let detail = '';
  if (signal.side === 'BUY') {
    confirmed = last.rsi > 0 && last.rsi < 40;
    detail = confirmed ? `M15确认: RSI=${formatFixed(last.rsi, 1)}<40(多头)` : `M15未确认: RSI=${formatFixed(last.rsi, 1)}≥40`;
  } else {
    confirmed = last.rsi > 0 && last.rsi > 60;
    detail = confirmed ? `M15确认: RSI=${formatFixed(last.rsi, 1)}>60(空头)` : `M15未确认: RSI=${formatFixed(last.rsi, 1)}≤60`;
  }

  const fib382 = optionalNumberField(last, 'fib382');
  const fib618 = optionalNumberField(last, 'fib618');
  if (confirmed && fib382 != null && Math.abs(price - fib382) < last.atr * 0.5) {
    detail += ` | 近Fib382=${formatFixed(fib382, 2)}`;
  } else if (confirmed && fib618 != null && Math.abs(price - fib618) < last.atr * 0.5) {
    detail += ` | 近Fib618=${formatFixed(fib618, 2)}`;
  }
  return { confirmed, detail };
}

function applyM15ConfirmationBoost(signal: ReplaySignal | null, m15: EnrichedReplayBar[], price: number): ReplaySignal | null {
  if (signal == null || m15.length < 14) {
    return signal;
  }
  const outcome = m15ConfirmationOutcome(signal, m15, price);
  if (!outcome.confirmed) {
    return signal;
  }
  const boostedScore = Math.min(signal.score + 1, 10);
  return {
    ...signal,
    score: boostedScore,
    all_strategies: signal.all_strategies.map((entry) => ({ ...entry, score: boostedScore }))
  };
}

function applyContextScoringBonuses(
  signal: ReplaySignal,
  harmonic: ReplayHarmonicContext | undefined,
  smc: ReplaySmcContext | undefined,
  price: number,
  lastH1Index: number
): ReplaySignal {
  let boostedScore = signal.score;

  const harmonicBoost = calculateHarmonicBonus(harmonic, signal.side);
  if (harmonicBoost > 0) {
    boostedScore = Math.min(boostedScore + harmonicBoost, 10);
  }

  const smcBoost = calculateSMCBonus(smc, signal.side, price, signal.atr, 'h1', lastH1Index);
  if (smcBoost > 0) {
    boostedScore = Math.min(boostedScore + smcBoost, 10);
  }

  if (boostedScore === signal.score) {
    return signal;
  }
  return {
    ...signal,
    score: boostedScore,
    all_strategies: signal.all_strategies.map((entry) => ({ ...entry, score: boostedScore }))
  };
}

function calculateHarmonicBonus(harmonic: ReplayHarmonicContext | undefined, side: 'BUY' | 'SELL'): number {
  const pattern = harmonic?.active_pattern;
  if (pattern == null || pattern.score < 5) {
    return 0;
  }
  if (harmonicDirectionToSide(pattern.direction) !== side) {
    return 0;
  }
  return pattern.score >= 8 ? 2 : 1;
}

function harmonicDirectionToSide(direction: string): 'BUY' | 'SELL' | undefined {
  const normalized = direction.toUpperCase();
  if (normalized === 'BUY' || normalized === 'BULL' || normalized === 'BULLISH') {
    return 'BUY';
  }
  if (normalized === 'SELL' || normalized === 'BEAR' || normalized === 'BEARISH') {
    return 'SELL';
  }
  return undefined;
}

function applyPositionConflictFilter(
  signal: ReplaySignal | null,
  positions: PositionManagerPosition[]
): { signal: ReplaySignal | null; logs: ReplayLog[] } {
  if (signal == null || positions.length === 0) {
    return { signal, logs: [] };
  }

  // Strategy isolation: only check positions from the same strategy
  const signalStrategy = signal.strategy || '';
  const relevantPositions = positions.filter((position) => {
    const posStrategy = position.strategy ?? '';
    // If both have strategy tags, only consider same-strategy positions
    if (signalStrategy.length > 0 && posStrategy.length > 0) {
      return posStrategy === signalStrategy;
    }
    // If either lacks strategy tag, include it (backward compatibility)
    return true;
  });

  for (const position of relevantPositions) {
    const openPrice = position.openPrice ?? position.open_price ?? 0;
    const positionSide = (position.type ?? '').toUpperCase();
    if (openPrice <= 0 || (positionSide !== 'BUY' && positionSide !== 'SELL')) {
      continue;
    }

    const dist = Math.abs(signal.entry - openPrice);
    if (positionSide === signal.side) {
      if (dist < signal.atr) {
        return {
          signal: null,
          logs: [
            {
              level: 'warn',
              strategy: '汇总',
              msg: `防重复: 已有同向持仓 [${position.strategy ?? '未知'}] @ ${formatFixed(openPrice, 2)},距离 < 1.0 ATR`
            }
          ]
        };
      }
      continue;
    }

    if (dist < signal.atr * 2) {
      return {
        signal: null,
        logs: [
          {
            level: 'warn',
            strategy: '汇总',
            msg: `防对冲: 已有反向持仓 [${position.strategy ?? '未知'}] @ ${formatFixed(openPrice, 2)},距离 < 2.0 ATR`
          }
        ]
      };
    }
  }

  return { signal, logs: [] };
}

function applyAIStopLossOverride(
  signal: ReplaySignal | null,
  aiResult: ReplayAIResult | undefined
): { signal: ReplaySignal | null; logs: ReplayLog[] } {
  if (signal == null || aiResult?.suggested_sl == null || aiResult.suggested_sl <= 0) {
    return { signal, logs: [] };
  }

  const aiSL = aiResult.suggested_sl;
  const dist = Math.abs(signal.entry - aiSL);
  const sideValid = (signal.side === 'BUY' && aiSL < signal.entry) || (signal.side === 'SELL' && aiSL > signal.entry);
  if (!sideValid || dist < signal.atr * 0.3 || dist > signal.atr * 3) {
    return { signal, logs: [] };
  }

  const originalSL = signal.stop_loss;
  return {
    signal: {
      ...signal,
      stop_loss: aiSL,
      all_strategies: signal.all_strategies.map((entry) => ({ ...entry, stop_loss: aiSL }))
    },
    logs: [
      {
        level: 'info',
        strategy: 'AI止损',
        msg: `🤖 AI止损覆盖: ${formatFixed(originalSL, 2)} → ${formatFixed(aiSL, 2)} (基于支撑阻力位)`
      }
    ]
  };
}

function applyAITakeProfitOverride(
  signal: ReplaySignal | null,
  aiResult: ReplayAIResult | undefined
): { signal: ReplaySignal | null; logs: ReplayLog[] } {
  if (signal == null || aiResult?.suggested_tp == null || aiResult.suggested_tp <= 0) {
    return { signal, logs: [] };
  }

  const aiTP = aiResult.suggested_tp;
  const dist = Math.abs(aiTP - signal.entry);
  const sideValid = (signal.side === 'BUY' && aiTP > signal.entry) || (signal.side === 'SELL' && aiTP < signal.entry);
  if (!sideValid || dist < signal.atr * 0.3 || dist > signal.atr * 5) {
    return { signal, logs: [] };
  }

  const originalTp1 = signal.tp1;
  const originalTp2 = signal.tp2;
  return {
    signal: {
      ...signal,
      tp1: aiTP,
      tp2: aiTP
    },
    logs: [
      {
        level: 'info',
        strategy: 'AI止盈',
        msg: `🤖 AI止盈覆盖: TP1=${formatFixed(originalTp1, 2)}→${formatFixed(aiTP, 2)}, TP2=${formatFixed(originalTp2, 2)}→${formatFixed(aiTP, 2)}`
      }
    ]
  };
}

function applyTrendRatingPenalty(
  signal: ReplaySignal | null,
  h4: EnrichedReplayBar[],
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[]
): ReplaySignal | null {
  if (signal == null) {
    return null;
  }
  if (h4.length === 0 && m30.length === 0) {
    return signal;
  }

  const rating = trendRating(signal, h4, h1, m30);
  if (rating.penalty === 0) {
    return signal;
  }

  const nextScore = signal.score - rating.penalty;
  return {
    ...signal,
    score: nextScore,
    all_strategies: signal.all_strategies.map((entry) => ({ ...entry, score: nextScore }))
  };
}

function trendRating(
  signal: ReplaySignal,
  h4: EnrichedReplayBar[],
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[]
): { penalty: number } {
  const consensus = trendConsensus(h4, h1, m30);
  const signalDirection = signalSideToTrendDirection(signal.side);
  if (consensus.strength >= 0.3 && consensus.direction !== 'NEUTRAL' && consensus.direction !== signalDirection) {
    return { penalty: 2 };
  }
  if (consensus.strength >= 0.3) {
    return { penalty: 0 };
  }
  if (consensus.h4Direction !== 'NEUTRAL' && consensus.h4Direction !== signalDirection) {
    return { penalty: 2 };
  }
  return { penalty: 1 };
}

function trendConsensus(
  h4: EnrichedReplayBar[],
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[]
): { direction: 'BULL' | 'BEAR' | 'NEUTRAL'; strength: number; h4Direction: 'BULL' | 'BEAR' | 'NEUTRAL' } {
  const h4Direction = timeframeDirection(h4);
  const h1Direction = timeframeDirection(h1);
  const m30Direction = timeframeDirection(m30);

  const h4Confidence = trendConfidence(h4);
  const h1Confidence = trendConfidence(h1);
  const m30Confidence = trendConfidence(m30);

  // 日内交易：去掉 D1，权重重新分配（H4 降权，M30 增权）
  const h4Weight = 0.15;
  const h1Weight = 0.35;
  const m30Weight = 0.50;

  const h4Strength = h4Weight * h4Confidence;
  const h1Strength = h1Weight * h1Confidence;
  const m30Strength = m30Weight * m30Confidence;

  const bullWeight =
    (h4Direction === 'BULL' ? h4Weight : 0) +
    (h1Direction === 'BULL' ? h1Weight : 0) +
    (m30Direction === 'BULL' ? m30Weight : 0);
  const bearWeight =
    (h4Direction === 'BEAR' ? h4Weight : 0) +
    (h1Direction === 'BEAR' ? h1Weight : 0) +
    (m30Direction === 'BEAR' ? m30Weight : 0);

  const strength = h4Strength + h1Strength + m30Strength;
  let direction: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
  if (bullWeight > bearWeight) {
    direction = 'BULL';
  } else if (bearWeight > bullWeight) {
    direction = 'BEAR';
  }

  return { direction, strength, h4Direction };
}

function timeframeDirection(bars: EnrichedReplayBar[]): 'BULL' | 'BEAR' | 'NEUTRAL' {
  if (bars.length === 0) {
    return 'NEUTRAL';
  }
  const last = bars[bars.length - 1];
  if (last.ema20 > last.ema50 && last.close > last.ema20) {
    return 'BULL';
  }
  if (last.ema20 < last.ema50 && last.close < last.ema20) {
    return 'BEAR';
  }
  return 'NEUTRAL';
}

function trendConfidence(bars: EnrichedReplayBar[]): number {
  if (bars.length === 0) {
    return 0;
  }
  const last = bars[bars.length - 1];
  const direction = timeframeDirection(bars);
  if (direction === 'NEUTRAL') {
    return 0;
  }
  if (last.adx < 20) {
    return 0.3;
  }
  if (last.adx <= 30) {
    return 0.6;
  }
  return 0.9;
}

function signalSideToTrendDirection(side: 'BUY' | 'SELL'): 'BULL' | 'BEAR' {
  return side === 'SELL' ? 'BEAR' : 'BULL';
}

function evaluatePullbackSignal(
  h1: EnrichedReplayBar[],
  h4: EnrichedReplayBar[],
  price: number,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal | null {
  if (h1.length < 50 || price <= 0) {
    return null;
  }
  const last = h1[h1.length - 1];
  const atrValue = last.atr;
  if (atrValue <= 0 || Number.isNaN(atrValue) || Number.isNaN(last.adx)) {
    return null;
  }
  if (last.adx < config.pullback.minAdx) {
    return null;
  }

  const threshold = atrValue * config.pullback.distAtr;
  const nearEma = isNearEma20(h1, threshold);

  if (last.ema20 > last.ema50 && price > last.ema50) {
    const dist = Math.abs(price - last.ema20);
    if (!nearEma && dist >= threshold) {
      return null;
    }
    if (last.rsi >= config.pullback.rsiOverbought) {
      return null;
    }
    const signal = applyPickSLTP(
      buildPullbackSignal('BUY', price, atrValue, pullbackScore('BUY', last, nearEma, config), pricePrecision, config),
      last,
      pricePrecision,
      config
    );
    const fibGate = evaluatePullbackFibGate('BUY', last, h4, price, pricePrecision, config.pullbackFibEnabled);
    if (fibGate.rejectLog != null) {
      return null;
    }
    if (fibGate.stopLoss != null) {
      signal.score = Math.min(signal.score + fibGate.scoreBonus, 10);
      signal.stop_loss = fibGate.stopLoss;
      signal.all_strategies[0].score = signal.score;
      signal.all_strategies[0].stop_loss = signal.stop_loss;
    }
    return signal;
  }

  if (last.ema20 < last.ema50 && price < last.ema50) {
    const dist = Math.abs(price - last.ema20);
    if (!nearEma && dist >= threshold) {
      return null;
    }
    if (last.rsi <= config.pullback.rsiOversold) {
      return null;
    }
    const signal = applyPickSLTP(
      buildPullbackSignal('SELL', price, atrValue, pullbackScore('SELL', last, nearEma, config), pricePrecision, config),
      last,
      pricePrecision,
      config
    );
    const fibGate = evaluatePullbackFibGate('SELL', last, h4, price, pricePrecision, config.pullbackFibEnabled);
    if (fibGate.rejectLog != null) {
      return null;
    }
    if (fibGate.stopLoss != null) {
      signal.score = Math.min(signal.score + fibGate.scoreBonus, 10);
      signal.stop_loss = fibGate.stopLoss;
      signal.all_strategies[0].score = signal.score;
      signal.all_strategies[0].stop_loss = signal.stop_loss;
    }
    return signal;
  }

  return null;
}

function evaluateBreakoutRetestSignal(h1: EnrichedReplayBar[], price: number, pricePrecision: number, config: ReplayTraditionalConfig): ReplaySignal | null {
  if (h1.length < config.breakoutRetest.lookback + 5 || price <= 0) {
    return null;
  }
  const last = h1[h1.length - 1];
  const atrValue = last.atr;
  if (atrValue <= 0 || Number.isNaN(atrValue)) {
    return null;
  }

  const { resistance, support, last5High, last5Low } = breakoutRetestLevels(h1, config);
  const threshold = atrValue * config.breakoutRetest.distAtr;
  const brokeUp = last5High > resistance;
  const brokeDown = last5Low < support;
  const touchCount = countBreakoutRetestTouches(h1, brokeUp ? 'BUY' : 'SELL', resistance, support, threshold, config);

  if (brokeUp) {
    const dist = Math.abs(price - resistance);
    if (dist < threshold && touchCount >= 1) {
      return applyPickSLTP(
        buildBreakoutRetestSignal('BUY', price, atrValue, resistance, breakoutRetestScore('BUY', last, touchCount), pricePrecision, config),
        last,
        pricePrecision,
        config
      );
    }
  }

  if (brokeDown) {
    const dist = Math.abs(price - support);
    if (dist < threshold && touchCount >= 1) {
      return applyPickSLTP(
        buildBreakoutRetestSignal('SELL', price, atrValue, support, breakoutRetestScore('SELL', last, touchCount), pricePrecision, config),
        last,
        pricePrecision,
        config
      );
    }
  }

  return null;
}

function applyPickSLTP(
  signal: ReplaySignal,
  last: EnrichedReplayBar,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal {
  const sr = pickSLTP(signal.side, signal.entry, last, signal.atr, pricePrecision, config);
  if (!sr.usedSR) {
    return signal;
  }
  return {
    ...signal,
    stop_loss: sr.sl,
    tp1: sr.tp1,
    tp2: sr.tp2,
    all_strategies: signal.all_strategies.map((entry) => ({ ...entry, stop_loss: sr.sl }))
  };
}

function breakoutRetestLevels(h1: EnrichedReplayBar[], config: ReplayTraditionalConfig): { resistance: number; support: number; last5High: number; last5Low: number } {
  const recent = h1.slice(h1.length - config.breakoutRetest.lookback - 5, h1.length - 5);
  const last5 = h1.slice(-5);
  return {
    resistance: Math.max(...recent.map((bar) => bar.high)),
    support: Math.min(...recent.map((bar) => bar.low)),
    last5High: Math.max(...last5.map((bar) => bar.high)),
    last5Low: Math.min(...last5.map((bar) => bar.low))
  };
}

function countBreakoutRetestTouches(
  h1: EnrichedReplayBar[],
  side: 'BUY' | 'SELL',
  resistance: number,
  support: number,
  threshold: number,
  config: ReplayTraditionalConfig
): number {
  let count = 0;
  for (const bar of h1.slice(-config.breakoutRetest.confirmWindow)) {
    if (side === 'BUY' && Math.abs(bar.low - resistance) < threshold) {
      count += 1;
    }
    if (side === 'SELL' && Math.abs(bar.high - support) < threshold) {
      count += 1;
    }
  }
  return count;
}

function breakoutRetestScore(side: 'BUY' | 'SELL', last: EnrichedReplayBar, touchCount: number): number {
  let score = 5;
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;
  if (volSma > 0 && volume > 1.5 * volSma) {
    score += 1;
  }
  if ((side === 'BUY' && last.macd_hist > 0) || (side === 'SELL' && last.macd_hist < 0)) {
    score += 1;
  }
  if (last.adx > 20) {
    score += 1;
  }
  if ((side === 'BUY' && last.rsi > 50) || (side === 'SELL' && last.rsi < 50)) {
    score += 1;
  }
  if (side === 'BUY' && touchCount >= 2) {
    score += 1;
  }
  return Math.min(score, 10);
}

function breakoutRetestDetails(side: 'BUY' | 'SELL', last: EnrichedReplayBar, touchCount: number): string[] {
  const details: string[] = [];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;
  if (volSma > 0 && volume > 1.5 * volSma) {
    details.push('成交量确认');
  }
  if (side === 'BUY' && last.macd_hist > 0) {
    details.push('MACD柱>0');
  }
  if (side === 'SELL' && last.macd_hist < 0) {
    details.push('MACD柱<0');
  }
  if (last.adx > 20) {
    details.push(`ADX=${formatFixed(last.adx, 1)}`);
  }
  if (side === 'BUY' && last.rsi > 50) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (side === 'SELL' && last.rsi < 50) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (side === 'BUY' && touchCount >= 2) {
    details.push(`回踩确认${touchCount}根`);
  }
  return details;
}

function evaluateDivergenceSignal(h1: EnrichedReplayBar[], price: number, pricePrecision: number, config: ReplayTraditionalConfig): ReplaySignal | null {
  if (h1.length < 30 || price <= 0) {
    return null;
  }
  const last = h1[h1.length - 1];
  const atrValue = last.atr;
  const stats = divergenceStats(h1, config);
  if (stats == null || atrValue <= 0 || Number.isNaN(atrValue)) {
    return null;
  }

  const bullDiv = stats.recentLow < stats.previousLow && stats.recentRsiLow > stats.previousRsiLow;
  if (bullDiv && last.rsi < config.divergence.rsiBullThresh) {
    return applyPickSLTP(
      buildDivergenceSignal('BUY', price, atrValue, stats.recentLow, divergenceBuyScore(h1, stats), pricePrecision, config),
      last,
      pricePrecision,
      config
    );
  }

  const bearDiv = stats.recentHigh > stats.previousHigh && stats.recentRsiHigh < stats.previousRsiHigh;
  if (bearDiv && last.rsi > config.divergence.rsiBearThresh) {
    return applyPickSLTP(
      buildDivergenceSignal('SELL', price, atrValue, stats.recentHigh, divergenceSellScore(h1, stats), pricePrecision, config),
      last,
      pricePrecision,
      config
    );
  }

  return null;
}

function divergenceBuyScore(h1: EnrichedReplayBar[], stats: DivergenceStats): number {
  let score = 6;
  const last = h1[h1.length - 1];
  const previous = h1[h1.length - 2];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;

  if (stats.recentMacdLow > stats.previousMacdLow) {
    score += 1;
  } else if (last.macd_hist > previous.macd_hist) {
    score += 1;
  }
  if (volSma > 0 && volume > 0 && volume < 0.7 * volSma) {
    score += 1;
  }
  if (last.stoch_k < 20) {
    score += 1;
  }
  return Math.min(score, 10);
}

function divergenceBuyDetails(h1: EnrichedReplayBar[], stats: DivergenceStats): string[] {
  const details: string[] = [];
  const last = h1[h1.length - 1];
  const previous = h1[h1.length - 2];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;

  if (stats.recentMacdLow > stats.previousMacdLow) {
    details.push('MACD背离确认');
  } else if (last.macd_hist > previous.macd_hist) {
    details.push('MACD改善');
  }
  if (volSma > 0 && volume > 0 && volume < 0.7 * volSma) {
    details.push('成交量萎缩');
  }
  if (last.stoch_k < 20) {
    details.push(`StochK=${formatFixed(last.stoch_k, 0)}`);
  }
  return details;
}

function divergenceSellScore(h1: EnrichedReplayBar[], stats: DivergenceStats): number {
  let score = 6;
  const last = h1[h1.length - 1];
  const previous = h1[h1.length - 2];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;

  if (stats.recentMacdHigh < stats.previousMacdHigh) {
    score += 1;
  } else if (last.macd_hist < previous.macd_hist) {
    score += 1;
  }
  if (volSma > 0 && volume > 0 && volume < 0.7 * volSma) {
    score += 1;
  }
  if (last.stoch_k > 80) {
    score += 1;
  }
  return Math.min(score, 10);
}

function divergenceSellDetails(h1: EnrichedReplayBar[], stats: DivergenceStats): string[] {
  const details: string[] = [];
  const last = h1[h1.length - 1];
  const previous = h1[h1.length - 2];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;

  if (stats.recentMacdHigh < stats.previousMacdHigh) {
    details.push('MACD背离确认');
  } else if (last.macd_hist < previous.macd_hist) {
    details.push('MACD恶化');
  }
  if (volSma > 0 && volume > 0 && volume < 0.7 * volSma) {
    details.push('成交量萎缩');
  }
  if (last.stoch_k > 80) {
    details.push(`StochK=${formatFixed(last.stoch_k, 0)}`);
  }
  return details;
}

function evaluateCounterPullbackSignal(
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[],
  price: number,
  smc: ReplaySmcContext | undefined,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal | null {
  const context = selectCounterPullbackContext(m30, m15);
  if (context == null || h1.length === 0 || price <= 0 || smc == null) {
    return null;
  }
  const { bars: signalBars, timeframe } = context;
  const last = signalBars[signalBars.length - 1];
  const atrValue = h1[h1.length - 1].atr;
  if (atrValue <= 0 || Number.isNaN(atrValue)) {
    return null;
  }

  const recentChoch = recentCounterPullbackChoch(smc, timeframe);
  if (recentChoch == null) {
    return null;
  }
  if (signalBars.length - 1 - recentChoch.index > 10) {
    return null;
  }

  const recentSweep = recentCounterPullbackSweep(smc, recentChoch, timeframe);
  if (recentSweep == null) {
    return null;
  }

  if (recentChoch.direction === 'UP' && recentSweep.side === 'BULL') {
    const pullbackZone = recentSweep.level + atrValue * 0.5;
    if (price > pullbackZone) {
      return null;
    }
    return applyPickSLTP(
      buildCounterPullbackSignal(
        'BUY',
        price,
        atrValue,
        recentSweep.level,
        counterPullbackScore('BUY', last, smc, timeframe, price, atrValue),
        pricePrecision
      ),
      last,
      pricePrecision,
      config
    );
  }

  if (recentChoch.direction === 'DOWN' && recentSweep.side === 'BEAR') {
    const pullbackZone = recentSweep.level - atrValue * 0.5;
    if (price < pullbackZone) {
      return null;
    }
    return applyPickSLTP(
      buildCounterPullbackSignal(
        'SELL',
        price,
        atrValue,
        recentSweep.level,
        counterPullbackScore('SELL', last, smc, timeframe, price, atrValue),
        pricePrecision
      ),
      last,
      pricePrecision,
      config
    );
  }

  return null;
}

function selectCounterPullbackContext(
  m30: EnrichedReplayBar[],
  m15: EnrichedReplayBar[]
): { bars: EnrichedReplayBar[]; timeframe: CounterPullbackTimeframe } | null {
  if (m30.length >= 20) {
    return { bars: m30, timeframe: 'm30' };
  }
  if (m15.length >= 20) {
    return { bars: m15, timeframe: 'm15' };
  }
  return null;
}

function recentCounterPullbackChoch(smc: ReplaySmcContext | undefined, timeframe: CounterPullbackTimeframe): ReplayStructureBreak | undefined {
  const breaks = timeframe === 'm30' ? smc?.m30_breaks : smc?.m15_breaks;
  return [...(breaks ?? [])].reverse().find((entry) => entry.type === 'CHoCH');
}

function recentCounterPullbackSweep(
  smc: ReplaySmcContext | undefined,
  choch: ReplayStructureBreak,
  timeframe: CounterPullbackTimeframe
): ReplayLiquiditySweep | undefined {
  const sweeps = timeframe === 'm30' ? smc?.m30_sweeps : smc?.m15_sweeps;
  return [...(sweeps ?? [])].reverse().find((entry) => {
    return (choch.direction === 'UP' && entry.side === 'BULL') || (choch.direction === 'DOWN' && entry.side === 'BEAR');
  });
}

function counterPullbackScore(
  side: 'BUY' | 'SELL',
  last: EnrichedReplayBar,
  smc?: ReplaySmcContext,
  timeframe?: CounterPullbackTimeframe,
  price = 0,
  atr = 0
): number {
  let score = 5;
  if (side === 'BUY' && last.rsi < 45) {
    score += 1;
  }
  if (side === 'SELL' && last.rsi > 55) {
    score += 1;
  }
  if (hasCounterPullbackOrderBlock(side, smc, timeframe, price, atr)) {
    score += 1;
  }
  if (side === 'BUY' && last.macd_hist > 0) {
    score += 1;
  }
  if (side === 'SELL' && last.macd_hist < 0) {
    score += 1;
  }
  if (hasCounterPullbackFVG(smc, timeframe, price, atr)) {
    score += 1;
  }
  return Math.min(score, 10);
}

function counterPullbackDetails(
  side: 'BUY' | 'SELL',
  choch: ReplayStructureBreak,
  sweep: ReplayLiquiditySweep,
  last: EnrichedReplayBar,
  smc?: ReplaySmcContext,
  timeframe?: CounterPullbackTimeframe,
  price = 0,
  atr = 0
): string[] {
  const details = [`CHoCH@${choch.index}`, `Sweep@${formatFixed(sweep.level, 2)}`];
  if (side === 'BUY' && last.rsi < 45) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (side === 'SELL' && last.rsi > 55) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (hasCounterPullbackOrderBlock(side, smc, timeframe, price, atr)) {
    details.push('OB确认');
  }
  if (side === 'BUY' && last.macd_hist > 0) {
    details.push('MACD>0');
  }
  if (side === 'SELL' && last.macd_hist < 0) {
    details.push('MACD<0');
  }
  if (hasCounterPullbackFVG(smc, timeframe, price, atr)) {
    details.push('FVG确认');
  }
  return details;
}

function hasCounterPullbackOrderBlock(side: 'BUY' | 'SELL', smc: ReplaySmcContext | undefined, timeframe: CounterPullbackTimeframe | undefined, price: number, atr: number): boolean {
  if (price <= 0 || atr <= 0) {
    return false;
  }
  const orderBlocks = timeframe === 'm30' ? smc?.m30_obs : timeframe === 'm15' ? smc?.m15_obs : [];
  return (orderBlocks ?? []).some((ob) => ob.side === side && ob.valid && zoneNearPrice(ob.low, ob.high, price, atr));
}

function hasCounterPullbackFVG(smc: ReplaySmcContext | undefined, timeframe: CounterPullbackTimeframe | undefined, price: number, atr: number): boolean {
  if (price <= 0 || atr <= 0) {
    return false;
  }
  const fvgs = timeframe === 'm30' ? smc?.m30_fvgs : timeframe === 'm15' ? smc?.m15_fvgs : [];
  return (fvgs ?? []).some((fvg) => !fvg.filled && zoneNearPrice(fvg.lower_bound, fvg.upper_bound, price, atr));
}

function zoneNearPrice(low: number, high: number, price: number, threshold: number): boolean {
  return high >= price - threshold && low <= price + threshold;
}

function evaluateBreakoutPyramidSignal(
  h1: EnrichedReplayBar[],
  price: number,
  smc: ReplaySmcContext | undefined,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal | null {
  if (h1.length < 30 || price <= 0) {
    return null;
  }
  const last = h1[h1.length - 1];
  const atrValue = last.atr;
  if (last.adx < config.breakoutPyramid.minAdx || atrValue <= 0 || Number.isNaN(atrValue)) {
    return null;
  }

  if (last.close > last.bb_upper && last.ema20 > last.ema50) {
    if (breakoutPyramidBlockingOrderBlock(h1, 'BUY', smc) != null) {
      return null;
    }
    return buildBreakoutPyramidSignal('BUY', price, atrValue, last, breakoutPyramidScore('BUY', last), pricePrecision, config);
  }

  if (last.close < last.bb_lower && last.ema20 < last.ema50) {
    if (breakoutPyramidBlockingOrderBlock(h1, 'SELL', smc) != null) {
      return null;
    }
    return buildBreakoutPyramidSignal('SELL', price, atrValue, last, breakoutPyramidScore('SELL', last), pricePrecision, config);
  }

  return null;
}

function breakoutPyramidScore(side: 'BUY' | 'SELL', last: EnrichedReplayBar): number {
  let score = 6;
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;
  if (volSma > 0 && volume > 0 && volume > 1.5 * volSma) {
    score += 1;
  }
  if (last.adx > 30) {
    score += 1;
  }
  if ((side === 'BUY' && last.rsi > 55 && last.rsi < 80) || (side === 'SELL' && last.rsi < 45 && last.rsi > 20)) {
    score += 1;
  }
  if ((side === 'BUY' && last.macd_hist > 0) || (side === 'SELL' && last.macd_hist < 0)) {
    score += 1;
  }
  return Math.min(score, 10);
}

function breakoutPyramidDetails(side: 'BUY' | 'SELL', last: EnrichedReplayBar): string[] {
  const details: string[] = [];
  const volume = last.volume ?? 0;
  const volSma = last.vol_sma ?? 0;
  if (volSma > 0 && volume > 0 && volume > 1.5 * volSma) {
    details.push('成交量确认');
  }
  if (last.adx > 30) {
    details.push(`ADX=${formatFixed(last.adx, 1)}>30`);
  }
  if (side === 'BUY' && last.rsi > 55 && last.rsi < 80) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (side === 'SELL' && last.rsi < 45 && last.rsi > 20) {
    details.push(`RSI=${formatFixed(last.rsi, 1)}`);
  }
  if (side === 'BUY' && last.macd_hist > 0) {
    details.push('MACD柱>0');
  }
  if (side === 'SELL' && last.macd_hist < 0) {
    details.push('MACD柱<0');
  }
  return details;
}

function evaluateMomentumScalpSignal(
  m15: EnrichedReplayBar[],
  m5: EnrichedReplayBar[],
  m1: EnrichedReplayBar[],
  price: number,
  config: MomentumScalpConfig,
  pricePrecision: number
): ReplaySignal | null {
  if (m15.length === 0 || m5.length < config.emaPeriod3 || m1.length < 14 || price <= 0) {
    return null;
  }

  const lastM15 = m15[m15.length - 1];
  if (lastM15.adx < config.minAdx) {
    return null;
  }

  const side = momentumScalpSide(lastM15);
  if (side == null) {
    return null;
  }

  const closes = m5.map((bar) => bar.close);
  const emaFast = ema(closes, config.emaPeriod1);
  const emaMid = ema(closes, config.emaPeriod2);
  const emaSlow = ema(closes, config.emaPeriod3);
  const lastIndex = m5.length - 1;
  const lastM5 = m5[lastIndex];
  const previousM5 = m5[lastIndex - 1];

  if (side === 'BUY') {
    if (emaFast[lastIndex] <= emaMid[lastIndex] || lastM5.macd_hist <= previousM5.macd_hist) {
      return null;
    }
  } else if (emaFast[lastIndex] >= emaMid[lastIndex] || lastM5.macd_hist >= previousM5.macd_hist) {
    return null;
  }
  void emaSlow;

  const previousM1 = m1[m1.length - 2];
  const lastM1 = m1[m1.length - 1];
  if (side === 'BUY') {
    if (!(previousM1.rsi < config.rsiBullThresh && lastM1.rsi >= config.rsiCrossoverBull)) {
      return null;
    }
  } else if (!(previousM1.rsi > config.rsiBearThresh && lastM1.rsi <= config.rsiCrossoverBear)) {
    return null;
  }

  const volumeConfirmed = isMomentumScalpVolumeConfirmed(lastM1, config);
  if (!volumeConfirmed && (lastM1.vol_sma ?? 0) > 0 && (lastM1.volume ?? 0) > 0) {
    return null;
  }

  const atrValue = lastM1.atr;
  if (atrValue <= 0 || Number.isNaN(atrValue)) {
    return null;
  }

  const score = momentumScalpScore(side, lastM15, lastM5, lastM1, volumeConfirmed);
  if (score < config.minScore) {
    return null;
  }

  return buildMomentumScalpSignal(side, price, atrValue, score, config, pricePrecision);
}

function momentumScalpSide(lastM15: EnrichedReplayBar): 'BUY' | 'SELL' | null {
  if (lastM15.ema20 > lastM15.ema50) {
    return 'BUY';
  }
  if (lastM15.ema20 < lastM15.ema50) {
    return 'SELL';
  }
  return null;
}

function isMomentumScalpVolumeConfirmed(lastM1: EnrichedReplayBar, config: MomentumScalpConfig): boolean {
  const volume = lastM1.volume ?? 0;
  const volSma = lastM1.vol_sma ?? 0;
  if (volSma <= 0 || volume <= 0) {
    return false;
  }
  return volume > volSma * config.volConfirm;
}

function momentumScalpScore(
  side: 'BUY' | 'SELL',
  lastM15: EnrichedReplayBar,
  lastM5: EnrichedReplayBar,
  lastM1: EnrichedReplayBar,
  volumeConfirmed: boolean
): number {
  let score = 6;
  const volSma = lastM1.vol_sma ?? 0;
  const volume = lastM1.volume ?? 0;

  if ((side === 'BUY' && lastM5.macd_hist > 0) || (side === 'SELL' && lastM5.macd_hist < 0)) {
    score += 1;
  }
  if ((side === 'BUY' && lastM1.rsi >= 40 && lastM1.rsi <= 50) || (side === 'SELL' && lastM1.rsi >= 50 && lastM1.rsi <= 60)) {
    score += 1;
  }
  if (volumeConfirmed && volume > volSma * 1.5) {
    score += 1;
  }
  if (lastM15.adx > 30) {
    score += 1;
  }
  return Math.min(score, 10);
}

function buildMomentumScalpSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  score: number,
  config: MomentumScalpConfig,
  pricePrecision: number
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  const stopLoss = roundToPrecision(entry - direction * atrValue * config.slAtr, pricePrecision);
  const signal: ReplaySignal = {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * config.tp1Atr, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * config.tp2Atr, pricePrecision),
    score,
    // @ts-expect-error momentum_scalp disabled for intraday trading focus
    strategy: 'momentum_scalp',
    atr: roundToSignificantDigits(atrValue, 16),
    all_strategies: [
      {
        // @ts-expect-error momentum_scalp disabled for intraday trading focus
        strategy: 'momentum_scalp',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
  return signal;
}

function buildBreakoutRetestSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  brokenLevel: number,
  score: number,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  const stopLoss = roundToPrecision(brokenLevel - direction * atrValue * config.breakoutRetest.slAtr, pricePrecision);
  return {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * config.breakoutRetest.tp1Atr, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * config.breakoutRetest.tp2Atr, pricePrecision),
    score,
    strategy: 'breakout_retest',
    atr: roundToSignificantDigits(atrValue, 16),
    all_strategies: [
      {
        strategy: 'breakout_retest',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
}

function buildDivergenceSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  pivotClose: number,
  score: number,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  const stopLoss = roundToPrecision(
    side === 'BUY' ? pivotClose - atrValue * config.divergence.slAtr : pivotClose + atrValue * config.divergence.slAtr,
    pricePrecision
  );
  return {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * config.divergence.tp1Atr, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * config.divergence.tp2Atr, pricePrecision),
    score,
    strategy: 'divergence',
    atr: roundToSignificantDigits(atrValue, 16),
    all_strategies: [
      {
        strategy: 'divergence',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
}

function buildCounterPullbackSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  sweepLevel: number,
  score: number,
  pricePrecision: number
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  let stopLoss = roundToPrecision(sweepLevel - direction * atrValue * 0.5, pricePrecision);
  if ((side === 'BUY' && stopLoss >= entry) || (side === 'SELL' && stopLoss <= entry)) {
    stopLoss = roundToPrecision(entry - direction * atrValue * 1.5, pricePrecision);
  }
  return {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * 2, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * 4, pricePrecision),
    score,
    strategy: 'counter_pullback',
    atr: roundToSignificantDigits(atrValue, 16),
    all_strategies: [
      {
        strategy: 'counter_pullback',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
}

function buildBreakoutPyramidSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  last: EnrichedReplayBar,
  score: number,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  const stopLoss = roundToPrecision(last.ema20 - direction * atrValue * config.breakoutPyramid.slAtr, pricePrecision);
  return {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * 2, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * 5, pricePrecision),
    score,
    strategy: 'breakout_pyramid',
    atr: roundToSignificantDigits(atrValue, 16),
    all_strategies: [
      {
        strategy: 'breakout_pyramid',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
}

function momentumScalpSignalLog(
  m15: EnrichedReplayBar[],
  m5: EnrichedReplayBar[],
  m1: EnrichedReplayBar[],
  side: 'BUY' | 'SELL',
  config: MomentumScalpConfig
): ReplayLog {
  const lastM15 = m15[m15.length - 1];
  const lastM5 = m5[m5.length - 1];
  const lastM1 = m1[m1.length - 1];
  const score = momentumScalpScore(side, lastM15, lastM5, lastM1, isMomentumScalpVolumeConfirmed(lastM1, config));
  const details: string[] = [];
  const volume = lastM1.volume ?? 0;
  const volSma = lastM1.vol_sma ?? 0;

  if ((side === 'BUY' && lastM5.macd_hist > 0) || (side === 'SELL' && lastM5.macd_hist < 0)) {
    details.push(`M5 MACDHist=${formatFixed(lastM5.macd_hist, 2)}`);
  }
  if ((side === 'BUY' && lastM1.rsi >= 40 && lastM1.rsi <= 50) || (side === 'SELL' && lastM1.rsi >= 50 && lastM1.rsi <= 60)) {
    details.push(`M1 RSI=${formatFixed(lastM1.rsi, 1)}`);
  }
  if (isMomentumScalpVolumeConfirmed(lastM1, config) && volume > volSma * 1.5) {
    details.push(`成交量=${formatFixedHalfEven(volume / volSma, 2)}x`);
  }
  if (lastM15.adx > 30) {
    details.push(`M15 ADX=${formatFixed(lastM15.adx, 1)}`);
  }

  return {
    level: 'signal',
    strategy: '动量剥头皮',
    msg: `${sideIcon(side)} ${side} 评分=${score} | M15 ADX=${formatFixed(lastM15.adx, 1)} | ${details.join(' | ')}`
  };
}

function momentumScalpConfigForSymbol(symbol: string | undefined): MomentumScalpConfig {
  const config = { ...defaultMomentumScalpConfig };
  switch (baseSymbol(symbol)) {
    case 'XAUUSD':
      config.minAdx = 18;
      config.volConfirm = 1.05;
      config.minScore = 6;
      break;
    case 'XAGUSD':
      config.minAdx = 15;
      config.slAtr = 0.6;
      config.tp1Atr = 0.8;
      config.tp2Atr = 1.2;
      config.minScore = 7;
      break;
    case 'GBPJPY':
    case 'EURJPY':
    case 'USDJPY':
      config.minAdx = 18;
      config.slAtr = 0.8;
      config.tp1Atr = 1;
      config.tp2Atr = 1.5;
      config.rsiBullThresh = 42;
      config.rsiBearThresh = 58;
      config.rsiCrossoverBull = 46;
      config.rsiCrossoverBear = 54;
      config.volConfirm = 1.02;
      config.minScore = 7;
      break;
    case 'EURUSD':
      config.minAdx = 15;
      config.slAtr = 0.3;
      config.tp1Atr = 0.5;
      config.tp2Atr = 0.8;
      config.minScore = 6;
      break;
    case 'GBPUSD':
      config.minAdx = 16;
      config.slAtr = 0.5;
      config.tp1Atr = 0.7;
      config.tp2Atr = 1;
      config.minScore = 6;
      break;
    case 'USDCAD':
      config.minAdx = 16;
      config.slAtr = 0.4;
      config.tp1Atr = 0.6;
      config.tp2Atr = 0.9;
      config.minScore = 6;
      break;
    case 'US100CASH':
      config.minAdx = 16;
      config.slAtr = 0.5;
      config.tp1Atr = 0.8;
      config.tp2Atr = 1.2;
      config.minScore = 6;
      break;
    case 'USOILCASH':
    case 'UKOILCASH':
      config.minAdx = 15;
      config.slAtr = 0.6;
      config.tp1Atr = 0.8;
      config.tp2Atr = 1.2;
      config.minScore = 7;
      break;
  }
  return config;
}

function baseSymbol(symbol: string | undefined): string {
  const normalized = (symbol ?? '').trim().toUpperCase().replace(/M#$/, '').replace(/#$/, '');
  switch (normalized) {
    case 'GOLD':
    case 'XAUUSD':
      return 'XAUUSD';
    case 'SILVER':
    case 'XAGUSD':
      return 'XAGUSD';
    case 'US100':
    case 'NAS100':
    case 'US100CASH':
      return 'US100CASH';
    case 'USOIL':
    case 'WTI':
    case 'USOILCASH':
      return 'USOILCASH';
    case 'UKOIL':
    case 'BRENT':
    case 'UKOILCASH':
      return 'UKOILCASH';
    default:
      return normalized;
  }
}

function roundingPrecisionForSymbol(symbol: string | undefined): number {
  switch (baseSymbol(symbol)) {
    case 'EURUSD':
    case 'GBPUSD':
    case 'USDCAD':
    case 'AUDUSD':
    case 'NZDUSD':
      return 5;
    case 'GBPJPY':
    case 'EURJPY':
    case 'USDJPY':
      return 3;
    default:
      return 2;
  }
}

function sideIcon(side: 'BUY' | 'SELL'): string {
  return side === 'BUY' ? '🟢' : '🔴';
}

function isNearEma20(h1: EnrichedReplayBar[], threshold: number): boolean {
  if (h1.length < 2) {
    return false;
  }
  const previous = h1[h1.length - 2];
  const last = h1[h1.length - 1];
  return Math.abs(previous.close - previous.ema20) < threshold && Math.abs(last.close - last.ema20) < threshold;
}

function pullbackScore(side: 'BUY' | 'SELL', last: EnrichedReplayBar, nearEma: boolean, config: ReplayTraditionalConfig): number {
  let score = 5;
  if (side === 'BUY' && last.macd_hist > 0) {
    score += 1;
  }
  if (side === 'SELL' && last.macd_hist < 0) {
    score += 1;
  }
  if (side === 'BUY' && last.rsi < 50) {
    score += 1;
  }
  if (side === 'SELL' && last.rsi > 50) {
    score += 1;
  }
  if (last.adx > config.pullback.adxBonus) {
    score += 1;
  }
  if (nearEma) {
    score += 1;
  }
  return Math.min(score, 10);
}

function buildPullbackSignal(
  side: 'BUY' | 'SELL',
  entry: number,
  atrValue: number,
  score: number,
  pricePrecision: number,
  config: ReplayTraditionalConfig
): ReplaySignal {
  const direction = side === 'BUY' ? 1 : -1;
  const stopLoss = roundToPrecision(entry - direction * atrValue * config.pullback.slAtr, pricePrecision);
  const oracleAtr = roundToSignificantDigits(atrValue, 16);
  const signal: ReplaySignal = {
    side,
    entry,
    stop_loss: stopLoss,
    tp1: roundToPrecision(entry + direction * atrValue * config.pullback.tp1Atr, pricePrecision),
    tp2: roundToPrecision(entry + direction * atrValue * config.pullback.tp2Atr, pricePrecision),
    score,
    strategy: 'pullback',
    atr: oracleAtr,
    all_strategies: [
      {
        strategy: 'pullback',
        side,
        score,
        entry,
        stop_loss: stopLoss
      }
    ]
  };
  return signal;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBooleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundToSignificantDigits(value: number, digits: number): number {
  return Number(value.toPrecision(digits));
}

function formatFixed(value: number, precision: number): string {
  return value.toFixed(precision);
}

function formatFixedHalfEven(value: number, precision: number): string {
  const factor = 10 ** precision;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const rounded =
    Math.abs(fraction - 0.5) < Number.EPSILON
      ? floor % 2 === 0
        ? floor
        : floor + 1
      : Math.round(scaled);
  return (rounded / factor).toFixed(precision);
}
