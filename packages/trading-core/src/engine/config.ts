// Per-symbol strategy configuration
// Ported from internal/strategy/engine/config.go

export type FibExtensionTPConfig = {
  enabled: boolean;
  minADX: number;
  swingWindow: number;
  useH4Preference: boolean;
};

export type PullbackFibConfig = {
  retracementEnabled: boolean;
  goldenPocketBufferATR: number;
  requireRSIConfirm: boolean;
  rsiConfirmBullThreshold: number;
  rsiConfirmBearThreshold: number;
  stopLossOuterATR: number;
  usePendingOrder: boolean;
  pendingOrderLevel: string;
};

export type TrendConfig = {
  d1Weight: number;   // 0.05
  h4Weight: number;   // 0.25
  h1Weight: number;   // 0.35
  m30Weight: number;  // 0.35

  softThreshold: number;    // 0.30
  mediumThreshold: number;  // 0.15

  weakADXThreshold: number;   // 20
  strongADXThreshold: number; // 30

  enabled: boolean; // true
};

export type StrategyConfig = {
  // Pullback strategy
  pullbackMinADX: number;
  pullbackRSIOversold: number;
  pullbackRSIOverbought: number;
  pullbackDistATR: number;
  pullbackADXBonus: number;
  pullbackSLATR: number;
  pullbackTP1ATR: number;
  pullbackTP2ATR: number;

  // BreakoutRetest strategy
  breakoutRetestLookback: number;
  breakoutRetestConfirmWindow: number;
  breakoutRetestDistATR: number;
  breakoutRetestSLATR: number;
  breakoutRetestTP1ATR: number;
  breakoutRetestTP2ATR: number;

  // Divergence strategy
  divergenceWindowRecent: number;
  divergenceWindowPrev: number;
  divergenceRSIBullThresh: number;
  divergenceRSIBearThresh: number;
  divergenceSLATR: number;
  divergenceTP1ATR: number;
  divergenceTP2ATR: number;

  // BreakoutPyramid strategy
  breakoutPyramidMinADX: number;
  breakoutPyramidSLATR: number;
  breakoutPyramidMinSpacingATR: number;

  // ScaleIn strategy
  scaleInEnabled: boolean;
  scaleInMinADX: number;
  scaleInMinDistATR: number;
  scaleInMinFloatLossATR: number;
  scaleInMaxAddCount: number;
  scaleInLotDecay: number;
  scaleInSLATR: number;
  scaleInTP1ATR: number;
  scaleInTP2ATR: number;
  scaleInMinIntervalMin: number;
  scaleInMaxFloatLossPct: number;

  // SR-based SL/TP
  srBufferATR: number;
  srMaxDistATR: number;
  srMinDistATR: number;

  // H4 trend filter
  h4ADXThreshold: number;
  h4RequireConsecutive: number;

  // M15 confirmation
  m15ConfirmRSIThreshold: number;

  // Minimum signal score
  minScore: number;

  // MomentumScalp strategy
  momentumScalpMinADX: number;
  momentumScalpEMAPeriod1: number;
  momentumScalpEMAPeriod2: number;
  momentumScalpEMAPeriod3: number;
  momentumScalpRSIBullThresh: number;
  momentumScalpRSIBearThresh: number;
  momentumScalpRSICrossoverBull: number;
  momentumScalpRSICrossoverBear: number;
  momentumScalpSLATR: number;
  momentumScalpTP1ATR: number;
  momentumScalpTP2ATR: number;
  momentumScalpVolConfirm: number;
  momentumScalpMinScore: number;
  momentumScalpMaxHoldingMin: number;

  // Fibonacci / Trend extensions
  fibExtension: FibExtensionTPConfig;
  pullbackFib: PullbackFibConfig;
  trend: TrendConfig;
};

// --------------- Default Config ---------------

export function defaultTrendConfig(): TrendConfig {
  return {
    d1Weight: 0.05,
    h4Weight: 0.25,
    h1Weight: 0.35,
    m30Weight: 0.35,
    softThreshold: 0.30,
    mediumThreshold: 0.15,
    weakADXThreshold: 20,
    strongADXThreshold: 30,
    enabled: true,
  };
}

export function defaultStrategyConfig(): StrategyConfig {
  return {
    pullbackMinADX: 25.0,
    pullbackRSIOversold: 30.0,
    pullbackRSIOverbought: 70.0,
    pullbackDistATR: 0.5,
    pullbackADXBonus: 30.0,
    pullbackSLATR: 1.5,
    pullbackTP1ATR: 1.5,
    pullbackTP2ATR: 3.0,

    breakoutRetestLookback: 50,
    breakoutRetestConfirmWindow: 3,
    breakoutRetestDistATR: 0.5,
    breakoutRetestSLATR: 1.5,
    breakoutRetestTP1ATR: 2.0,
    breakoutRetestTP2ATR: 4.0,

    divergenceWindowRecent: 15,
    divergenceWindowPrev: 15,
    divergenceRSIBullThresh: 40.0,
    divergenceRSIBearThresh: 60.0,
    divergenceSLATR: 1.0,
    divergenceTP1ATR: 2.0,
    divergenceTP2ATR: 4.0,

    breakoutPyramidMinADX: 30.0,
    breakoutPyramidSLATR: 1.5,
    breakoutPyramidMinSpacingATR: 2.0,

    scaleInEnabled: true,
    scaleInMinADX: 25.0,
    scaleInMinDistATR: 1.5,
    scaleInMinFloatLossATR: 0.5,
    scaleInMaxAddCount: 2,
    scaleInLotDecay: 0.6,
    scaleInSLATR: 1.2,
    scaleInTP1ATR: 1.5,
    scaleInTP2ATR: 3.0,
    scaleInMinIntervalMin: 30,
    scaleInMaxFloatLossPct: 5.0,

    srBufferATR: 0.5,
    srMaxDistATR: 3.0,
    srMinDistATR: 0.3,

    h4ADXThreshold: 30.0,
    h4RequireConsecutive: 3,

    m15ConfirmRSIThreshold: 40.0,

    minScore: 5,

    momentumScalpMinADX: 20.0,
    momentumScalpEMAPeriod1: 5,
    momentumScalpEMAPeriod2: 8,
    momentumScalpEMAPeriod3: 12,
    momentumScalpRSIBullThresh: 45.0,
    momentumScalpRSIBearThresh: 55.0,
    momentumScalpRSICrossoverBull: 48.0,
    momentumScalpRSICrossoverBear: 52.0,
    momentumScalpSLATR: 0.4,
    momentumScalpTP1ATR: 0.5,
    momentumScalpTP2ATR: 0.8,
    momentumScalpVolConfirm: 1.05,
    momentumScalpMinScore: 7,
    momentumScalpMaxHoldingMin: 20,

    fibExtension: {
      enabled: false,
      minADX: 25.0,
      swingWindow: 50,
      useH4Preference: true,
    },
    pullbackFib: {
      retracementEnabled: false,
      goldenPocketBufferATR: 0.5,
      requireRSIConfirm: false,
      rsiConfirmBullThreshold: 40,
      rsiConfirmBearThreshold: 60,
      stopLossOuterATR: 0.5,
      usePendingOrder: false,
      pendingOrderLevel: '618',
    },
    trend: defaultTrendConfig(),
  };
}

// --------------- Per-Symbol Configs ---------------

export function goldStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.pullbackMinADX = 25.0;
  cfg.pullbackSLATR = 1.5;
  cfg.pullbackTP1ATR = 1.5;
  cfg.pullbackTP2ATR = 3.0;
  cfg.momentumScalpMinADX = 18.0;
  cfg.momentumScalpVolConfirm = 1.05;
  cfg.momentumScalpMinScore = 6;
  cfg.fibExtension.minADX = 25.0;
  cfg.pullbackFib.retracementEnabled = true;
  return cfg;
}

export function silverStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.pullbackSLATR = 2.0;
  cfg.pullbackTP1ATR = 3.0;
  cfg.pullbackTP2ATR = 5.0;
  cfg.minScore = 6;
  cfg.h4ADXThreshold = 22;
  cfg.momentumScalpMinADX = 15.0;
  cfg.momentumScalpSLATR = 0.6;
  cfg.momentumScalpTP1ATR = 0.8;
  cfg.momentumScalpTP2ATR = 1.2;
  cfg.momentumScalpMinScore = 7;
  return cfg;
}

export function gbpjpyStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();

  cfg.h4ADXThreshold = 22.0;
  cfg.h4RequireConsecutive = 2;

  cfg.pullbackMinADX = 20.0;
  cfg.pullbackRSIOversold = 35.0;
  cfg.pullbackRSIOverbought = 65.0;
  cfg.pullbackDistATR = 0.6;
  cfg.pullbackADXBonus = 25.0;
  cfg.pullbackSLATR = 1.8;
  cfg.pullbackTP1ATR = 2.0;
  cfg.pullbackTP2ATR = 3.5;

  cfg.breakoutRetestLookback = 40;
  cfg.breakoutRetestConfirmWindow = 2;
  cfg.breakoutRetestDistATR = 0.7;
  cfg.breakoutRetestSLATR = 2.0;
  cfg.breakoutRetestTP1ATR = 2.5;
  cfg.breakoutRetestTP2ATR = 4.5;

  cfg.divergenceWindowRecent = 12;
  cfg.divergenceWindowPrev = 12;
  cfg.divergenceRSIBullThresh = 45.0;
  cfg.divergenceRSIBearThresh = 55.0;
  cfg.divergenceSLATR = 1.5;
  cfg.divergenceTP1ATR = 2.5;
  cfg.divergenceTP2ATR = 4.5;

  cfg.breakoutPyramidMinADX = 25.0;
  cfg.breakoutPyramidSLATR = 2.0;
  cfg.breakoutPyramidMinSpacingATR = 2.5;

  cfg.scaleInMinADX = 20.0;
  cfg.scaleInMinDistATR = 1.8;
  cfg.scaleInSLATR = 1.8;
  cfg.scaleInTP1ATR = 2.0;
  cfg.scaleInTP2ATR = 3.5;

  cfg.momentumScalpMinADX = 18.0;
  cfg.momentumScalpSLATR = 0.8;
  cfg.momentumScalpTP1ATR = 1.0;
  cfg.momentumScalpTP2ATR = 1.5;
  cfg.momentumScalpMinScore = 7;
  cfg.momentumScalpMaxHoldingMin = 45;
  cfg.momentumScalpRSIBullThresh = 42.0;
  cfg.momentumScalpRSIBearThresh = 58.0;
  cfg.momentumScalpRSICrossoverBull = 46.0;
  cfg.momentumScalpRSICrossoverBear = 54.0;
  cfg.momentumScalpVolConfirm = 1.02;

  cfg.m15ConfirmRSIThreshold = 45.0;
  cfg.minScore = 5;
  cfg.fibExtension.minADX = 28.0;
  cfg.pullbackFib.retracementEnabled = true;
  cfg.pullbackFib.goldenPocketBufferATR = 0.3;

  return cfg;
}

export function jpyCrossStrategyConfig(): StrategyConfig {
  return gbpjpyStrategyConfig();
}

export function eurusdStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.h4ADXThreshold = 20.0;
  cfg.h4RequireConsecutive = 2;
  cfg.pullbackMinADX = 20.0;
  cfg.pullbackSLATR = 1.0;
  cfg.pullbackTP1ATR = 1.5;
  cfg.pullbackTP2ATR = 2.5;
  cfg.pullbackDistATR = 0.4;
  cfg.breakoutRetestSLATR = 1.2;
  cfg.breakoutRetestTP1ATR = 1.8;
  cfg.breakoutRetestTP2ATR = 3.5;
  cfg.divergenceSLATR = 0.8;
  cfg.divergenceTP1ATR = 1.5;
  cfg.divergenceTP2ATR = 3.0;
  cfg.breakoutPyramidMinADX = 25.0;
  cfg.scaleInSLATR = 1.0;
  cfg.scaleInTP1ATR = 1.5;
  cfg.scaleInTP2ATR = 2.5;
  cfg.momentumScalpMinADX = 15.0;
  cfg.momentumScalpSLATR = 0.3;
  cfg.momentumScalpTP1ATR = 0.5;
  cfg.momentumScalpTP2ATR = 0.8;
  cfg.momentumScalpMinScore = 6;
  cfg.momentumScalpMaxHoldingMin = 25;
  cfg.m15ConfirmRSIThreshold = 40.0;
  cfg.minScore = 5;
  return cfg;
}

export function gbpusdStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.h4ADXThreshold = 22.0;
  cfg.h4RequireConsecutive = 2;
  cfg.pullbackMinADX = 20.0;
  cfg.pullbackSLATR = 1.3;
  cfg.pullbackTP1ATR = 1.8;
  cfg.pullbackTP2ATR = 3.0;
  cfg.pullbackDistATR = 0.5;
  cfg.breakoutRetestSLATR = 1.5;
  cfg.breakoutRetestTP1ATR = 2.0;
  cfg.breakoutRetestTP2ATR = 4.0;
  cfg.divergenceSLATR = 1.0;
  cfg.divergenceTP1ATR = 2.0;
  cfg.divergenceTP2ATR = 3.5;
  cfg.breakoutPyramidMinADX = 28.0;
  cfg.breakoutPyramidSLATR = 1.5;
  cfg.scaleInSLATR = 1.3;
  cfg.scaleInTP1ATR = 1.8;
  cfg.scaleInTP2ATR = 3.0;
  cfg.momentumScalpMinADX = 16.0;
  cfg.momentumScalpSLATR = 0.5;
  cfg.momentumScalpTP1ATR = 0.7;
  cfg.momentumScalpTP2ATR = 1.0;
  cfg.momentumScalpMinScore = 6;
  cfg.momentumScalpMaxHoldingMin = 30;
  cfg.m15ConfirmRSIThreshold = 42.0;
  cfg.minScore = 5;
  return cfg;
}

export function usdcadStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.h4ADXThreshold = 25.0;
  cfg.h4RequireConsecutive = 2;
  cfg.pullbackMinADX = 22.0;
  cfg.pullbackSLATR = 1.2;
  cfg.pullbackTP1ATR = 1.5;
  cfg.pullbackTP2ATR = 3.0;
  cfg.pullbackDistATR = 0.5;
  cfg.breakoutRetestSLATR = 1.3;
  cfg.breakoutRetestTP1ATR = 2.0;
  cfg.breakoutRetestTP2ATR = 3.5;
  cfg.divergenceSLATR = 0.8;
  cfg.divergenceTP1ATR = 1.8;
  cfg.divergenceTP2ATR = 3.0;
  cfg.breakoutPyramidMinADX = 28.0;
  cfg.breakoutPyramidSLATR = 1.5;
  cfg.scaleInSLATR = 1.2;
  cfg.scaleInTP1ATR = 1.5;
  cfg.scaleInTP2ATR = 3.0;
  cfg.momentumScalpMinADX = 16.0;
  cfg.momentumScalpSLATR = 0.4;
  cfg.momentumScalpTP1ATR = 0.6;
  cfg.momentumScalpTP2ATR = 0.9;
  cfg.momentumScalpMinScore = 6;
  cfg.momentumScalpMaxHoldingMin = 25;
  cfg.m15ConfirmRSIThreshold = 40.0;
  cfg.minScore = 5;
  return cfg;
}

export function us100CashStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.h4ADXThreshold = 25.0;
  cfg.h4RequireConsecutive = 3;
  cfg.pullbackMinADX = 22.0;
  cfg.pullbackDistATR = 0.6;
  cfg.pullbackSLATR = 1.0;
  cfg.pullbackTP1ATR = 2.0;
  cfg.pullbackTP2ATR = 3.5;
  cfg.breakoutRetestLookback = 45;
  cfg.breakoutRetestDistATR = 0.6;
  cfg.breakoutRetestSLATR = 1.0;
  cfg.breakoutRetestTP1ATR = 2.5;
  cfg.breakoutRetestTP2ATR = 5.0;
  cfg.divergenceSLATR = 0.6;
  cfg.divergenceTP1ATR = 2.0;
  cfg.divergenceTP2ATR = 4.0;
  cfg.breakoutPyramidMinADX = 25.0;
  cfg.breakoutPyramidSLATR = 1.0;
  cfg.scaleInSLATR = 1.0;
  cfg.scaleInTP1ATR = 2.0;
  cfg.scaleInTP2ATR = 3.5;
  cfg.momentumScalpMinADX = 16.0;
  cfg.momentumScalpSLATR = 0.5;
  cfg.momentumScalpTP1ATR = 0.8;
  cfg.momentumScalpTP2ATR = 1.2;
  cfg.momentumScalpMaxHoldingMin = 60;
  cfg.momentumScalpMinScore = 6;
  cfg.trend.h4Weight = 0.35;
  cfg.trend.h1Weight = 0.35;
  cfg.trend.m30Weight = 0.25;
  cfg.trend.d1Weight = 0.05;
  cfg.minScore = 5;
  cfg.fibExtension.minADX = 25.0;
  return cfg;
}

export function oilStrategyConfig(): StrategyConfig {
  const cfg = defaultStrategyConfig();
  cfg.h4ADXThreshold = 22.0;
  cfg.h4RequireConsecutive = 2;
  cfg.pullbackMinADX = 20.0;
  cfg.pullbackDistATR = 0.8;
  cfg.pullbackSLATR = 2.0;
  cfg.pullbackTP1ATR = 2.5;
  cfg.pullbackTP2ATR = 4.0;
  cfg.breakoutRetestLookback = 45;
  cfg.breakoutRetestDistATR = 0.7;
  cfg.breakoutRetestSLATR = 2.0;
  cfg.breakoutRetestTP1ATR = 2.5;
  cfg.breakoutRetestTP2ATR = 4.5;
  cfg.divergenceSLATR = 1.5;
  cfg.divergenceTP1ATR = 2.5;
  cfg.divergenceTP2ATR = 4.5;
  cfg.breakoutPyramidMinADX = 28.0;
  cfg.breakoutPyramidSLATR = 2.0;
  cfg.breakoutPyramidMinSpacingATR = 2.5;
  cfg.scaleInMinADX = 22.0;
  cfg.scaleInSLATR = 1.8;
  cfg.scaleInTP1ATR = 2.0;
  cfg.scaleInTP2ATR = 3.5;
  cfg.momentumScalpMinADX = 15.0;
  cfg.momentumScalpSLATR = 0.6;
  cfg.momentumScalpTP1ATR = 0.8;
  cfg.momentumScalpTP2ATR = 1.2;
  cfg.momentumScalpMinScore = 7;
  cfg.momentumScalpMaxHoldingMin = 45;
  cfg.m15ConfirmRSIThreshold = 42.0;
  cfg.minScore = 5;
  cfg.fibExtension.minADX = 28.0;
  cfg.pullbackFib.retracementEnabled = true;
  cfg.pullbackFib.goldenPocketBufferATR = 0.4;
  return cfg;
}

// --------------- Symbol Lookup ---------------

export function getStrategyConfigBySymbol(baseSymbol: string): StrategyConfig {
  switch (baseSymbol) {
    case 'XAUUSD':
    case 'GOLD':
      return goldStrategyConfig();
    case 'XAGUSD':
    case 'SILVER':
      return silverStrategyConfig();
    case 'GBPJPY':
      return gbpjpyStrategyConfig();
    case 'EURJPY':
      return jpyCrossStrategyConfig();
    case 'USDJPY':
      return jpyCrossStrategyConfig();
    case 'EURUSD':
      return eurusdStrategyConfig();
    case 'GBPUSD':
      return gbpusdStrategyConfig();
    case 'USDCAD':
      return usdcadStrategyConfig();
    case 'US100CASH':
      return us100CashStrategyConfig();
    case 'USOILCASH':
    case 'UKOILCASH':
      return oilStrategyConfig();
    default:
      return defaultStrategyConfig();
  }
}
