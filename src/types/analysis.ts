// --- Timeframe Analysis ---

export interface TimeframeAnalysis {
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  key_level: number;
  notes: string;
}

// --- Technical Analysis ---

export type TradeSuggestion = 'hold' | 'close' | 'partial_close' | 'trail_stop' | 'none';

export interface TechnicalAnalysis {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
  phase: 'trending' | 'ranging' | 'breakout' | 'reversal' | 'consolidation';
  indicators_summary: string;
  support_levels: SRLevel[];
  resistance_levels: SRLevel[];
  recommendation: TradeSuggestion;
  rationale: string;
}

// --- Support/Resistance Levels ---

export interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'moderate' | 'weak';
  timeframe: string;
  touches: number;
}

export interface SRLevels {
  support_levels: SRLevel[];
  resistance_levels: SRLevel[];
  recommendation: string;
  rationale: string;
}

// --- Arbitration Result ---

export interface ArbitrationResult {
  final_direction: 'buy' | 'sell' | 'hold' | 'close' | 'dual';
  confidence: number; // 0-100
  primary_contradiction: string;
  phase: string;
  reasoning: string;
  action: 'open' | 'close' | 'modify' | 'hold';
  united_front_analysis: string;
  dow_theory?: DowTheoryAnalysis;
  wave_theory?: WaveTheoryAnalysis;
  chanlun_theory?: ChanlunTheoryAnalysis;
  harmonic_theory?: HarmonicTheoryAnalysis;
  trade_recommendation?: TradeRecommendation;
}

// --- Harmonic Theory Analysis (arbitration sub-theory) ---

export interface HarmonicTheoryAnalysis {
  pattern: 'gartley' | 'bat' | 'butterfly' | 'crab' | 'abcd' | 'cypher' | 'shark' | 'none';
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
  rationale: string;
}

// --- Dow Theory Analysis ---

export interface DowTheoryAnalysis {
  primary_trend: 'bullish' | 'bearish' | 'neutral';
  primary_phase: 'accumulation' | 'markup' | 'distribution' | 'markdown';
  secondary_trend: 'bullish' | 'bearish' | 'neutral';
  short_term_trend: 'bullish' | 'bearish' | 'neutral';
  multi_tf_confirm: boolean;
  rationale: string;
}

// --- Wave Theory Analysis ---

export interface WaveTheoryAnalysis {
  current_wave: string;
  wave_direction: 'impulse_up' | 'impulse_down' | 'corrective' | 'unclear';
  wave_count: string;
  next_target: string;
  confidence: number;
  rationale: string;
}

// --- Chanlun Theory Analysis ---

export interface ChanlunTheoryAnalysis {
  trend: 'up' | 'down' | 'range';
  bi_direction: 'up' | 'down' | 'none';
  duan_direction: 'up' | 'down' | 'none';
  zhongshu_state: 'forming' | 'active' | 'breaking_up' | 'breaking_down' | 'none';
  buy_sell_point: 'buy_1' | 'buy_2' | 'buy_3' | 'sell_1' | 'sell_2' | 'sell_3' | 'none';
  confidence: number;
  rationale: string;
}

// --- Trade Recommendation ---

export interface TradeRecommendation {
  direction: 'buy' | 'sell' | 'hold';
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  risk_reward_ratio: number;
  position_size_lots: string;
  rationale: string;
}

// --- Risk Assessment ---

export interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  maxPositionSize: number;
  suggestedSL: number;  // 止损价格（支撑位 - ATR缓冲）
  suggestedTP?: number; // 止盈价格（阻力位或 Fib extension 目标）
  warnings: string[];
  addOn?: boolean;      // NEW: whether to add to existing same-side position
}

// --- Elliott Wave Analysis ---

export interface ElliottWaveSwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

export type ElliottWaveLabel = 1 | 2 | 3 | 4 | 5 | 'A' | 'B' | 'C';

export interface ElliottWaveSegment {
  wave: ElliottWaveLabel;
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  direction: 'up' | 'down';
  length: number;
}

export interface ElliottWaveValidation {
  isValid: boolean;
  violations: string[];
}

export interface ElliottWaveAnalysis {
  direction: 'bullish' | 'bearish';
  swingPoints: ElliottWaveSwingPoint[];
  impulseWaves: ElliottWaveSegment[];
  correctiveWaves: ElliottWaveSegment[];
  validation: ElliottWaveValidation;
  confidence: number; // 0-100
}

export interface WaveTargetLevels {
  level_1_618: number;
  level_2_0: number;
}

export interface WaveAnalystResult {
  wave_confirmation: 'confirmed' | 'partial' | 'rejected';
  extension_wave: 1 | 3 | 5 | null;
  corrective_type: 'zigzag' | 'flat' | 'triangle' | null;
  trend_strength: 'strong' | 'moderate' | 'weak';
  target_levels: WaveTargetLevels;
  confidence: number; // 0-100
  rationale: string;
}

// --- Chanlun Analysis ---

export interface ChanlunBar {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChanlunFractal {
  type: 'top' | 'bottom';
  index: number;
  price: number;
  confirmed: true;
}

export interface ChanlunStroke {
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  direction: 'up' | 'down';
  high: number;
  low: number;
}

export interface ChanlunHub {
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  strokeIndices: [number, number, number];
}

export interface ChanlunAnalysis {
  processedBars: ChanlunBar[];
  fractals: ChanlunFractal[];
  strokes: ChanlunStroke[];
  hubs: ChanlunHub[];
}

export interface ChanlunAnalystResult {
  trend: 'up' | 'down' | 'range';
  strength: 'strong' | 'moderate' | 'weak';
  latest_signal: 'buy' | 'sell' | 'hold';
  hub_state: 'forming' | 'active' | 'none';
  confidence: number; // 0-100
  rationale: string;
}

// --- Harmonic Pattern Analysis ---

export interface HarmonicAnalysisResult {
  detected_pattern: 'gartley' | 'bat' | 'butterfly' | 'crab' | 'abcd' | 'cypher' | 'shark' | 'none';
  direction: 'bullish' | 'bearish' | 'neutral';
  timeframe: string;           // e.g. "H4", "H1", "M30"
  completion_pct?: number;     // 0-100% — how close price is to the PRZ (D point)
  is_active?: boolean;
  confidence: number;          // 0-100 — LLM's confidence in the pattern
  d_zone_price: number;        // PRZ D-point reference price from detector
  entry_zone: string;          // e.g. "3265.50-3270.00"
  stop_loss: number;           // suggested SL below/above D
  take_profit_1: number;       // first TP target (38.2% or 61.8% retrace of CD)
  take_profit_2: number;       // second TP target (full CD extension)
  rationale: string;
}
