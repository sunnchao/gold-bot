// --- Bar Data (legacy, kept for compatibility) ---

export interface BarData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Indicator Pack (matches gold-bot v2 payload) ---

export interface IndicatorPack {
  close: number;
  open: number;
  high: number;
  low: number;
  ema20: number;
  ema50: number;
  ema200?: number;
  rsi: number;
  adx: number;
  atr: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  bb_upper: number;
  bb_middle: number;
  bb_lower: number;
  stoch_k: number;
  stoch_d: number;
  vol_sma?: number;
  fib_236?: number;
  fib_382?: number;
  fib_500?: number;
  fib_618?: number;
  fib_786?: number;
  pp?: number;
  r1?: number;
  s1?: number;
  bars_count?: number;
  // Divergence indicators (from gold-bot indicator engine)
  macd_divergence?: 'bullish' | 'bearish' | null;
  rsi_divergence?: 'bullish' | 'bearish' | null;
}

// --- Market Data ---

export interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  time?: string;
}

// --- Account Info (matches Go API aurex.AccountSummary, snake_case) ---

export interface AccountInfo {
  account_id: string;
  equity: number;
  balance: number;
  margin: number;
  free_margin: number;
  currency: string;
  leverage: number;
  broker?: string;
  server_name?: string;
  connected?: boolean;
}

// --- Position Info (matches Go API aurex.PositionSummary) ---

export interface PositionInfo {
  ticket: number;
  strategy: string;
  magic?: number;
  direction: 'buy' | 'sell' | 'BUY' | 'SELL';
  entry_price: number;
  current_price: number;
  lots: number;
  profit: number;
  pnl_percent?: number;
  sl: number;
  tp: number;
  hold_seconds?: number;
  hold_hours?: number;
  comment?: string;
}

// --- Market Status (matches Go API aurex.MarketStatus) ---

export interface MarketStatus {
  market_open: boolean;
  is_trade_allowed: boolean;
  mt4_server_time?: string;
  tradeable: boolean;
}

export interface MarketFilter {
  code: string;
  severity: 'blocking' | 'warning';
  message?: string;
}

export interface MarketFilters {
  blocked: boolean;
  blocking: MarketFilter[] | null;
  warnings: MarketFilter[] | null;
  reason_codes: string[] | null;
}

// --- Strategy Mapping (Go API returns simple map[string]string) ---

export type StrategyMapping = Record<string, string>;

// --- Pending Signal ---

export interface PendingSignal {
  id: number;
  account_id: string;
  symbol: string;
  side: 'buy' | 'sell' | 'close';
  score: number;
  strategy: string;
  indicators: string;
  status: string;
  created_at: string;
  expires_at: string;
  arbitration_result: string;
  arbitration_reason: string;
}

// --- Rich Bar Data (matches Go domain.Bar fields exposed in v2 payload) ---

export interface GoldbotBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  atr?: number;
  rsi?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  adx?: number;
  bb_upper?: number;
  bb_lower?: number;
  bb_mid?: number;
  stoch_k?: number;
  stoch_d?: number;
  vol_sma?: number;
  fib_236?: number;
  fib_382?: number;
  fib_500?: number;
  fib_618?: number;
  fib_786?: number;
  pp?: number;
  r1?: number;
  r2?: number;
  s1?: number;
  s2?: number;
  candlestick_patterns?: string[];
}

// --- Harmonic Pattern (matches Go harmonic.HarmonicPattern) ---

export interface HarmonicPattern {
  type: string;         // "gartley"|"bat"|"butterfly"|"crab"|"abcd"|"cypher"|"shark"
  direction: string;    // "bullish"|"bearish"
  timeframe: string;    // "H4"|"H1"|"M30"
  score: number;        // 0-100
  x_price: number;
  a_price: number;
  b_price: number;
  c_price: number;
  d_price: number;
  ab_ratio: number;
  bc_ratio: number;
  cd_ratio: number;
  xd_ratio: number;
  completion_pct?: number;
  is_active?: boolean;
  reason: string;
}

export interface HarmonicContextPayload {
  h4_patterns: HarmonicPattern[];
  h1_patterns: HarmonicPattern[];
  m30_patterns: HarmonicPattern[];
  active_pattern?: HarmonicPattern | null;
  direction_bias: string;   // "bullish"|"bearish"|"neutral"
  score: number;
  summary: string;
}

// --- Trend Context (matches Go aurex.TrendContextPayload) ---

export interface TrendContextPayload {
  d1_direction: string;
  h4_direction: string;
  h1_direction: string;
  m30_direction: string;
  consensus_direction: string;
  consensus_strength: number;
}

// --- Goldbot Payload ---

export interface GoldbotPayload {
  status?: string;
  timestamp?: string;
  account: AccountInfo;
  market: MarketData;
  indicators: Record<string, IndicatorPack | null>;
  positions: PositionInfo[];
  market_status: MarketStatus;
  market_filters?: MarketFilters;
  strategy_mapping: StrategyMapping;
  bars?: Record<string, GoldbotBar[]>;
  trend_context?: TrendContextPayload | null;
  harmonic_context?: HarmonicContextPayload | null;
}
