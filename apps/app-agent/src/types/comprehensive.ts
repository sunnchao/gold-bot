import type {
  ArbitrationResult,
  ChanlunAnalystResult,
  HarmonicAnalysisResult,
  RiskAssessment,
  TechnicalAnalysis,
  WaveAnalystResult,
} from './analysis.js';
import type { TradeAction } from './trade-action.js';
import type { GoldbotPayload, PendingSignal } from './goldbot.js';

export interface ComprehensiveAnalysisResult {
  technical: TechnicalAnalysis;
  wave: WaveAnalystResult;
  chanlun: ChanlunAnalystResult;
  harmonic: HarmonicAnalysisResult;
  risk: RiskAssessment;
  arbitration: ArbitrationResult;
  tradeAction?: TradeAction; // function calling 下单动作（第二阶段产生）
}

export interface TradeIntent {
  direction: 'buy' | 'sell' | 'hold';
  entry_trigger: 'market' | 'pullback' | 'breakout' | 'none';
  entry_offset_atr: number;
  stop_loss_atr: number;
  take_profit_1_atr: number;
  take_profit_2_atr?: number;
  rationale: string;
}

export interface MarketInsight extends Omit<ComprehensiveAnalysisResult, 'tradeAction'> {
  sr_levels: {
    support: number[];
    resistance: number[];
  };
  trend_bias: TechnicalAnalysis['bias'];
  confidence: number;
  trade_intent: TradeIntent;
}

export interface BarView {
  canonicalSymbol: string;
  sourceAccount: string;
  sourceSymbol: string;
  useShared: boolean;
  payload: GoldbotPayload;
  benchmarkPrice: number;
  atr: number;
}

export interface AccountView {
  accountId: string;
  symbol: string;
  payload: GoldbotPayload;
  pendingSignal?: PendingSignal;
  aiSymbols: string[];
  realtimePrice: number;
  atr: number;
}
