/**
 * Zod schemas for strict LLM output validation.
 * Ensures all numeric fields are valid numbers (never null/undefined).
 */

import { z } from 'zod';

// ── Lenient LLM Output Parser ──────────────────────────────────────────────
// Wraps strict Zod parsing with graceful fallback for missing fields.
// LLMs often skip optional fields — this prevents total workflow failure.

/**
 * Safely parse LLM output against a Zod schema, filling missing fields
 * with defaults instead of throwing on partial output.
 * Returns `null` on total parse failure (caller handles fallback).
 */
export function safeParseLLM<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  // Try strict first
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  // Fallback: partial parse — fill missing fields with undefined/defaults
  // Use 'as any' because ZodObject.partial() returns a different type
  const partialSchema = (schema as unknown as z.ZodObject<z.ZodRawShape>).partial();
  const partial = partialSchema.safeParse(raw);
  if (partial.success) return partial.data as unknown as T;

  return null;
}

// SRLevel schema - price must be valid number
export const SRLevelSchema = z.object({
  price: z.number().finite().positive(),
  type: z.enum(['support', 'resistance']),
  strength: z.enum(['strong', 'moderate', 'weak']),
  timeframe: z.string().min(1),
  touches: z.number().int().min(0).max(20),
});

// TechnicalAnalysis schema
export const TechnicalAnalysisSchema = z.object({
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().min(0).max(100),
  phase: z.enum(['trending', 'ranging', 'breakout', 'reversal', 'consolidation']),
  indicators_summary: z.string().min(1),
  support_levels: z.array(SRLevelSchema).max(6),
  resistance_levels: z.array(SRLevelSchema).max(6),
  recommendation: z.enum(['hold', 'close', 'partial_close', 'trail_stop', 'none']),
  rationale: z.string().min(1),
});

// SRLevels schema
export const SRLevelsSchema = z.object({
  support_levels: z.array(SRLevelSchema).max(6),
  resistance_levels: z.array(SRLevelSchema).max(6),
  recommendation: z.string(),
  rationale: z.string(),
});

// Dow Theory analysis schema
export const DowTheorySchema = z.object({
  primary_trend: z.enum(['bullish', 'bearish', 'neutral']),
  primary_phase: z.enum(['accumulation', 'markup', 'distribution', 'markdown']),
  secondary_trend: z.enum(['bullish', 'bearish', 'neutral']),
  short_term_trend: z.enum(['bullish', 'bearish', 'neutral']),
  multi_tf_confirm: z.boolean(),
  rationale: z.string().min(1),
});

// Wave Theory analysis schema
export const WaveTheorySchema = z.object({
  current_wave: z.string().min(1),
  wave_direction: z.enum(['impulse_up', 'impulse_down', 'corrective', 'unclear']),
  wave_count: z.string().min(1),
  next_target: z.string().min(1),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1),
});

// Chanlun Theory analysis schema
export const ChanlunTheorySchema = z.object({
  trend: z.enum(['up', 'down', 'range']),
  bi_direction: z.enum(['up', 'down', 'none']),
  duan_direction: z.enum(['up', 'down', 'none']),
  zhongshu_state: z.enum(['forming', 'active', 'breaking_up', 'breaking_down', 'none']),
  buy_sell_point: z.enum(['buy_1', 'buy_2', 'buy_3', 'sell_1', 'sell_2', 'sell_3', 'none']),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1),
});

// Harmonic Theory analysis schema
export const HarmonicTheorySchema = z.object({
  pattern: z.enum(['gartley', 'bat', 'butterfly', 'crab', 'abcd', 'cypher', 'shark', 'none']),
  direction: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1),
});

// Trade recommendation schema
export const TradeRecommendationSchema = z.object({
  direction: z.enum(['buy', 'sell', 'hold']),
  entry_price: z.number().finite(),
  stop_loss: z.number().finite(),
  take_profit_1: z.number().finite(),
  take_profit_2: z.number().finite().optional(),
  risk_reward_ratio: z.number().finite().min(0),
  position_size_lots: z.string().min(1),
  rationale: z.string().min(1),
});

// ArbitrationResult schema
export const ArbitrationResultSchema = z.object({
  final_direction: z.enum(['buy', 'sell', 'hold', 'close', 'dual']),
  confidence: z.number().min(0).max(100),
  primary_contradiction: z.string(),
  phase: z.string(),
  reasoning: z.string().min(1),
  action: z.enum(['open', 'close', 'modify', 'hold']),
  united_front_analysis: z.string(),
  dow_theory: DowTheorySchema.optional(),
  wave_theory: WaveTheorySchema.optional(),
  chanlun_theory: ChanlunTheorySchema.optional(),
  harmonic_theory: HarmonicTheorySchema.optional(),
  trade_recommendation: TradeRecommendationSchema.optional(),
});

// RiskAssessment schema
export const RiskAssessmentSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high', 'extreme']),
  maxPositionSize: z.number().finite().min(0),
  suggestedSL: z.number().finite().positive(),
  suggestedTP: z.number().finite().positive().optional(),  // 可选止盈目标
  warnings: z.array(z.string()),
  addOn: z.boolean().optional().default(false),
});

export const WaveTargetLevelsSchema = z.object({
  level_1_618: z.number().finite(),
  level_2_0: z.number().finite(),
});

export const WaveAnalystResultSchema = z.object({
  wave_confirmation: z.enum(['confirmed', 'partial', 'rejected']),
  extension_wave: z.union([z.literal(1), z.literal(3), z.literal(5), z.null()]),
  corrective_type: z.enum(['zigzag', 'flat', 'triangle']).nullable(),
  trend_strength: z.enum(['strong', 'moderate', 'weak']),
  target_levels: WaveTargetLevelsSchema,
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1),
});

export const ChanlunAnalystResultSchema = z.object({
  trend: z.enum(['up', 'down', 'range']),
  strength: z.enum(['strong', 'moderate', 'weak']),
  latest_signal: z.enum(['buy', 'sell', 'hold']),
  hub_state: z.enum(['forming', 'active', 'none']),
  confidence: z.number().min(0).max(100),
  rationale: z.string().min(1),
});

export const HarmonicAnalysisResultSchema = z.object({
  detected_pattern: z.enum(['gartley', 'bat', 'butterfly', 'crab', 'abcd', 'cypher', 'shark', 'none']),
  direction: z.enum(['bullish', 'bearish', 'neutral']),
  timeframe: z.string(),
  completion_pct: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
  confidence: z.number().min(0).max(100),
  d_zone_price: z.number(),
  entry_zone: z.string(),
  stop_loss: z.number(),
  take_profit_1: z.number(),
  take_profit_2: z.number(),
  rationale: z.string().min(1),
});

export const ComprehensiveAnalysisDataSchema = z.object({
  technical: TechnicalAnalysisSchema,
  wave: WaveAnalystResultSchema,
  chanlun: ChanlunAnalystResultSchema,
  harmonic: HarmonicAnalysisResultSchema,
  risk: RiskAssessmentSchema,
  arbitration: ArbitrationResultSchema,
});

// ── TradePlan schemas ─────────────────────────────────────────────────────────

export const TradePlanModeSchema = z.enum([
  'observe',
  'veto',
  'approve',
  'modify',
  'reduce',
  'close',
]);

export const TradePlanSideSchema = z.enum(['buy', 'sell', 'none']);

export const TradePlanEntryZoneSchema = z.object({
  min: z.number().finite().min(0),
  max: z.number().finite().min(0),
});

export const TradePlanSchema = z.object({
  schema_version: z.literal('trade_plan.v1'),
  decision_id: z.string().min(1),
  account_id: z.string().min(1),
  symbol: z.string().min(1),
  mode: TradePlanModeSchema,
  side: TradePlanSideSchema,
  confidence: z.number().int().min(0).max(100),
  entry_zone: TradePlanEntryZoneSchema,
  stop_loss: z.number().finite().min(0),
  take_profit: z.array(z.number().finite().min(0)),
  max_lots: z.number().finite().min(0),
  expires_at: z.string().datetime(),
  reason_codes: z.array(z.string().min(1)).min(1),
  conflicts: z.array(z.string()),
  narrative: z.string().min(1),
  add_on: z.boolean().optional().default(false),
}).superRefine((plan, ctx) => {
  if (plan.mode === 'observe' || plan.mode === 'veto') {
    return;
  }

  if (plan.side === 'none') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['side'],
      message: 'active trade plan mode requires buy or sell side',
    });
  }
  if (plan.entry_zone.min <= 0 || plan.entry_zone.max <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entry_zone'],
      message: 'active trade plan mode requires a positive entry zone',
    });
  }
  if (plan.entry_zone.min > plan.entry_zone.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entry_zone'],
      message: 'entry_zone.min must be <= entry_zone.max',
    });
  }
  if (plan.stop_loss <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stop_loss'],
      message: 'active trade plan mode requires a positive stop_loss',
    });
  }
  if (plan.take_profit.length === 0 || plan.take_profit.some((price) => price <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['take_profit'],
      message: 'active trade plan mode requires positive take_profit levels',
    });
  }
  if (plan.max_lots <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['max_lots'],
      message: 'active trade plan mode requires positive max_lots',
    });
  }
});

// Validation helper - strips null/undefined from arrays before validation
export function cleanSRLevels(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const obj = data as Record<string, unknown>;

  // Clean support_levels
  if (Array.isArray(obj.support_levels)) {
    obj.support_levels = obj.support_levels.filter(
      (level: unknown) => level && typeof level === 'object' &&
      (level as Record<string, unknown>).price != null &&
      typeof (level as Record<string, unknown>).price === 'number'
    );
  }

  // Clean resistance_levels
  if (Array.isArray(obj.resistance_levels)) {
    obj.resistance_levels = obj.resistance_levels.filter(
      (level: unknown) => level && typeof level === 'object' &&
      (level as Record<string, unknown>).price != null &&
      typeof (level as Record<string, unknown>).price === 'number'
    );
  }

  return obj;
}

// ── Goldbot Payload schemas ────────────────────────────────────────────────────

export const IndicatorPackSchema = z.object({
  close: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  ema20: z.number(),
  ema50: z.number(),
  ema200: z.number().optional(),
  rsi: z.number(),
  adx: z.number(),
  atr: z.number(),
  macd: z.number(),
  macd_signal: z.number(),
  macd_hist: z.number(),
  bb_upper: z.number(),
  bb_middle: z.number(),
  bb_lower: z.number(),
  stoch_k: z.number(),
  stoch_d: z.number(),
  vol_sma: z.number().optional(),
  fib_236: z.number().optional(),
  fib_382: z.number().optional(),
  fib_500: z.number().optional(),
  fib_618: z.number().optional(),
  fib_786: z.number().optional(),
  pp: z.number().optional(),
  r1: z.number().optional(),
  s1: z.number().optional(),
  bars_count: z.number().optional(),
});

export const MarketDataSchema = z.object({
  symbol: z.string().min(1),
  bid: z.number(),
  ask: z.number(),
  spread: z.number(),
  time: z.string().optional(),
});

// AccountInfoSchema - matches Go API aurex.AccountSummary (snake_case)
export const AccountInfoSchema = z.object({
  account_id: z.string().min(1),
  equity: z.number().finite(),
  balance: z.number().finite(),
  margin: z.number().finite(),
  free_margin: z.number().finite(),
  currency: z.string().min(1),
  leverage: z.number().int().min(0), // 允许 0（API 可能返回未设置值）
  broker: z.string().optional(),
  server_name: z.string().optional(),
  connected: z.boolean().optional(),
});

// PositionInfoSchema - matches Go API aurex.PositionSummary
export const PositionInfoSchema = z.object({
  ticket: z.number().int().positive(),
  strategy: z.string().min(1),
  magic: z.number().int().optional(),
  direction: z.enum(['buy', 'sell', 'BUY', 'SELL']),
  entry_price: z.number().finite().positive(),
  current_price: z.number().finite().positive(),
  lots: z.number().positive(),
  profit: z.number().finite(),
  pnl_percent: z.number().finite().optional(),
  sl: z.number().finite(),
  tp: z.number().finite(),
  hold_seconds: z.number().int().optional(),
  hold_hours: z.number().finite().optional(),
  comment: z.string().optional(),
});

// MarketStatusSchema - matches Go API aurex.MarketStatus
export const MarketStatusSchema = z.object({
  market_open: z.boolean(),
  is_trade_allowed: z.boolean(),
  mt4_server_time: z.string().optional(),
  tradeable: z.boolean(),
});

export const MarketFilterSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['blocking', 'warning']),
  message: z.string().optional(),
});

export const MarketFiltersSchema = z.object({
  blocked: z.boolean().default(false),
  blocking: z.array(MarketFilterSchema).nullable().default([]),
  warnings: z.array(MarketFilterSchema).nullable().default([]),
  reason_codes: z.array(z.string().min(1)).nullable().default([]),
});

// StrategyMappingSchema - Go API returns simple map[string]string
export const StrategyMappingSchema = z.record(z.string(), z.string());

// PendingSignalSchema - matches Go API pending signal format
export const PendingSignalSchema = z.object({
  id: z.number().int().positive(),
  account_id: z.string().min(1),
  symbol: z.string().min(1),
  side: z.preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['buy', 'sell', 'close']),
  ),
  score: z.number().int().min(0),
  strategy: z.string(),
  indicators: z.string(),
  status: z.string(),
  created_at: z.string().min(1),
  expires_at: z.string().min(1),
  arbitration_result: z.string(),
  arbitration_reason: z.string(),
});

export const GoldbotBarSchema = z.object({
  time: z.string().min(1),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().finite().optional(),
  ema20: z.number().finite().optional(),
  ema50: z.number().finite().optional(),
  ema200: z.number().finite().optional(),
  atr: z.number().finite().optional(),
  rsi: z.number().finite().optional(),
  macd: z.number().finite().optional(),
  macd_signal: z.number().finite().optional(),
  macd_hist: z.number().finite().optional(),
  adx: z.number().finite().optional(),
  bb_upper: z.number().finite().optional(),
  bb_lower: z.number().finite().optional(),
  bb_mid: z.number().finite().optional(),
  stoch_k: z.number().finite().optional(),
  stoch_d: z.number().finite().optional(),
  vol_sma: z.number().finite().optional(),
  fib_236: z.number().finite().optional(),
  fib_382: z.number().finite().optional(),
  fib_500: z.number().finite().optional(),
  fib_618: z.number().finite().optional(),
  fib_786: z.number().finite().optional(),
  pp: z.number().finite().optional(),
  r1: z.number().finite().optional(),
  r2: z.number().finite().optional(),
  s1: z.number().finite().optional(),
  s2: z.number().finite().optional(),
  candlestick_patterns: z.array(z.string().min(1)).optional(),
});

// HarmonicPatternSchema - matches Go harmonic.HarmonicPattern
const HarmonicPatternSchema = z.object({
  type: z.string(),
  direction: z.string(),
  timeframe: z.string(),
  score: z.number(),
  x_price: z.number(),
  a_price: z.number(),
  b_price: z.number(),
  c_price: z.number(),
  d_price: z.number(),
  ab_ratio: z.number(),
  bc_ratio: z.number(),
  cd_ratio: z.number(),
  xd_ratio: z.number(),
  completion_pct: z.number().optional(),
  is_active: z.boolean().optional(),
  reason: z.string(),
});

const HarmonicContextSchema = z.object({
  h4_patterns: z.array(HarmonicPatternSchema),
  h1_patterns: z.array(HarmonicPatternSchema),
  m30_patterns: z.array(HarmonicPatternSchema),
  active_pattern: HarmonicPatternSchema.nullable().optional(),
  direction_bias: z.string(),
  score: z.number(),
  summary: z.string(),
});

const TrendContextSchema = z.object({
  d1_direction: z.string(),
  h4_direction: z.string(),
  h1_direction: z.string(),
  m30_direction: z.string(),
  consensus_direction: z.string(),
  consensus_strength: z.number(),
});

// GoldbotPayloadSchema - matches Go API aurex.AnalysisPayload
export const GoldbotPayloadSchema = z.object({
  status: z.string().optional(),
  timestamp: z.string().optional(),
  account: AccountInfoSchema,
  market: MarketDataSchema,
  positions: z.array(PositionInfoSchema),
  indicators: z.record(IndicatorPackSchema.nullable()),
  market_status: MarketStatusSchema,
  market_filters: MarketFiltersSchema.optional(),
  strategy_mapping: StrategyMappingSchema,
  bars: z.record(z.array(GoldbotBarSchema)).optional(),
  trend_context: TrendContextSchema.nullable().optional(),
  harmonic_context: HarmonicContextSchema.nullable().optional(),
});
