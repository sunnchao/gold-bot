import type { GoldbotPayload, PendingSignal } from './goldbot.js';
import type {
  TechnicalAnalysis,
  SRLevels,
  ArbitrationResult,
  RiskAssessment,
  WaveAnalystResult,
  ChanlunAnalystResult,
} from './analysis.js';

// --- Analysis Log ---

export interface AnalysisLog {
  timestamp: string;
  node: string;
  message: string;
  level: 'debug' | 'info' | 'warn' | 'error';
}

import type {
  DowTheoryAnalysis,
  WaveTheoryAnalysis,
  ChanlunTheoryAnalysis,
  HarmonicTheoryAnalysis,
  TradeRecommendation,
} from './analysis.js';

// --- AI Signal Result ---

export type TradePlanMode = 'observe' | 'veto' | 'approve' | 'modify' | 'reduce' | 'close';
export type TradePlanSide = 'buy' | 'sell' | 'dual' | 'none';
export type TradePlanExecutionType = 'market' | 'limit';
export type TradePlanRequestedOrderType = 'market' | 'BUY_LIMIT' | 'SELL_LIMIT';

export interface TradePlanEntryZone {
  min: number;
  max: number;
}

export interface TradePlan {
  schema_version: 'trade_plan.v1';
  decision_id: string;
  account_id: string;
  symbol: string;
  mode: TradePlanMode;
  side: TradePlanSide;
  confidence: number;
  entry_zone: TradePlanEntryZone;
  execution_type?: TradePlanExecutionType;
  requested_order_type?: TradePlanRequestedOrderType;
  stop_loss: number;
  take_profit: number[];
  max_lots: number;
  expires_at: string;
  reason_codes: string[];
  conflicts: string[];
  narrative: string;
  add_on?: boolean;
}

export interface DualTradePlan {
  buy: TradePlan;
  sell: TradePlan;
  is_dual_direction: boolean;
}

export interface AISignalResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  exit_suggestion: 'hold' | 'close' | 'partial_close' | 'trail_stop' | 'none';
  risk_alert: boolean;
  risk_level?: 'low' | 'medium' | 'high' | 'extreme';
  alert_reason?: string;
  suggested_sl?: number;  // AI 建议止损价格（基于支撑阻力位分析）
  suggested_tp?: number;  // AI 建议止盈价格（可选）
  max_position_size?: number;  // AI 建议最大仓位
  indicators_summary?: string;  // 技术指标摘要
  sr_levels?: {
    support: number[];
    resistance: number[];
  };
  arbitration?: {
    direction: string;
    action: string;
    reasoning: string;
    phase?: string;
    contradiction?: string;
    united_front?: string;
  };
  wave_analysis?: {
    confirmation: string;
    extension_wave: number | null;
  };
  chanlun_analysis?: {
    trend: string;
    signal: string;
  };
  dow_theory?: DowTheoryAnalysis;
  wave_theory?: WaveTheoryAnalysis;
  chanlun_theory?: ChanlunTheoryAnalysis;
  harmonic_theory?: HarmonicTheoryAnalysis;
  trade_recommendation?: TradeRecommendation;
  trade_plan?: TradePlan;
  dual_trade_plan?: DualTradePlan;  // 双向下单支持
}

// --- Analysis State ---

export interface AnalysisState {
  accountId: string;
  symbol: string;
  timestamp: string;
  payload?: GoldbotPayload;
  pendingSignal?: PendingSignal;
  technicalAnalysis?: TechnicalAnalysis;
  waveAnalysis?: WaveAnalystResult;
  chanlunAnalysis?: ChanlunAnalystResult;
  srLevels?: SRLevels;
  arbitration?: ArbitrationResult;
  riskAssessment?: RiskAssessment;
  finalSignal?: AISignalResult;
  logs: AnalysisLog[];
  errors: string[];
  duration?: number;
}

// --- Factory ---

export function createInitialState(accountId: string, symbol: string): AnalysisState {
  return {
    accountId,
    symbol,
    timestamp: new Date().toISOString(),
    logs: [],
    errors: [],
  };
}
