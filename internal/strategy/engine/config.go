package engine

type FibExtensionTPConfig struct {
	Enabled         bool    `json:"enabled" yaml:"enabled"`
	MinADX          float64 `json:"min_adx" yaml:"min_adx"`
	SwingWindow     int     `json:"swing_window" yaml:"swing_window"`
	UseH4Preference bool    `json:"use_h4_preference" yaml:"use_h4_preference"`
}

type PullbackFibConfig struct {
	RetracementEnabled      bool    `json:"retracement_enabled" yaml:"retracement_enabled"`
	GoldenPocketBufferATR   float64 `json:"golden_pocket_buffer_atr" yaml:"golden_pocket_buffer_atr"`
	RequireRSIConfirm       bool    `json:"require_rsi_confirm" yaml:"require_rsi_confirm"`
	RSIConfirmBullThreshold float64 `json:"rsi_confirm_bull_threshold" yaml:"rsi_confirm_bull_threshold"`
	RSIConfirmBearThreshold float64 `json:"rsi_confirm_bear_threshold" yaml:"rsi_confirm_bear_threshold"`
	StopLossOuterATR        float64 `json:"stop_loss_outer_atr" yaml:"stop_loss_outer_atr"`
	UsePendingOrder         bool    `json:"use_pending_order" yaml:"use_pending_order"`
	PendingOrderLevel       string  `json:"pending_order_level" yaml:"pending_order_level"`
}

// StrategyConfig holds all configurable parameters for the strategy engine.
type StrategyConfig struct {
	// Pullback strategy
	PullbackMinADX        float64 `json:"pullback_min_adx" yaml:"pullback_min_adx"`
	PullbackRSIOversold   float64 `json:"pullback_rsi_oversold" yaml:"pullback_rsi_oversold"`
	PullbackRSIOverbought float64 `json:"pullback_rsi_overbought" yaml:"pullback_rsi_overbought"`
	PullbackDistATR       float64 `json:"pullback_dist_atr" yaml:"pullback_dist_atr"`
	PullbackADXBonus      float64 `json:"pullback_adx_bonus" yaml:"pullback_adx_bonus"`
	PullbackSLATR         float64 `json:"pullback_sl_atr" yaml:"pullback_sl_atr"`
	PullbackTP1ATR        float64 `json:"pullback_tp1_atr" yaml:"pullback_tp1_atr"`
	PullbackTP2ATR        float64 `json:"pullback_tp2_atr" yaml:"pullback_tp2_atr"`

	// BreakoutRetest strategy
	BreakoutRetestLookback      int     `json:"breakout_retest_lookback" yaml:"breakout_retest_lookback"`
	BreakoutRetestConfirmWindow int     `json:"breakout_retest_confirm_window" yaml:"breakout_retest_confirm_window"`
	BreakoutRetestDistATR       float64 `json:"breakout_retest_dist_atr" yaml:"breakout_retest_dist_atr"`
	BreakoutRetestSLATR         float64 `json:"breakout_retest_sl_atr" yaml:"breakout_retest_sl_atr"`
	BreakoutRetestTP1ATR        float64 `json:"breakout_retest_tp1_atr" yaml:"breakout_retest_tp1_atr"`
	BreakoutRetestTP2ATR        float64 `json:"breakout_retest_tp2_atr" yaml:"breakout_retest_tp2_atr"`

	// Divergence strategy
	DivergenceWindowRecent  int     `json:"divergence_window_recent" yaml:"divergence_window_recent"`
	DivergenceWindowPrev    int     `json:"divergence_window_prev" yaml:"divergence_window_prev"`
	DivergenceRSIBullThresh float64 `json:"divergence_rsi_bull_thresh" yaml:"divergence_rsi_bull_thresh"`
	DivergenceRSIBearThresh float64 `json:"divergence_rsi_bear_thresh" yaml:"divergence_rsi_bear_thresh"`
	DivergenceSLATR         float64 `json:"divergence_sl_atr" yaml:"divergence_sl_atr"`
	DivergenceTP1ATR        float64 `json:"divergence_tp1_atr" yaml:"divergence_tp1_atr"`
	DivergenceTP2ATR        float64 `json:"divergence_tp2_atr" yaml:"divergence_tp2_atr"`

	// BreakoutPyramid strategy
	BreakoutPyramidMinADX        float64 `json:"breakout_pyramid_min_adx" yaml:"breakout_pyramid_min_adx"`
	BreakoutPyramidSLATR         float64 `json:"breakout_pyramid_sl_atr" yaml:"breakout_pyramid_sl_atr"`
	BreakoutPyramidMinSpacingATR float64 `json:"breakout_pyramid_min_spacing_atr" yaml:"breakout_pyramid_min_spacing_atr"`

	// ScaleIn strategy
	ScaleInEnabled         bool    `json:"scale_in_enabled" yaml:"scale_in_enabled"`
	ScaleInMinADX          float64 `json:"scale_in_min_adx" yaml:"scale_in_min_adx"`
	ScaleInMinDistATR      float64 `json:"scale_in_min_dist_atr" yaml:"scale_in_min_dist_atr"`
	ScaleInMinFloatLossATR float64 `json:"scale_in_min_float_loss_atr" yaml:"scale_in_min_float_loss_atr"`
	ScaleInMaxAddCount     int     `json:"scale_in_max_add_count" yaml:"scale_in_max_add_count"`
	ScaleInLotDecay        float64 `json:"scale_in_lot_decay" yaml:"scale_in_lot_decay"`
	ScaleInSLATR           float64 `json:"scale_in_sl_atr" yaml:"scale_in_sl_atr"`
	ScaleInTP1ATR          float64 `json:"scale_in_tp1_atr" yaml:"scale_in_tp1_atr"`
	ScaleInTP2ATR          float64 `json:"scale_in_tp2_atr" yaml:"scale_in_tp2_atr"`
	ScaleInMinIntervalMin  int     `json:"scale_in_min_interval_min" yaml:"scale_in_min_interval_min"`
	ScaleInMaxFloatLossPct float64 `json:"scale_in_max_float_loss_pct" yaml:"scale_in_max_float_loss_pct"`

	// SR-based SL/TP
	SRBufferATR  float64 `json:"sr_buffer_atr" yaml:"sr_buffer_atr"`
	SRMaxDistATR float64 `json:"sr_max_dist_atr" yaml:"sr_max_dist_atr"`
	SRMinDistATR float64 `json:"sr_min_dist_atr" yaml:"sr_min_dist_atr"`

	// H4 trend filter
	H4ADXThreshold       float64 `json:"h4_adx_threshold" yaml:"h4_adx_threshold"`
	H4RequireConsecutive int     `json:"h4_require_consecutive" yaml:"h4_require_consecutive"`

	// M15 confirmation
	M15ConfirmRSIThreshold float64 `json:"m15_confirm_rsi_threshold" yaml:"m15_confirm_rsi_threshold"`

	// Minimum signal score
	MinScore int `json:"min_score" yaml:"min_score"`

	// MomentumScalp strategy
	MomentumScalpMinADX           float64 `json:"momentum_scalp_min_adx" yaml:"momentum_scalp_min_adx"`
	MomentumScalpEMAPeriod1       int     `json:"momentum_scalp_ema_period_1" yaml:"momentum_scalp_ema_period_1"`
	MomentumScalpEMAPeriod2       int     `json:"momentum_scalp_ema_period_2" yaml:"momentum_scalp_ema_period_2"`
	MomentumScalpEMAPeriod3       int     `json:"momentum_scalp_ema_period_3" yaml:"momentum_scalp_ema_period_3"`
	MomentumScalpRSIBullThresh    float64 `json:"momentum_scalp_rsi_bull_thresh" yaml:"momentum_scalp_rsi_bull_thresh"`
	MomentumScalpRSIBearThresh    float64 `json:"momentum_scalp_rsi_bear_thresh" yaml:"momentum_scalp_rsi_bear_thresh"`
	MomentumScalpRSICrossoverBull float64 `json:"momentum_scalp_rsi_crossover_bull" yaml:"momentum_scalp_rsi_crossover_bull"`
	MomentumScalpRSICrossoverBear float64 `json:"momentum_scalp_rsi_crossover_bear" yaml:"momentum_scalp_rsi_crossover_bear"`
	MomentumScalpSLATR            float64 `json:"momentum_scalp_sl_atr" yaml:"momentum_scalp_sl_atr"`
	MomentumScalpTP1ATR           float64 `json:"momentum_scalp_tp1_atr" yaml:"momentum_scalp_tp1_atr"`
	MomentumScalpTP2ATR           float64 `json:"momentum_scalp_tp2_atr" yaml:"momentum_scalp_tp2_atr"`
	MomentumScalpVolConfirm       float64 `json:"momentum_scalp_vol_confirm" yaml:"momentum_scalp_vol_confirm"`
	MomentumScalpMinScore         int     `json:"momentum_scalp_min_score" yaml:"momentum_scalp_min_score"`
	MomentumScalpMaxHoldingMin    int     `json:"momentum_scalp_max_holding_min" yaml:"momentum_scalp_max_holding_min"`

		FibExtension FibExtensionTPConfig `json:"fib_extension" yaml:"fib_extension"`
		PullbackFib PullbackFibConfig     `json:"pullback_fib" yaml:"pullback_fib"`
		Trend       TrendConfig           `json:"trend" yaml:"trend"`
	}

	// TrendConfig holds multi-timeframe trend aggregation parameters.
	type TrendConfig struct {
		D1Weight  float64 `json:"d1_weight" yaml:"d1_weight"`   // 0.05
		H4Weight  float64 `json:"h4_weight" yaml:"h4_weight"`   // 0.25
		H1Weight  float64 `json:"h1_weight" yaml:"h1_weight"`   // 0.35
		M30Weight float64 `json:"m30_weight" yaml:"m30_weight"` // 0.35

		SoftThreshold   float64 `json:"soft_threshold" yaml:"soft_threshold"`     // 0.30
		MediumThreshold float64 `json:"medium_threshold" yaml:"medium_threshold"` // 0.15

		WeakADXThreshold   float64 `json:"weak_adx_threshold" yaml:"weak_adx_threshold"`     // 20
		StrongADXThreshold float64 `json:"strong_adx_threshold" yaml:"strong_adx_threshold"` // 30

		Enabled bool `json:"enabled" yaml:"enabled"` // true
	}

	// DefaultTrendConfig returns the default multi-timeframe trend config.
	func DefaultTrendConfig() TrendConfig {
		return TrendConfig{
			D1Weight:  0.05,
			H4Weight:  0.25,
			H1Weight:  0.35,
			M30Weight: 0.35,

			SoftThreshold:   0.30,
			MediumThreshold: 0.15,

			WeakADXThreshold:   20,
			StrongADXThreshold: 30,

			Enabled: true,
		}
	}

// DefaultStrategyConfig returns the recommended strategy parameters.
func DefaultStrategyConfig() StrategyConfig {
	return StrategyConfig{
		// Pullback - tightened from original
		PullbackMinADX:        25.0,
		PullbackRSIOversold:   30.0,
		PullbackRSIOverbought: 70.0,
		PullbackDistATR:       0.5,
		PullbackADXBonus:      30.0,
		PullbackSLATR:         1.5,
		PullbackTP1ATR:        1.5,
		PullbackTP2ATR:        3.0,

		// BreakoutRetest - tightened lookback, widened SL
		BreakoutRetestLookback:      50,
		BreakoutRetestConfirmWindow: 3,
		BreakoutRetestDistATR:       0.5,
		BreakoutRetestSLATR:         1.5,
		BreakoutRetestTP1ATR:        2.0,
		BreakoutRetestTP2ATR:        4.0,

		// Divergence - wider windows, wider SL
		DivergenceWindowRecent:  15,
		DivergenceWindowPrev:    15,
		DivergenceRSIBullThresh: 40.0,
		DivergenceRSIBearThresh: 60.0,
		DivergenceSLATR:         1.0,
		DivergenceTP1ATR:        2.0,
		DivergenceTP2ATR:        4.0,

		// BreakoutPyramid - higher ADX, wider SL, wider spacing
		BreakoutPyramidMinADX:        30.0,
		BreakoutPyramidSLATR:         1.5,
		BreakoutPyramidMinSpacingATR: 2.0,

		ScaleInEnabled:         true,
		ScaleInMinADX:          25.0,
		ScaleInMinDistATR:      1.5,
		ScaleInMinFloatLossATR: 0.5,
		ScaleInMaxAddCount:     2,
		ScaleInLotDecay:        0.6,
		ScaleInSLATR:           1.2,
		ScaleInTP1ATR:          1.5,
		ScaleInTP2ATR:          3.0,
		ScaleInMinIntervalMin:  30,
		ScaleInMaxFloatLossPct: 5.0,

		SRBufferATR:  0.5,
		SRMaxDistATR: 3.0,
		SRMinDistATR: 0.3,

		// H4 trend - higher threshold, require 3 bars
		H4ADXThreshold:       30.0,
		H4RequireConsecutive: 3,

		// M15 confirmation - RSI threshold for early entry (40=bullish, 60=bearish)
		M15ConfirmRSIThreshold: 40.0,

		MinScore: 5,

		MomentumScalpMinADX:           20.0,
		MomentumScalpEMAPeriod1:       5,
		MomentumScalpEMAPeriod2:       8,
		MomentumScalpEMAPeriod3:       12,
		MomentumScalpRSIBullThresh:    45.0,
		MomentumScalpRSIBearThresh:    55.0,
		MomentumScalpRSICrossoverBull: 48.0,
		MomentumScalpRSICrossoverBear: 52.0,
		MomentumScalpSLATR:            0.4,
		MomentumScalpTP1ATR:           0.5,
		MomentumScalpTP2ATR:           0.8,
		MomentumScalpVolConfirm:       1.05,
		MomentumScalpMinScore:         7,
		MomentumScalpMaxHoldingMin:    20,

		FibExtension: FibExtensionTPConfig{
			Enabled:         false,
			MinADX:          25.0,
			SwingWindow:     50,
			UseH4Preference: true,
		},
				PullbackFib: PullbackFibConfig{
					RetracementEnabled:      false,
					GoldenPocketBufferATR:   0.5,
					RequireRSIConfirm:       false,
					RSIConfirmBullThreshold: 40,
					RSIConfirmBearThreshold: 60,
					StopLossOuterATR:        0.5,
					UsePendingOrder:         false,
					PendingOrderLevel:       "618",
				},
				Trend: DefaultTrendConfig(),
			}
}

// GetStrategyConfigBySymbol returns the strategy config for a given base symbol.
// Falls back to default config if no specific config is found.
func GetStrategyConfigBySymbol(baseSymbol string) StrategyConfig {
	switch baseSymbol {
	case "XAUUSD", "GOLD":
		return GoldStrategyConfig()
	case "GBPJPY":
		return GBPJPYStrategyConfig()
	case "EURJPY":
		return JPYCrossStrategyConfig() // EURJPY shares GBPJPY characteristics
	case "USDJPY":
		return JPYCrossStrategyConfig() // USDJPY also a JPY cross
	case "EURUSD":
		return EURUSDStrategyConfig()
	case "GBPUSD":
		return GBPUSDStrategyConfig()
	case "USDCAD":
		return USDCADStrategyConfig()
	default:
		return DefaultStrategyConfig()
	}
}

// GoldStrategyConfig returns strategy parameters optimized for gold trading.
func GoldStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// Gold-specific adjustments
	cfg.PullbackMinADX = 25.0
	cfg.PullbackSLATR = 1.5
	cfg.PullbackTP1ATR = 1.5
	cfg.PullbackTP2ATR = 3.0
	cfg.MomentumScalpMinADX = 18.0
	cfg.MomentumScalpVolConfirm = 1.05
	cfg.MomentumScalpMinScore = 6
	cfg.FibExtension.MinADX = 25.0
	cfg.PullbackFib.RetracementEnabled = true
	return cfg
}

// GBPJPYStrategyConfig returns strategy parameters optimized for GBPJPY trading.
// GBPJPY is a high-volatility JPY cross with wide daily ranges (100-200+ pips)
// and frequent false breakouts. Parameters are tuned for:
// - Wider SL/TP to accommodate larger swings
// - Lower H4 ADX threshold (GBPJPY rarely sustains ADX 30+)
// - Relaxed MomentumScalp (M1 ATR too small for meaningful targets)
func GBPJPYStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()

	// === H4 trend filter: GBPJPY ADX rarely stays above 30 ===
	cfg.H4ADXThreshold = 22.0    // was 30 — too strict for JPY crosses
	cfg.H4RequireConsecutive = 2 // was 3 — GBPJPY trends are choppier

	// === Pullback: ensure TP1:SL > 1.5 for positive expectancy ===
	cfg.PullbackMinADX = 20.0        // was 22 — GBPJPY ADX baseline is lower
	cfg.PullbackRSIOversold = 35.0   // was 30 — wider RSI range for GBPJPY
	cfg.PullbackRSIOverbought = 65.0 // was 70
	cfg.PullbackDistATR = 0.6        // was 0.5 — GBPJPY pulls back further
	cfg.PullbackADXBonus = 25.0      // was 30
	cfg.PullbackSLATR = 1.8          // was 1.2 — too tight, gets stopped out
	cfg.PullbackTP1ATR = 2.0         // was 1.2 — need TP1:SL > 1.5
	cfg.PullbackTP2ATR = 3.5         // was 2.5 — wider profit target

	// === BreakoutRetest: wider SL to survive false breakouts ===
	cfg.BreakoutRetestLookback = 40     // was 50 — S/R changes faster on GBPJPY
	cfg.BreakoutRetestConfirmWindow = 2 // was 3
	cfg.BreakoutRetestDistATR = 0.7     // was 0.5
	cfg.BreakoutRetestSLATR = 2.0       // was 1.5 — false breakouts are common
	cfg.BreakoutRetestTP1ATR = 2.5      // was 2.0
	cfg.BreakoutRetestTP2ATR = 4.5      // was 4.0

	// === Divergence: shorter windows, wider thresholds ===
	cfg.DivergenceWindowRecent = 12    // was 15 — GBPJPY moves faster
	cfg.DivergenceWindowPrev = 12      // was 15
	cfg.DivergenceRSIBullThresh = 45.0 // was 40 — wider RSI range
	cfg.DivergenceRSIBearThresh = 55.0 // was 60
	cfg.DivergenceSLATR = 1.5          // was 1.0
	cfg.DivergenceTP1ATR = 2.5         // was 2.0
	cfg.DivergenceTP2ATR = 4.5         // was 4.0

	// === BreakoutPyramid: lower ADX bar, wider SL ===
	cfg.BreakoutPyramidMinADX = 25.0       // was 30
	cfg.BreakoutPyramidSLATR = 2.0         // was 1.5
	cfg.BreakoutPyramidMinSpacingATR = 2.5 // was 2.0

	// === ScaleIn: wider spacing for volatile moves ===
	cfg.ScaleInMinADX = 20.0    // was 25
	cfg.ScaleInMinDistATR = 1.8 // was 1.5
	cfg.ScaleInSLATR = 1.8      // was 1.2
	cfg.ScaleInTP1ATR = 2.0     // was 1.5
	cfg.ScaleInTP2ATR = 3.5     // was 3.0

	// === MomentumScalp: M1 ATR too small for GBPJPY, use wider params ===
	cfg.MomentumScalpMinADX = 18.0           // was 18
	cfg.MomentumScalpSLATR = 0.8             // was 0.4 — 0.4 M1-ATR ≈ 1-3 pips, instant stop
	cfg.MomentumScalpTP1ATR = 1.0            // was 0.5
	cfg.MomentumScalpTP2ATR = 1.5            // was 0.8
	cfg.MomentumScalpMinScore = 7            // was 7 — requires strong signal
	cfg.MomentumScalpMaxHoldingMin = 45      // was 20 — GBPJPY needs more time to develop
	cfg.MomentumScalpRSIBullThresh = 42.0    // was 45
	cfg.MomentumScalpRSIBearThresh = 58.0    // was 55
	cfg.MomentumScalpRSICrossoverBull = 46.0 // was 48
	cfg.MomentumScalpRSICrossoverBear = 54.0 // was 52
	cfg.MomentumScalpVolConfirm = 1.02       // was 1.05 — volume less reliable on forex

	// === M15 confirmation ===
	cfg.M15ConfirmRSIThreshold = 45.0 // was 40 — more lenient for GBPJPY

	// === Global ===
	cfg.MinScore = 5 // was 5
	cfg.FibExtension.MinADX = 28.0
	cfg.PullbackFib.RetracementEnabled = true
	cfg.PullbackFib.GoldenPocketBufferATR = 0.3

	return cfg
}

// JPYCrossStrategyConfig returns strategy parameters optimized for JPY crosses
// (EURJPY, USDJPY). These pairs share GBPJPY's characteristics:
// - High volatility, frequent false breakouts
// - Lower ADX baselines than gold/major pairs
// - Volume data less reliable than gold
//
// Uses GBPJPY config as base. Override per-pair if needed:
//   - EURJPY: slightly lower volatility than GBPJPY, may need tighter SL
//   - USDJPY: more liquid, tighter spreads, can use slightly tighter params
func JPYCrossStrategyConfig() StrategyConfig {
	// Start with GBPJPY config as the JPY cross baseline
	// Individual pairs can diverge if backtesting shows differences
	cfg := GBPJPYStrategyConfig()
	return cfg
}

// EURUSDStrategyConfig returns strategy parameters optimized for EURUSD trading.
func EURUSDStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// EURUSD: most liquid pair, tighter ranges, lower volatility
	cfg.H4ADXThreshold = 20.0
	cfg.H4RequireConsecutive = 2
	cfg.PullbackMinADX = 20.0
	cfg.PullbackSLATR = 1.0
	cfg.PullbackTP1ATR = 1.5
	cfg.PullbackTP2ATR = 2.5
	cfg.PullbackDistATR = 0.4
	cfg.BreakoutRetestSLATR = 1.2
	cfg.BreakoutRetestTP1ATR = 1.8
	cfg.BreakoutRetestTP2ATR = 3.5
	cfg.DivergenceSLATR = 0.8
	cfg.DivergenceTP1ATR = 1.5
	cfg.DivergenceTP2ATR = 3.0
	cfg.BreakoutPyramidMinADX = 25.0
	cfg.ScaleInSLATR = 1.0
	cfg.ScaleInTP1ATR = 1.5
	cfg.ScaleInTP2ATR = 2.5
	cfg.MomentumScalpMinADX = 15.0
	cfg.MomentumScalpSLATR = 0.3
	cfg.MomentumScalpTP1ATR = 0.5
	cfg.MomentumScalpTP2ATR = 0.8
	cfg.MomentumScalpMinScore = 6
	cfg.MomentumScalpMaxHoldingMin = 25
	cfg.M15ConfirmRSIThreshold = 40.0
	cfg.MinScore = 5
	return cfg
}

// GBPUSDStrategyConfig returns strategy parameters for GBPUSD.
// GBPUSD is a major pair with moderate volatility — wider SL than EURUSD
// but tighter than JPY crosses.
func GBPUSDStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// H4 filter
	cfg.H4ADXThreshold = 22.0
	cfg.H4RequireConsecutive = 2
	// Pullback
	cfg.PullbackMinADX = 20.0
	cfg.PullbackSLATR = 1.3
	cfg.PullbackTP1ATR = 1.8
	cfg.PullbackTP2ATR = 3.0
	cfg.PullbackDistATR = 0.5
	// BreakoutRetest
	cfg.BreakoutRetestSLATR = 1.5
	cfg.BreakoutRetestTP1ATR = 2.0
	cfg.BreakoutRetestTP2ATR = 4.0
	// Divergence
	cfg.DivergenceSLATR = 1.0
	cfg.DivergenceTP1ATR = 2.0
	cfg.DivergenceTP2ATR = 3.5
	// BreakoutPyramid
	cfg.BreakoutPyramidMinADX = 28.0
	cfg.BreakoutPyramidSLATR = 1.5
	// ScaleIn
	cfg.ScaleInSLATR = 1.3
	cfg.ScaleInTP1ATR = 1.8
	cfg.ScaleInTP2ATR = 3.0
	// MomentumScalp
	cfg.MomentumScalpMinADX = 16.0
	cfg.MomentumScalpSLATR = 0.5
	cfg.MomentumScalpTP1ATR = 0.7
	cfg.MomentumScalpTP2ATR = 1.0
	cfg.MomentumScalpMinScore = 6
	cfg.MomentumScalpMaxHoldingMin = 30
	cfg.M15ConfirmRSIThreshold = 42.0
	cfg.MinScore = 5
	return cfg
}

// USDCADStrategyConfig returns strategy parameters for USDCAD.
// USDCAD is an oil-correlated pair with moderate volatility,
// trending behavior, and good ADX readings.
func USDCADStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// H4 filter — USDCAD trends well, can use higher ADX
	cfg.H4ADXThreshold = 25.0
	cfg.H4RequireConsecutive = 2
	// Pullback
	cfg.PullbackMinADX = 22.0
	cfg.PullbackSLATR = 1.0
	cfg.PullbackSLATR = 1.2
	cfg.PullbackTP1ATR = 1.5
	cfg.PullbackTP2ATR = 3.0
	cfg.PullbackDistATR = 0.5
	// BreakoutRetest
	cfg.BreakoutRetestSLATR = 1.3
	cfg.BreakoutRetestTP1ATR = 2.0
	cfg.BreakoutRetestTP2ATR = 3.5
	// Divergence
	cfg.DivergenceSLATR = 0.8
	cfg.DivergenceTP1ATR = 1.8
	cfg.DivergenceTP2ATR = 3.0
	// BreakoutPyramid
	cfg.BreakoutPyramidMinADX = 28.0
	cfg.BreakoutPyramidSLATR = 1.5
	// ScaleIn
	cfg.ScaleInSLATR = 1.2
	cfg.ScaleInTP1ATR = 1.5
	cfg.ScaleInTP2ATR = 3.0
	// MomentumScalp
	cfg.MomentumScalpMinADX = 16.0
	cfg.MomentumScalpSLATR = 0.4
	cfg.MomentumScalpTP1ATR = 0.6
	cfg.MomentumScalpTP2ATR = 0.9
	cfg.MomentumScalpMinScore = 6
	cfg.MomentumScalpMaxHoldingMin = 25
	cfg.M15ConfirmRSIThreshold = 40.0
	cfg.MinScore = 5
	return cfg
}
