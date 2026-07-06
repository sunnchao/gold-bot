import type {
  ArbitrationResult,
  ChanlunAnalystResult,
  HarmonicAnalysisResult,
  RiskAssessment,
  TechnicalAnalysis,
  WaveAnalystResult,
} from './analysis.js';
import type { TradeAction } from './trade-action.js';

export interface ComprehensiveAnalysisResult {
  technical: TechnicalAnalysis;
  wave: WaveAnalystResult;
  chanlun: ChanlunAnalystResult;
  harmonic: HarmonicAnalysisResult;
  risk: RiskAssessment;
  arbitration: ArbitrationResult;
  tradeAction?: TradeAction; // function calling 下单动作（第二阶段产生）
}
