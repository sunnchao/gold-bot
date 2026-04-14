package engine

// StrategyConfig holds all configurable parameters for the strategy engine.
type StrategyConfig struct {
	// Pullback strategy
	PullbackMinADX      float64 `json:"pullback_min_adx" yaml:"pullback_min_adx"`
	PullbackRSIOversold float64 `json:"pullback_rsi_oversold" yaml:"pullback_rsi_oversold"`
	PullbackRSIOverbought float64 `json:"pullback_rsi_overbought" yaml:"pullback_rsi_overbought"`
	PullbackDistATR    float64 `json:"pullback_dist_atr" yaml:"pullback_dist_atr"`
	PullbackADXBonus   float64 `json:"pullback_adx_bonus" yaml:"pullback_adx_bonus"`
	PullbackSLATR      float64 `json:"pullback_sl_atr" yaml:"pullback_sl_atr"`
	PullbackTP1ATR     float64 `json:"pullback_tp1_atr" yaml:"pullback_tp1_atr"`
	PullbackTP2ATR     float64 `json:"pullback_tp2_atr" yaml:"pullback_tp2_atr"`

	// BreakoutRetest strategy
	BreakoutRetestLookback     int     `json:"breakout_retest_lookback" yaml:"breakout_retest_lookback"`
	BreakoutRetestConfirmWindow int    `json:"breakout_retest_confirm_window" yaml:"breakout_retest_confirm_window"`
	BreakoutRetestDistATR     float64  `json:"breakout_retest_dist_atr" yaml:"breakout_retest_dist_atr"`
	BreakoutRetestSLATR       float64  `json:"breakout_retest_sl_atr" yaml:"breakout_retest_sl_atr"`
	BreakoutRetestTP1ATR      float64  `json:"breakout_retest_tp1_atr" yaml:"breakout_retest_tp1_atr"`
	BreakoutRetestTP2ATR      float64  `json:"breakout_retest_tp2_atr" yaml:"breakout_retest_tp2_atr"`

	// Divergence strategy
	DivergenceWindowRecent int     `json:"divergence_window_recent" yaml:"divergence_window_recent"`
	DivergenceWindowPrev   int     `json:"divergence_window_prev" yaml:"divergence_window_prev"`
	DivergenceRSIBullThresh float64 `json:"divergence_rsi_bull_thresh" yaml:"divergence_rsi_bull_thresh"`
	DivergenceRSIBearThresh float64 `json:"divergence_rsi_bear_thresh" yaml:"divergence_rsi_bear_thresh"`
	DivergenceSLATR       float64  `json:"divergence_sl_atr" yaml:"divergence_sl_atr"`
	DivergenceTP1ATR      float64  `json:"divergence_tp1_atr" yaml:"divergence_tp1_atr"`
	DivergenceTP2ATR      float64  `json:"divergence_tp2_atr" yaml:"divergence_tp2_atr"`

	// BreakoutPyramid strategy
	BreakoutPyramidMinADX       float64 `json:"breakout_pyramid_min_adx" yaml:"breakout_pyramid_min_adx"`
	BreakoutPyramidSLATR       float64 `json:"breakout_pyramid_sl_atr" yaml:"breakout_pyramid_sl_atr"`
	BreakoutPyramidMinSpacingATR float64 `json:"breakout_pyramid_min_spacing_atr" yaml:"breakout_pyramid_min_spacing_atr"`

	// H4 trend filter
	H4ADXThreshold          float64 `json:"h4_adx_threshold" yaml:"h4_adx_threshold"`
	H4RequireConsecutive    int     `json:"h4_require_consecutive" yaml:"h4_require_consecutive"`

	// M15 confirmation
	M15ConfirmRSIThreshold float64 `json:"m15_confirm_rsi_threshold" yaml:"m15_confirm_rsi_threshold"`

	// Minimum signal score
	MinScore int `json:"min_score" yaml:"min_score"`
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
		BreakoutPyramidMinADX:         30.0,
		BreakoutPyramidSLATR:          1.5,
		BreakoutPyramidMinSpacingATR:   2.0,

		// H4 trend - higher threshold, require 3 bars
		H4ADXThreshold:       30.0,
		H4RequireConsecutive: 3,

		// M15 confirmation - RSI threshold for early entry (40=bullish, 60=bearish)
		M15ConfirmRSIThreshold: 40.0,

		MinScore: 5,
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
	case "EURUSD":
		return EURUSDStrategyConfig()
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
	return cfg
}

// GBPJPYStrategyConfig returns strategy parameters optimized for GBPJPY trading.
func GBPJPYStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// GBPJPY-specific adjustments
	cfg.PullbackMinADX = 22.0
	cfg.PullbackSLATR = 1.2
	cfg.PullbackTP1ATR = 1.2
	cfg.PullbackTP2ATR = 2.5
	return cfg
}

// EURUSDStrategyConfig returns strategy parameters optimized for EURUSD trading.
func EURUSDStrategyConfig() StrategyConfig {
	cfg := DefaultStrategyConfig()
	// EURUSD-specific adjustments
	cfg.PullbackMinADX = 20.0
	cfg.PullbackSLATR = 1.0
	cfg.PullbackTP1ATR = 1.0
	cfg.PullbackTP2ATR = 2.0
	return cfg
}