package smc

import (
	"fmt"
	"gold-bot/internal/domain"
	"math"
)

// --------------- Swing Point Detection ---------------

// FindSwingPoints detects local swing highs and lows using N-bar pivot logic.
// A bar is a swing high if its High is greater than all `left` bars before and `right` bars after.
// Similarly for swing lows.
func FindSwingPoints(bars []domain.Bar, left, right int) (swingHighs, swingLows []SwingPoint) {
	if left < 1 {
		left = 1
	}
	if right < 1 {
		right = 1
	}
	if len(bars) < left+right+1 {
		return nil, nil
	}

	for i := left; i < len(bars)-right; i++ {
		high := bars[i].High
		low := bars[i].Low
		isSwingHigh := true
		isSwingLow := true

		for j := i - left; j <= i+right; j++ {
			if j == i {
				continue
			}
			if bars[j].High >= high {
				isSwingHigh = false
			}
			if bars[j].Low <= low {
				isSwingLow = false
			}
			if !isSwingHigh && !isSwingLow {
				break
			}
		}

		if isSwingHigh {
			swingHighs = append(swingHighs, SwingPoint{Index: i, Price: high, Type: "HIGH"})
		}
		if isSwingLow {
			swingLows = append(swingLows, SwingPoint{Index: i, Price: low, Type: "LOW"})
		}
	}

	return swingHighs, swingLows
}

// --------------- Trend Direction ---------------

// DetermineTrendDirection infers the current trend direction from the sequence
// of recent swing points. Returns "BULL", "BEAR", or "NEUTRAL".
func DetermineTrendDirection(swingHighs, swingLows []SwingPoint) string {
	// Merge and sort swing points by index
	type swingEvent struct {
		index  int
		price  float64
		isHigh bool
	}
	events := make([]swingEvent, 0, len(swingHighs)+len(swingLows))
	for _, sh := range swingHighs {
		events = append(events, swingEvent{sh.Index, sh.Price, true})
	}
	for _, sl := range swingLows {
		events = append(events, swingEvent{sl.Index, sl.Price, false})
	}
	if len(events) < 4 {
		return "NEUTRAL"
	}

	// Sort by index
	for i := 0; i < len(events); i++ {
		for j := i + 1; j < len(events); j++ {
			if events[j].index < events[i].index {
				events[i], events[j] = events[j], events[i]
			}
		}
	}

	// Check last N swing points for higher-highs + higher-lows (bullish)
	// or lower-highs + lower-lows (bearish)
	recentHighs := make([]SwingPoint, 0)
	recentLows := make([]SwingPoint, 0)
	for _, e := range events {
		if e.isHigh {
			recentHighs = append(recentHighs, SwingPoint{Index: e.index, Price: e.price, Type: "HIGH"})
		} else {
			recentLows = append(recentLows, SwingPoint{Index: e.index, Price: e.price, Type: "LOW"})
		}
	}

	bullish := len(recentHighs) >= 2 && len(recentLows) >= 2 &&
		recentHighs[len(recentHighs)-1].Price > recentHighs[len(recentHighs)-2].Price &&
		recentLows[len(recentLows)-1].Price > recentLows[len(recentLows)-2].Price

	bearish := len(recentHighs) >= 2 && len(recentLows) >= 2 &&
		recentHighs[len(recentHighs)-1].Price < recentHighs[len(recentHighs)-2].Price &&
		recentLows[len(recentLows)-1].Price < recentLows[len(recentLows)-2].Price

	if bullish {
		return "BULL"
	}
	if bearish {
		return "BEAR"
	}
	return "NEUTRAL"
}

// --------------- Structure Break Detection (BOS + CHoCH) ---------------

// DetectStructureBreaks identifies both BOS (continuation) and CHoCH (reversal)
// by comparing the break direction against the prevailing trend.
// trendDirection: "BULL", "BEAR", or "NEUTRAL" — if empty, auto-detected from swing points.
// It first tries pivot-based swing detection. If insufficient swing points are found,
// it falls back to detecting close-vs-recent-high/low breaks (simpler heuristic).
func DetectStructureBreaks(bars []domain.Bar, lookback int, trendDirection string) []StructureBreak {
	if len(bars) < 3 {
		return nil
	}
	if lookback <= 0 || lookback > len(bars) {
		lookback = len(bars)
	}

	start := len(bars) - lookback
	window := bars[start:]

	// Try swing-point-based detection first
	swingHighs, swingLows := FindSwingPoints(window, 3, 3)

	// Adjust indices back to full bars slice
	for i := range swingHighs {
		swingHighs[i].Index += start
	}
	for i := range swingLows {
		swingLows[i].Index += start
	}

	// Auto-detect trend if not provided
	if trendDirection == "" {
		trendDirection = DetermineTrendDirection(swingHighs, swingLows)
	}

	// If we have swing points, use them for precise break detection
	if len(swingHighs) > 0 || len(swingLows) > 0 {
		swingBreaks := detectBreaksFromSwings(bars, start, swingHighs, swingLows, trendDirection)

		// If we only have one type of swing point, supplement with fallback
		// to catch breaks in the other direction
		if len(swingHighs) == 0 || len(swingLows) == 0 {
			fallbackBreaks := detectBreaksFromRecentExtremes(bars, start, trendDirection)
			// Merge: add fallback breaks that don't duplicate swing breaks
			seen := make(map[string]bool)
			for _, b := range swingBreaks {
				key := fmt.Sprintf("%d-%s", b.Index, b.Direction)
				seen[key] = true
			}
			for _, b := range fallbackBreaks {
				key := fmt.Sprintf("%d-%s", b.Index, b.Direction)
				if !seen[key] {
					swingBreaks = append(swingBreaks, b)
				}
			}
		}

		return swingBreaks
	}

	// Fallback: simple recent-high/low break detection
	return detectBreaksFromRecentExtremes(bars, start, trendDirection)
}

// detectBreaksFromSwings detects structure breaks using identified swing points.
func detectBreaksFromSwings(bars []domain.Bar, start int, swingHighs, swingLows []SwingPoint, trendDirection string) []StructureBreak {
	events := make([]StructureBreak, 0)
	highCursor := 0
	lowCursor := 0

	for i := start; i < len(bars); i++ {
		for highCursor < len(swingHighs) && swingHighs[highCursor].Index < i {
			highCursor++
		}
		for lowCursor < len(swingLows) && swingLows[lowCursor].Index < i {
			lowCursor++
		}

		if highCursor > 0 {
			level := swingHighs[highCursor-1].Price
			if bars[i].Close > level && (i == 0 || bars[i-1].Close <= level) {
				breakDir := "UP"
				breakType := classifyBreak(breakDir, trendDirection)
				events = append(events, StructureBreak{
					Index:     i,
					Direction: breakDir,
					Level:     level,
					Type:      breakType,
				})
			}
		}

		if lowCursor > 0 {
			level := swingLows[lowCursor-1].Price
			if bars[i].Close < level && (i == 0 || bars[i-1].Close >= level) {
				breakDir := "DOWN"
				breakType := classifyBreak(breakDir, trendDirection)
				events = append(events, StructureBreak{
					Index:     i,
					Direction: breakDir,
					Level:     level,
					Type:      breakType,
				})
			}
		}
	}

	return events
}

// detectBreaksFromRecentExtremes is a fallback when swing pivot detection finds
// insufficient points. It uses a rolling window to find local highs/lows and
// detects when close breaks above/below them.
func detectBreaksFromRecentExtremes(bars []domain.Bar, start int, trendDirection string) []StructureBreak {
	events := make([]StructureBreak, 0)
	windowSize := 5 // look at recent 5 bars for local extremes

	for i := start + windowSize; i < len(bars); i++ {
		// Find the highest high and lowest low in the preceding window
		recentHigh := 0.0
		recentLow := math.MaxFloat64
		recentHighIdx := -1
		recentLowIdx := -1

		for j := i - windowSize; j < i; j++ {
			if j < start {
				continue
			}
			if bars[j].High > recentHigh {
				recentHigh = bars[j].High
				recentHighIdx = j
			}
			if bars[j].Low < recentLow {
				recentLow = bars[j].Low
				recentLowIdx = j
			}
		}

		if recentHighIdx < 0 && recentLowIdx < 0 {
			continue
		}

		// Break above recent high
		if recentHighIdx >= 0 && bars[i].Close > recentHigh && (i == 0 || bars[i-1].Close <= recentHigh) {
			breakDir := "UP"
			breakType := classifyBreak(breakDir, trendDirection)
			events = append(events, StructureBreak{
				Index:     i,
				Direction: breakDir,
				Level:     recentHigh,
				Type:      breakType,
			})
		}

		// Break below recent low
		if recentLowIdx >= 0 && bars[i].Close < recentLow && (i == 0 || bars[i-1].Close >= recentLow) {
			breakDir := "DOWN"
			breakType := classifyBreak(breakDir, trendDirection)
			events = append(events, StructureBreak{
				Index:     i,
				Direction: breakDir,
				Level:     recentLow,
				Type:      breakType,
			})
		}
	}

	return events
}

// classifyBreak determines whether a structure break is BOS (continuation) or CHoCH (reversal).
func classifyBreak(breakDir, trendDirection string) string {
	switch trendDirection {
	case "BULL":
		if breakDir == "UP" {
			return "BOS" // Bullish trend, breaking higher = continuation
		}
		return "CHoCH" // Bullish trend, breaking lower = reversal
	case "BEAR":
		if breakDir == "DOWN" {
			return "BOS" // Bearish trend, breaking lower = continuation
		}
		return "CHoCH" // Bearish trend, breaking higher = reversal
	default:
		// Unknown trend — label all as BOS (conservative: no reversal claim)
		return "BOS"
	}
}

// --------------- FVG Detection ---------------

// DetectFVGs detects Fair Value Gaps in the bar series.
// A bullish FVG: bars[i+2].Low > bars[i].High (gap between candle 1 high and candle 3 low)
// A bearish FVG: bars[i+2].High < bars[i].Low (gap between candle 3 high and candle 1 low)
func DetectFVGs(bars []domain.Bar, lookback int) []FVG {
	if len(bars) < 3 {
		return nil
	}
	if lookback <= 0 || lookback > len(bars) {
		lookback = len(bars)
	}

	start := len(bars) - lookback
	gaps := make([]FVG, 0)

	for i := start; i < len(bars)-2; i++ {
		first := bars[i]
		third := bars[i+2]

		// Bullish FVG: third candle's Low > first candle's High
		if third.Low > first.High {
			fvg := FVG{
				StartIndex: i,
				EndIndex:   i + 2,
				Side:       "BULL",
				UpperBound: third.Low,
				LowerBound: first.High,
				Filled:     false,
			}
			// Check if gap has been filled by any subsequent bar
			fvg = checkFVGFill(fvg, bars, i+3)
			gaps = append(gaps, fvg)
		}

		// Bearish FVG: third candle's High < first candle's Low
		if third.High < first.Low {
			fvg := FVG{
				StartIndex: i,
				EndIndex:   i + 2,
				Side:       "BEAR",
				UpperBound: first.Low,
				LowerBound: third.High,
				Filled:     false,
			}
			fvg = checkFVGFill(fvg, bars, i+3)
			gaps = append(gaps, fvg)
		}
	}

	return gaps
}

// checkFVGFill checks whether a FVG has been filled by subsequent price action.
// A bullish FVG is filled when any bar's Low goes below the gap's LowerBound.
// A bearish FVG is filled when any bar's High goes above the gap's UpperBound.
func checkFVGFill(fvg FVG, bars []domain.Bar, fromIndex int) FVG {
	for j := fromIndex; j < len(bars); j++ {
		switch fvg.Side {
		case "BULL":
			if bars[j].Low <= fvg.LowerBound {
				fvg.Filled = true
				fvg.FillIndex = j
				return fvg
			}
		case "BEAR":
			if bars[j].High >= fvg.UpperBound {
				fvg.Filled = true
				fvg.FillIndex = j
				return fvg
			}
		}
	}
	return fvg
}

// --------------- Liquidity Sweep Detection ---------------

// DetectLiquiditySweeps identifies liquidity sweeps (fake breakouts).
// A sweep occurs when price briefly moves beyond a swing point and then reverses,
// closing back inside the structural range within a few bars.
func DetectLiquiditySweeps(bars []domain.Bar, swingHighs, swingLows []SwingPoint, maxReversalBars int) []LiquiditySweep {
	if len(bars) == 0 || (len(swingHighs) == 0 && len(swingLows) == 0) {
		return nil
	}
	if maxReversalBars <= 0 {
		maxReversalBars = 3
	}

	sweeps := make([]LiquiditySweep, 0)

	// Check swing high sweeps (price spikes above then reverses — bearish context for buys)
	for _, sh := range swingHighs {
		for i := sh.Index + 1; i < len(bars) && i <= sh.Index+maxReversalBars; i++ {
			// Bar wick went above swing high
			if bars[i].High > sh.Price && bars[i].Close < sh.Price {
				sweeps = append(sweeps, LiquiditySweep{
					Index:    i,
					Level:    sh.Price,
					Side:     "BEAR", // Swept highs = bearish liquidity grab
					Reversed: true,
				})
				break // Only record first sweep per swing point
			}
		}
	}

	// Check swing low sweeps (price dips below then reverses — bullish context for sells)
	for _, sl := range swingLows {
		for i := sl.Index + 1; i < len(bars) && i <= sl.Index+maxReversalBars; i++ {
			// Bar wick went below swing low
			if bars[i].Low < sl.Price && bars[i].Close > sl.Price {
				sweeps = append(sweeps, LiquiditySweep{
					Index:    i,
					Level:    sl.Price,
					Side:     "BULL", // Swept lows = bullish liquidity grab
					Reversed: true,
				})
				break
			}
		}
	}

	return sweeps
}

// --------------- Order Block Detection ---------------

// DetectOrderBlocks finds order blocks based on structure breaks.
// For a BUY OB: find the last bearish candle before a BOS UP (or CHoCH UP).
// For a SELL OB: find the last bullish candle before a BOS DOWN (or CHoCH UP → flipped).
func DetectOrderBlocks(bars []domain.Bar, side string, lookback int, trendDirection string) []OrderBlock {
	if len(bars) == 0 {
		return nil
	}

	bosEvents := DetectStructureBreaks(bars, lookback, trendDirection)
	if len(bosEvents) == 0 {
		return nil
	}

	seen := make(map[int]bool)
	blocks := make([]OrderBlock, 0)

	for i := len(bosEvents) - 1; i >= 0; i-- {
		brk := bosEvents[i]
		var obIndex int

		switch {
		case side == "BUY" && brk.Direction == "UP":
			// Bullish OB: last bearish candle before the upward break
			obIndex = findLastOrderBlockCandle(bars, brk.Index, 0, false)
		case side == "SELL" && brk.Direction == "DOWN":
			// Bearish OB: last bullish candle before the downward break
			obIndex = findLastOrderBlockCandle(bars, brk.Index, 0, true)
		default:
			continue
		}

		if obIndex < 0 || seen[obIndex] {
			continue
		}
		seen[obIndex] = true

		block := OrderBlock{
			Index:   obIndex,
			Side:    side,
			High:    bars[obIndex].High,
			Low:     bars[obIndex].Low,
			Valid:   true,
			AgeBars: len(bars) - 1 - obIndex,
		}
		block = checkOrderBlockValidity(block, bars)
		blocks = append(blocks, block)
	}

	return blocks
}

// findLastOrderBlockCandle searches backward from beforeIndex for the last candle
// that matches the expected direction (close > open for bullish, close < open for bearish).
// It prefers candles with body/range > 30% (strong body), but will accept any
// directional candle if no strong-body candidate is found.
func findLastOrderBlockCandle(bars []domain.Bar, beforeIndex, start int, bullish bool) int {
	if beforeIndex > len(bars) {
		beforeIndex = len(bars)
	}
	if start < 0 {
		start = 0
	}

	// First pass: find a strong-body candle (>30% body/range)
	for i := beforeIndex - 1; i >= start; i-- {
		barRange := bars[i].High - bars[i].Low
		if barRange <= 0 {
			continue
		}
		body := math.Abs(bars[i].Close - bars[i].Open)
		if body <= barRange*0.30 {
			continue
		}
		if bullish && bars[i].Close > bars[i].Open {
			return i
		}
		if !bullish && bars[i].Close < bars[i].Open {
			return i
		}
	}

	// Second pass: accept any directional candle (fallback)
	for i := beforeIndex - 1; i >= start; i-- {
		if bullish && bars[i].Close > bars[i].Open {
			return i
		}
		if !bullish && bars[i].Close < bars[i].Open {
			return i
		}
	}

	return -1
}

// checkOrderBlockValidity updates Valid and Mitigated based on subsequent price action.
// BUY OB is invalidated if a bar closes below OB.Low.
// SELL OB is invalidated if a bar closes above OB.High.
// OB is mitigated if price enters and fills through the zone.
func checkOrderBlockValidity(ob OrderBlock, bars []domain.Bar) OrderBlock {
	for i := ob.Index + 1; i < len(bars); i++ {
		switch ob.Side {
		case "BUY":
			if bars[i].Close < ob.Low {
				ob.Valid = false
				ob.Mitigated = true
				return ob
			}
			// Price entered the OB zone but didn't break — partial mitigation
			if bars[i].Low <= ob.High && bars[i].Close >= ob.Low {
				// Not yet mitigated, but price touched the zone
			}
		case "SELL":
			if bars[i].Close > ob.High {
				ob.Valid = false
				ob.Mitigated = true
				return ob
			}
		}
	}
	return ob
}

// --------------- SMC Context Builder ---------------

// BuildSMCContext constructs a multi-timeframe SMC context from H4, H1, and M30 bars.
func BuildSMCContext(h4, h1, m30 []domain.Bar) SMCContext {
	ctx := SMCContext{}

	if len(h4) >= 20 {
		h4Highs, h4Lows := FindSwingPoints(h4, 3, 3)
		ctx.H4TrendDirection = DetermineTrendDirection(h4Highs, h4Lows)
		ctx.H4Breaks = DetectStructureBreaks(h4, 50, ctx.H4TrendDirection)
		ctx.H4OBs = DetectOrderBlocks(h4, "BUY", 50, ctx.H4TrendDirection)
		ctx.H4OBs = append(ctx.H4OBs, DetectOrderBlocks(h4, "SELL", 50, ctx.H4TrendDirection)...)
		ctx.H4FVGs = DetectFVGs(h4, 50)
		ctx.H4Sweeps = DetectLiquiditySweeps(h4, h4Highs, h4Lows, 3)
	}

	if len(h1) >= 20 {
		h1Highs, h1Lows := FindSwingPoints(h1, 3, 3)
		ctx.H1TrendDirection = DetermineTrendDirection(h1Highs, h1Lows)
		ctx.H1Breaks = DetectStructureBreaks(h1, 50, ctx.H1TrendDirection)
		ctx.H1OBs = DetectOrderBlocks(h1, "BUY", 50, ctx.H1TrendDirection)
		ctx.H1OBs = append(ctx.H1OBs, DetectOrderBlocks(h1, "SELL", 50, ctx.H1TrendDirection)...)
		ctx.H1FVGs = DetectFVGs(h1, 50)
		ctx.H1Sweeps = DetectLiquiditySweeps(h1, h1Highs, h1Lows, 3)
	}

	return ctx
}

// --------------- Helper: Unfilled FVGs near price ---------------

// UnfilledFVGsNearPrice returns unfilled FVGs whose zone overlaps with the
// price ± threshold range. Useful for finding entry zones.
func UnfilledFVGsNearPrice(fvgs []FVG, price, threshold float64) []FVG {
	result := make([]FVG, 0)
	for _, fvg := range fvgs {
		if fvg.Filled {
			continue
		}
		// FVG zone overlaps with [price-threshold, price+threshold]
		if fvg.UpperBound >= price-threshold && fvg.LowerBound <= price+threshold {
			result = append(result, fvg)
		}
	}
	return result
}

// ValidOBsNearPrice returns valid order blocks whose zone overlaps with
// the price ± threshold range.
func ValidOBsNearPrice(obs []OrderBlock, price, threshold float64) []OrderBlock {
	result := make([]OrderBlock, 0)
	for _, ob := range obs {
		if !ob.Valid {
			continue
		}
		if ob.High >= price-threshold && ob.Low <= price+threshold {
			result = append(result, ob)
		}
	}
	return result
}

// HasCHOCHInDirection checks whether any CHoCH event exists in the given
// structure breaks that signals a reversal in the specified direction.
// direction="BULL" → look for CHoCH with Direction="UP" (bearish trend reversing up)
// direction="BEAR" → look for CHoCH with Direction="DOWN" (bullish trend reversing down)
func HasCHOCHInDirection(breaks []StructureBreak, direction string) bool {
	for _, brk := range breaks {
		if brk.Type != "CHoCH" {
			continue
		}
		if direction == "BULL" && brk.Direction == "UP" {
			return true
		}
		if direction == "BEAR" && brk.Direction == "DOWN" {
			return true
		}
	}
	return false
}

// RecentSweepInDirection checks for recent liquidity sweeps that confirm the given direction.
// direction="BULL" → swept lows then reversed up
// direction="BEAR" → swept highs then reversed down
// maxBarsAgo: only consider sweeps within this many bars from the end of the data
func RecentSweepInDirection(sweeps []LiquiditySweep, direction string, lastBarIndex, maxBarsAgo int) bool {
	for _, sweep := range sweeps {
		if !sweep.Reversed {
			continue
		}
		if sweep.Side != direction {
			continue
		}
		if maxBarsAgo <= 0 || lastBarIndex-sweep.Index <= maxBarsAgo {
			return true
		}
	}
	return false
}
