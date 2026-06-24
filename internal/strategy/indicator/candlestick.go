package indicator

import (
	"math"

	"gold-bot/internal/domain"
)

// CandleSignal represents a detected candlestick pattern
type CandleSignal string

const (
	// Single-candle patterns (MVP: 2 patterns)
	CandleHammer       CandleSignal = "hammer"
	CandleShootingStar CandleSignal = "shooting_star"

	// Dual-candle patterns (MVP: 4 patterns)
	CandleBullishEngulfing CandleSignal = "bullish_engulfing"
	CandleBearishEngulfing CandleSignal = "bearish_engulfing"
	CandlePiercingLine     CandleSignal = "piercing_line"
	CandleDarkCloudCover   CandleSignal = "dark_cloud_cover"

	// Triple-candle patterns (MVP: 4 patterns)
	CandleMorningStar        CandleSignal = "morning_star"
	CandleEveningStar        CandleSignal = "evening_star"
	CandleThreeWhiteSoldiers CandleSignal = "three_white_soldiers"
	CandleThreeBlackCrows    CandleSignal = "three_black_crows"
)

// CandlestickResult holds the detection result for a pattern
type CandlestickResult struct {
	Signal   CandleSignal `json:"signal"`
	Bullish  bool         `json:"bullish"`
	BarIndex int          `json:"bar_index"`
	Strength float64      `json:"strength"` // 0.0-1.0
}

// IsBullish returns whether the signal is a bullish pattern
func IsBullish(s CandleSignal) bool {
	switch s {
	case CandleHammer, CandleBullishEngulfing, CandlePiercingLine,
		CandleMorningStar, CandleThreeWhiteSoldiers:
		return true
	default:
		return false
	}
}

// IsBearish returns whether the signal is a bearish pattern
func IsBearish(s CandleSignal) bool {
	switch s {
	case CandleShootingStar, CandleBearishEngulfing, CandleDarkCloudCover,
		CandleEveningStar, CandleThreeBlackCrows:
		return true
	default:
		return false
	}
}

// Helper functions for candlestick detection

// body returns the absolute body size of a bar
func body(b domain.Bar) float64 {
	return math.Abs(b.Close - b.Open)
}

// upperShadow returns the upper shadow length
func upperShadow(b domain.Bar) float64 {
	return b.High - math.Max(b.Open, b.Close)
}

// lowerShadow returns the lower shadow length
func lowerShadow(b domain.Bar) float64 {
	return math.Min(b.Open, b.Close) - b.Low
}

// isBullishBar returns true if the bar closed higher than it opened
func isBullishBar(b domain.Bar) bool {
	return b.Close > b.Open
}

// isBearishBar returns true if the bar closed lower than it opened
func isBearishBar(b domain.Bar) bool {
	return b.Close < b.Open
}

// localTrend returns "bull", "bear", or "neutral" based on 10-bar price action + EMA50
func localTrend(bars []domain.Bar, idx int) string {
	if idx < 10 {
		return "neutral"
	}

	// 10-bar higher-highs/lower-lows check
	highCount := 0
	lowCount := 0
	for i := idx - 9; i < idx; i++ {
		if bars[i+1].High > bars[i].High {
			highCount++
		}
		if bars[i+1].Low < bars[i].Low {
			lowCount++
		}
	}

	// EMA50 slope check (current vs 5 bars ago)
	if idx < 5 {
		return "neutral"
	}
	ema50Current := bars[idx].EMA50
	ema50Prior := bars[idx-5].EMA50
	if ema50Prior == 0 {
		return "neutral"
	}
	emaSlope := (ema50Current - ema50Prior) / ema50Prior

	// Combined signal
	if highCount >= 6 && emaSlope > 0.001 {
		return "bull"
	}
	if lowCount >= 6 && emaSlope < -0.001 {
		return "bear"
	}
	return "neutral"
}

// clamp restricts a value to [min, max]
func clamp(val, min, max float64) float64 {
	if val < min {
		return min
	}
	if val > max {
		return max
	}
	return val
}

// minFloat returns the minimum of two float64 values
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// Single-candle pattern detectors

// detectHammer detects hammer pattern
// Rule: lowerShadow ≥ max(body*2, ATR*0.15) && upperShadow ≤ body*0.3 && close ≥ (high+low)/2
func detectHammer(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 0 || i >= len(bars) {
		return nil
	}

	bar := bars[i]
	b := body(bar)
	lower := lowerShadow(bar)
	upper := upperShadow(bar)

	// Guard: if body is too small, use ATR minimum
	if b < atr*0.01 {
		b = atr * 0.01
	}

	// Check hammer conditions
	minShadow := math.Max(b*2, atr*0.15)
	if lower < minShadow {
		return nil
	}
	if upper > b*0.3 {
		return nil
	}
	if bar.Close < (bar.High+bar.Low)/2 {
		return nil
	}

	// Trend context: bullish reversal requires non-bull trend
	trend := localTrend(bars, i)
	if trend == "bull" {
		return nil
	}

	strength := patternStrength(CandleHammer, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleHammer,
		Bullish:  true,
		BarIndex: i,
		Strength: strength,
	}
}

// detectShootingStar detects shooting star pattern
// Rule: upperShadow ≥ max(body*2, ATR*0.15) && lowerShadow ≤ body*0.3 && close ≤ (high+low)/2
func detectShootingStar(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 0 || i >= len(bars) {
		return nil
	}

	bar := bars[i]
	b := body(bar)
	lower := lowerShadow(bar)
	upper := upperShadow(bar)

	// Guard: if body is too small, use ATR minimum
	if b < atr*0.01 {
		b = atr * 0.01
	}

	// Check shooting star conditions
	minShadow := math.Max(b*2, atr*0.15)
	if upper < minShadow {
		return nil
	}
	if lower > b*0.3 {
		return nil
	}
	if bar.Close > (bar.High+bar.Low)/2 {
		return nil
	}

	// Trend context: bearish reversal requires non-bear trend
	trend := localTrend(bars, i)
	if trend == "bear" {
		return nil
	}

	strength := patternStrength(CandleShootingStar, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleShootingStar,
		Bullish:  false,
		BarIndex: i,
		Strength: strength,
	}
}

// Dual-candle pattern detectors

// detectBullishEngulfing detects bullish engulfing pattern
func detectBullishEngulfing(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 1 || i >= len(bars) {
		return nil
	}

	prev := bars[i-1]
	curr := bars[i]

	// Check: prev bearish, curr bullish
	if !isBearishBar(prev) || !isBullishBar(curr) {
		return nil
	}

	// Check: curr engulfs prev
	if curr.Open > prev.Close || curr.Close < prev.Open {
		return nil
	}

	// Check: curr body > prev body
	if body(curr) <= body(prev) {
		return nil
	}

	// Trend context: bullish reversal requires non-bull trend
	trend := localTrend(bars, i)
	if trend == "bull" {
		return nil
	}

	strength := patternStrength(CandleBullishEngulfing, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleBullishEngulfing,
		Bullish:  true,
		BarIndex: i,
		Strength: strength,
	}
}

// detectBearishEngulfing detects bearish engulfing pattern
func detectBearishEngulfing(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 1 || i >= len(bars) {
		return nil
	}

	prev := bars[i-1]
	curr := bars[i]

	// Check: prev bullish, curr bearish
	if !isBullishBar(prev) || !isBearishBar(curr) {
		return nil
	}

	// Check: curr engulfs prev
	if curr.Open < prev.Close || curr.Close > prev.Open {
		return nil
	}

	// Check: curr body > prev body
	if body(curr) <= body(prev) {
		return nil
	}

	// Trend context: bearish reversal requires non-bear trend
	trend := localTrend(bars, i)
	if trend == "bear" {
		return nil
	}

	strength := patternStrength(CandleBearishEngulfing, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleBearishEngulfing,
		Bullish:  false,
		BarIndex: i,
		Strength: strength,
	}
}

// detectPiercingLine detects piercing line pattern
func detectPiercingLine(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 1 || i >= len(bars) {
		return nil
	}

	prev := bars[i-1]
	curr := bars[i]

	// Check: prev bearish, curr bullish
	if !isBearishBar(prev) || !isBullishBar(curr) {
		return nil
	}

	// Check: curr opens below prev close
	if curr.Open >= prev.Close {
		return nil
	}

	// Calculate penetration percentage
	prevBody := body(prev)
	if prevBody < atr*0.01 {
		prevBody = atr * 0.01
	}
	penetrationLevel := prev.Open - (prevBody * 0.5) // 50% penetration minimum

	// Check: curr closes at least 50% into prev body
	if curr.Close < penetrationLevel {
		return nil
	}

	// Trend context: bullish reversal requires non-bull trend
	trend := localTrend(bars, i)
	if trend == "bull" {
		return nil
	}

	strength := patternStrength(CandlePiercingLine, bars, i, atr)

	// Bonus for ≥63% penetration (strong piercing)
	penetration63Level := prev.Open - (prevBody * 0.37)
	if curr.Close >= penetration63Level {
		strength = clamp(strength+0.1, 0.0, 1.0)
	}

	return &CandlestickResult{
		Signal:   CandlePiercingLine,
		Bullish:  true,
		BarIndex: i,
		Strength: strength,
	}
}

// detectDarkCloudCover detects dark cloud cover pattern
func detectDarkCloudCover(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 1 || i >= len(bars) {
		return nil
	}

	prev := bars[i-1]
	curr := bars[i]

	// Check: prev bullish, curr bearish
	if !isBullishBar(prev) || !isBearishBar(curr) {
		return nil
	}

	// Check: curr opens above prev close
	if curr.Open <= prev.Close {
		return nil
	}

	// Calculate penetration percentage
	prevBody := body(prev)
	if prevBody < atr*0.01 {
		prevBody = atr * 0.01
	}
	penetrationLevel := prev.Close - (prevBody * 0.5) // 50% penetration minimum

	// Check: curr closes at least 50% into prev body
	if curr.Close > penetrationLevel {
		return nil
	}

	// Trend context: bearish reversal requires non-bear trend
	trend := localTrend(bars, i)
	if trend == "bear" {
		return nil
	}

	strength := patternStrength(CandleDarkCloudCover, bars, i, atr)

	// Bonus for ≥63% penetration (strong dark cloud)
	penetration63Level := prev.Close - (prevBody * 0.63)
	if curr.Close <= penetration63Level {
		strength = clamp(strength+0.1, 0.0, 1.0)
	}

	return &CandlestickResult{
		Signal:   CandleDarkCloudCover,
		Bullish:  false,
		BarIndex: i,
		Strength: strength,
	}
}

// Triple-candle pattern detectors

// detectMorningStar detects morning star pattern
func detectMorningStar(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 2 || i >= len(bars) {
		return nil
	}

	bar0 := bars[i-2] // First bar
	bar1 := bars[i-1] // Middle bar (star)
	bar2 := bars[i]   // Last bar

	// Check: bar0 is bearish with large body
	if !isBearishBar(bar0) || body(bar0) < atr*0.3 {
		return nil
	}

	// Check: bar1 is small body positioned lower than bar0
	if body(bar1) > atr*0.15 || bar1.High > bar0.Close {
		return nil
	}

	// Check: bar2 is bullish with large body
	if !isBullishBar(bar2) || body(bar2) < atr*0.3 {
		return nil
	}

	// Check: bar2 penetrates at least midpoint of bar0 body
	bar0Midpoint := (bar0.Open + bar0.Close) / 2
	if bar2.Close < bar0Midpoint {
		return nil
	}

	// Trend context: bullish reversal requires non-bull trend
	trend := localTrend(bars, i)
	if trend == "bull" {
		return nil
	}

	strength := patternStrength(CandleMorningStar, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleMorningStar,
		Bullish:  true,
		BarIndex: i,
		Strength: strength,
	}
}

// detectEveningStar detects evening star pattern
func detectEveningStar(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 2 || i >= len(bars) {
		return nil
	}

	bar0 := bars[i-2] // First bar
	bar1 := bars[i-1] // Middle bar (star)
	bar2 := bars[i]   // Last bar

	// Check: bar0 is bullish with large body
	if !isBullishBar(bar0) || body(bar0) < atr*0.3 {
		return nil
	}

	// Check: bar1 is small body positioned higher than bar0
	if body(bar1) > atr*0.15 || bar1.Low < bar0.Close {
		return nil
	}

	// Check: bar2 is bearish with large body
	if !isBearishBar(bar2) || body(bar2) < atr*0.3 {
		return nil
	}

	// Check: bar2 penetrates at least midpoint of bar0 body
	bar0Midpoint := (bar0.Open + bar0.Close) / 2
	if bar2.Close > bar0Midpoint {
		return nil
	}

	// Trend context: bearish reversal requires non-bear trend
	trend := localTrend(bars, i)
	if trend == "bear" {
		return nil
	}

	strength := patternStrength(CandleEveningStar, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleEveningStar,
		Bullish:  false,
		BarIndex: i,
		Strength: strength,
	}
}

// detectThreeWhiteSoldiers detects three white soldiers pattern
func detectThreeWhiteSoldiers(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 2 || i >= len(bars) {
		return nil
	}

	bar0 := bars[i-2]
	bar1 := bars[i-1]
	bar2 := bars[i]

	// Check: all three bars are bullish
	if !isBullishBar(bar0) || !isBullishBar(bar1) || !isBullishBar(bar2) {
		return nil
	}

	// Check: each close > prior close
	if bar1.Close <= bar0.Close || bar2.Close <= bar1.Close {
		return nil
	}

	// Check: each open in prior bar's upper half
	bar0UpperHalf := (bar0.Open + bar0.Close) / 2
	bar1UpperHalf := (bar1.Open + bar1.Close) / 2
	if bar1.Open < bar0UpperHalf || bar2.Open < bar1UpperHalf {
		return nil
	}

	// Check: bodies similar size (max/min ≤ 1.5)
	body0 := body(bar0)
	body1 := body(bar1)
	body2 := body(bar2)
	maxBody := math.Max(body0, math.Max(body1, body2))
	minBody := math.Min(body0, math.Min(body1, body2))
	if minBody < atr*0.01 {
		minBody = atr * 0.01
	}
	if maxBody/minBody > 1.5 {
		return nil
	}

	// Trend context: continuation pattern, requires matching trend (relaxed: non-opposite is OK)
	trend := localTrend(bars, i)
	if trend == "bear" {
		return nil
	}

	strength := patternStrength(CandleThreeWhiteSoldiers, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleThreeWhiteSoldiers,
		Bullish:  true,
		BarIndex: i,
		Strength: strength,
	}
}

// detectThreeBlackCrows detects three black crows pattern
func detectThreeBlackCrows(bars []domain.Bar, i int, atr float64) *CandlestickResult {
	if i < 2 || i >= len(bars) {
		return nil
	}

	bar0 := bars[i-2]
	bar1 := bars[i-1]
	bar2 := bars[i]

	// Check: all three bars are bearish
	if !isBearishBar(bar0) || !isBearishBar(bar1) || !isBearishBar(bar2) {
		return nil
	}

	// Check: each close < prior close
	if bar1.Close >= bar0.Close || bar2.Close >= bar1.Close {
		return nil
	}

	// Check: each open in prior bar's lower half
	bar0LowerHalf := (bar0.Open + bar0.Close) / 2
	bar1LowerHalf := (bar1.Open + bar1.Close) / 2
	if bar1.Open > bar0LowerHalf || bar2.Open > bar1LowerHalf {
		return nil
	}

	// Check: bodies similar size (max/min ≤ 1.5)
	body0 := body(bar0)
	body1 := body(bar1)
	body2 := body(bar2)
	maxBody := math.Max(body0, math.Max(body1, body2))
	minBody := math.Min(body0, math.Min(body1, body2))
	if minBody < atr*0.01 {
		minBody = atr * 0.01
	}
	if maxBody/minBody > 1.5 {
		return nil
	}

	// Trend context: continuation pattern, requires matching trend (relaxed: non-opposite is OK)
	trend := localTrend(bars, i)
	if trend == "bull" {
		return nil
	}

	strength := patternStrength(CandleThreeBlackCrows, bars, i, atr)
	return &CandlestickResult{
		Signal:   CandleThreeBlackCrows,
		Bullish:  false,
		BarIndex: i,
		Strength: strength,
	}
}

// Pattern strength calculation

// patternStrength calculates strength for a detected pattern (0.0-1.0)
func patternStrength(signal CandleSignal, bars []domain.Bar, i int, atr float64) float64 {
	base := 0.5 // Pattern detected = 0.5 minimum
	bar := bars[i]
	b := body(bar)

	// Guard: if body is too small, use ATR as denominator
	if b < atr*0.01 {
		b = atr * 0.01
	}

	// 1. Body/shadow ratio bonus (0.0-0.2)
	ratioBonus := 0.0
	switch signal {
	case CandleHammer:
		requiredRatio := 2.0
		actualRatio := lowerShadow(bar) / b
		if actualRatio > requiredRatio {
			ratioBonus = minFloat((actualRatio-requiredRatio)/(requiredRatio*2), 0.2)
		}
	case CandleShootingStar:
		requiredRatio := 2.0
		actualRatio := upperShadow(bar) / b
		if actualRatio > requiredRatio {
			ratioBonus = minFloat((actualRatio-requiredRatio)/(requiredRatio*2), 0.2)
		}
	case CandleBullishEngulfing, CandleBearishEngulfing:
		if i >= 1 {
			prevBody := body(bars[i-1])
			if prevBody < atr*0.01 {
				prevBody = atr * 0.01
			}
			engulfRatio := b / prevBody
			if engulfRatio > 1.5 {
				ratioBonus = minFloat((engulfRatio-1.5)/2.0, 0.2)
			}
		}
	case CandlePiercingLine, CandleDarkCloudCover:
		// Penetration strength already added in detector
		ratioBonus = 0.0
	case CandleMorningStar, CandleEveningStar:
		if i >= 2 {
			// Check middle bar is very small
			middleBody := body(bars[i-1])
			if middleBody < atr*0.05 {
				ratioBonus = 0.15
			} else if middleBody < atr*0.1 {
				ratioBonus = 0.1
			}
		}
	case CandleThreeWhiteSoldiers, CandleThreeBlackCrows:
		// Uniformity bonus - already checked in detector
		ratioBonus = 0.1
	}

	// 2. Trend context alignment bonus (0.0-0.2)
	trendBonus := 0.0
	trend := localTrend(bars, i)
	isBullishPattern := IsBullish(signal)
	isBearishPattern := IsBearish(signal)

	if isBullishPattern && trend != "bull" {
		trendBonus = 0.2 // Perfect counter-trend setup
	} else if isBearishPattern && trend != "bear" {
		trendBonus = 0.2 // Perfect counter-trend setup
	}

	// 3. Support/Resistance proximity bonus (0.0-0.1)
	srBonus := 0.0
	if isBullishPattern {
		// Check proximity to support levels
		if math.Abs(bar.Close-bar.S1) < atr*0.5 {
			srBonus = 0.1
		} else if math.Abs(bar.Close-bar.S2) < atr*0.5 {
			srBonus = 0.1
		}
	} else if isBearishPattern {
		// Check proximity to resistance levels
		if math.Abs(bar.Close-bar.R1) < atr*0.5 {
			srBonus = 0.1
		} else if math.Abs(bar.Close-bar.R2) < atr*0.5 {
			srBonus = 0.1
		}
	}

	return clamp(base+ratioBonus+trendBonus+srBonus, 0.0, 1.0)
}

// DetectAll runs all pattern detectors and returns pattern names for the bar at index i
func DetectAll(bars []domain.Bar, i int) []string {
	if i < 0 || i >= len(bars) {
		return nil
	}

	// Get ATR from the bar (already calculated by EnrichBars)
	atr := bars[i].ATR
	if atr <= 0 {
		// Fallback: calculate simple ATR if not available
		if i > 0 {
			atr = bars[i].High - bars[i].Low
		} else {
			return nil
		}
	}

	var results []string

	// Single-candle patterns (can run at any index)
	if result := detectHammer(bars, i, atr); result != nil && result.Strength >= 0.5 {
		results = append(results, string(result.Signal))
	}
	if result := detectShootingStar(bars, i, atr); result != nil && result.Strength >= 0.5 {
		results = append(results, string(result.Signal))
	}

	// Dual-candle patterns (require i >= 1)
	if i >= 1 {
		if result := detectBullishEngulfing(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectBearishEngulfing(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectPiercingLine(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectDarkCloudCover(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
	}

	// Triple-candle patterns (require i >= 2)
	if i >= 2 {
		if result := detectMorningStar(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectEveningStar(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectThreeWhiteSoldiers(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
		if result := detectThreeBlackCrows(bars, i, atr); result != nil && result.Strength >= 0.5 {
			results = append(results, string(result.Signal))
		}
	}

	return results
}
