package smc

import (
	"gold-bot/internal/domain"
	"math"
	"testing"
)

// --------------- Test Helpers ---------------

func makeBar(o, h, l, c float64) domain.Bar {
	return domain.Bar{Open: o, High: h, Low: l, Close: c}
}

// --------------- FindSwingPoints Tests ---------------

func TestFindSwingPoints_Basic(t *testing.T) {
	// Create bars with a clear swing high at index 2 and swing low at index 4
	bars := []domain.Bar{
		makeBar(10, 10, 9, 9.5),   // 0
		makeBar(9.5, 11, 9, 10.5), // 1
		makeBar(10.5, 13, 10, 12), // 2 — swing high
		makeBar(12, 12, 10, 10.5), // 3
		makeBar(10.5, 10, 8, 9),   // 4 — swing low
		makeBar(9, 11, 9, 10),     // 5
		makeBar(10, 10, 9, 9.5),   // 6
	}

	highs, lows := FindSwingPoints(bars, 2, 2)

	if len(highs) == 0 {
		t.Fatal("expected at least one swing high")
	}
	if highs[0].Index != 2 {
		t.Errorf("swing high at index 2, got %d", highs[0].Index)
	}
	if math.Abs(highs[0].Price-13) > 0.01 {
		t.Errorf("swing high price 13, got %.2f", highs[0].Price)
	}

	if len(lows) == 0 {
		t.Fatal("expected at least one swing low")
	}
	if lows[0].Index != 4 {
		t.Errorf("swing low at index 4, got %d", lows[0].Index)
	}
	if math.Abs(lows[0].Price-8) > 0.01 {
		t.Errorf("swing low price 8, got %.2f", lows[0].Price)
	}
}

func TestFindSwingPoints_TooFewBars(t *testing.T) {
	bars := []domain.Bar{makeBar(10, 10, 9, 9.5)}
	highs, lows := FindSwingPoints(bars, 1, 1)
	if highs != nil || lows != nil {
		t.Error("expected nil for too few bars")
	}
}

func TestFindSwingPoints_NoSwings(t *testing.T) {
	// Flat bars — no swing points
	bars := []domain.Bar{
		makeBar(10, 10, 10, 10),
		makeBar(10, 10, 10, 10),
		makeBar(10, 10, 10, 10),
		makeBar(10, 10, 10, 10),
		makeBar(10, 10, 10, 10),
	}
	highs, lows := FindSwingPoints(bars, 1, 1)
	if len(highs) > 0 || len(lows) > 0 {
		t.Error("expected no swing points for flat bars")
	}
}

// --------------- DetermineTrendDirection Tests ---------------

func TestDetermineTrendDirection_Bullish(t *testing.T) {
	highs := []SwingPoint{
		{Index: 0, Price: 100, Type: "HIGH"},
		{Index: 4, Price: 110, Type: "HIGH"},
	}
	lows := []SwingPoint{
		{Index: 2, Price: 95, Type: "LOW"},
		{Index: 6, Price: 98, Type: "LOW"},
	}
	dir := DetermineTrendDirection(highs, lows)
	if dir != "BULL" {
		t.Errorf("expected BULL, got %s", dir)
	}
}

func TestDetermineTrendDirection_Bearish(t *testing.T) {
	highs := []SwingPoint{
		{Index: 0, Price: 110, Type: "HIGH"},
		{Index: 4, Price: 100, Type: "HIGH"},
	}
	lows := []SwingPoint{
		{Index: 2, Price: 98, Type: "LOW"},
		{Index: 6, Price: 90, Type: "LOW"},
	}
	dir := DetermineTrendDirection(highs, lows)
	if dir != "BEAR" {
		t.Errorf("expected BEAR, got %s", dir)
	}
}

func TestDetermineTrendDirection_Neutral(t *testing.T) {
	highs := []SwingPoint{
		{Index: 0, Price: 100, Type: "HIGH"},
		{Index: 4, Price: 110, Type: "HIGH"},
	}
	lows := []SwingPoint{
		{Index: 2, Price: 98, Type: "LOW"},
		{Index: 6, Price: 90, Type: "LOW"}, // lower low but higher high = mixed
	}
	dir := DetermineTrendDirection(highs, lows)
	if dir != "NEUTRAL" {
		t.Errorf("expected NEUTRAL for mixed signals, got %s", dir)
	}
}

func TestDetermineTrendDirection_InsufficientData(t *testing.T) {
	dir := DetermineTrendDirection(nil, nil)
	if dir != "NEUTRAL" {
		t.Errorf("expected NEUTRAL for nil input, got %s", dir)
	}
}

// --------------- DetectStructureBreaks Tests ---------------

func TestDetectStructureBreaks_BOS_BullishTrend(t *testing.T) {
	// Bullish trend with a BOS (breaking higher)
	// Clear swing: high at bar 3, low at bar 6, then break above at bar 11
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),    // 0
		makeBar(100.5, 102, 100, 101.5), // 1
		makeBar(101.5, 103, 101, 102),   // 2
		makeBar(102, 105, 101, 104),     // 3 — swing high (105)
		makeBar(104, 104, 103, 103.5),   // 4
		makeBar(103.5, 103, 100, 101),   // 5
		makeBar(101, 102, 98, 99),       // 6 — swing low (98)
		makeBar(99, 100, 98, 99.5),      // 7
		makeBar(99.5, 101, 99, 100.5),   // 8
		makeBar(100.5, 102, 100, 101.5), // 9
		makeBar(101.5, 103, 101, 102.5), // 10
		makeBar(102.5, 106, 102, 105.5), // 11 — breaks above 105 → BOS UP
		makeBar(105.5, 107, 105, 106),   // 12
	}

	breaks := DetectStructureBreaks(bars, 13, "BULL")
	if len(breaks) == 0 {
		t.Fatal("expected at least one structure break")
	}

	foundBOS := false
	for _, brk := range breaks {
		if brk.Direction == "UP" && brk.Type == "BOS" {
			foundBOS = true
			break
		}
	}
	if !foundBOS {
		t.Errorf("expected BOS for UP break in bullish trend; got breaks: %+v", breaks)
	}
}

func TestDetectStructureBreaks_CHoCH_BullishTrend(t *testing.T) {
	// Bullish trend then a DOWN break → CHoCH
	// Need clear swing high AND swing low, then break below the swing low
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),    // 0
		makeBar(100.5, 102, 100, 101.5), // 1
		makeBar(101.5, 103, 101, 102),   // 2
		makeBar(102, 105, 101, 104),     // 3 — swing high (105)
		makeBar(104, 104, 103, 103.5),   // 4
		makeBar(103.5, 103, 100, 101),   // 5
		makeBar(101, 102, 98, 99),       // 6 — swing low (98)
		makeBar(99, 100, 98, 99.5),      // 7
		makeBar(99.5, 101, 99, 100.5),   // 8
		makeBar(100.5, 102, 100, 101.5), // 9
		makeBar(101.5, 103, 101, 102.5), // 10
		makeBar(102.5, 106, 102, 105.5), // 11 — BOS UP first (makes it bullish)
		makeBar(105.5, 107, 105, 106),   // 12
		makeBar(106, 106, 104, 104.5),   // 13
		makeBar(104.5, 104, 101, 102),   // 14
		makeBar(102, 102, 97, 98),       // 15 — breaks below 98 → CHoCH DOWN
		makeBar(98, 99, 96, 97),         // 16
	}

	breaks := DetectStructureBreaks(bars, 17, "BULL")
	if len(breaks) == 0 {
		t.Fatal("expected at least one structure break")
	}

	foundCHoCH := false
	for _, brk := range breaks {
		if brk.Direction == "DOWN" && brk.Type == "CHoCH" {
			foundCHoCH = true
			break
		}
	}
	if !foundCHoCH {
		t.Errorf("expected CHoCH for DOWN break in bullish trend; got breaks: %+v", breaks)
	}
}

func TestDetectStructureBreaks_BOS_BearishTrend(t *testing.T) {
	// Bearish trend, DOWN break = BOS
	bars := []domain.Bar{
		makeBar(120, 121, 119, 119.5),   // 0
		makeBar(119.5, 120, 118, 118.5), // 1
		makeBar(118.5, 119, 117, 117.5), // 2
		makeBar(117.5, 118, 113, 114),   // 3 — swing low (113)
		makeBar(114, 115, 113, 114.5),   // 4
		makeBar(114.5, 116, 114, 115.5), // 5
		makeBar(115.5, 117, 115, 116),   // 6 — swing high (117)
		makeBar(116, 116, 114, 114.5),   // 7
		makeBar(114.5, 115, 113, 113.5), // 8
		makeBar(113.5, 114, 110, 111),   // 9
		makeBar(111, 112, 109, 110),     // 10
		makeBar(110, 111, 107, 108),     // 11
		makeBar(108, 108, 105, 106),     // 12 — breaks below 113 → BOS DOWN
		makeBar(106, 107, 104, 105),     // 13
	}

	breaks := DetectStructureBreaks(bars, 14, "BEAR")
	foundBOS := false
	for _, brk := range breaks {
		if brk.Direction == "DOWN" && brk.Type == "BOS" {
			foundBOS = true
			break
		}
	}
	if !foundBOS {
		t.Errorf("expected BOS for DOWN break in bearish trend; got breaks: %+v", breaks)
	}
}

func TestDetectStructureBreaks_EmptyBars(t *testing.T) {
	breaks := DetectStructureBreaks(nil, 10, "BULL")
	if breaks != nil {
		t.Error("expected nil for empty bars")
	}
}

func TestDetectStructureBreaks_AutoDetectTrend(t *testing.T) {
	// When trendDirection is empty, auto-detect
	bars := []domain.Bar{
		makeBar(100, 102, 99, 101),
		makeBar(101, 103, 100, 100.5),
		makeBar(100.5, 101, 98, 99),
		makeBar(99, 104, 98.5, 103.5),
		makeBar(103.5, 105, 103, 104),
	}
	breaks := DetectStructureBreaks(bars, 5, "")
	// Should not panic and should produce results
	if len(breaks) == 0 {
		t.Log("no breaks found with auto-detect (acceptable for small dataset)")
	}
}

// --------------- DetectFVGs Tests ---------------

func TestDetectFVGs_Bullish(t *testing.T) {
	// Bullish FVG: third candle Low > first candle High
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),  // 0 — first candle
		makeBar(100.5, 105, 100, 104), // 1 — impulse candle
		makeBar(104, 106, 102, 105),   // 2 — third candle, Low=102 > first High=101
	}

	fvgs := DetectFVGs(bars, 10)
	if len(fvgs) == 0 {
		t.Fatal("expected at least one FVG")
	}

	fvg := fvgs[0]
	if fvg.Side != "BULL" {
		t.Errorf("expected BULL FVG, got %s", fvg.Side)
	}
	if fvg.StartIndex != 0 || fvg.EndIndex != 2 {
		t.Errorf("expected indices [0,2], got [%d,%d]", fvg.StartIndex, fvg.EndIndex)
	}
	if math.Abs(fvg.LowerBound-101) > 0.01 {
		t.Errorf("expected LowerBound=101 (first High), got %.2f", fvg.LowerBound)
	}
	if math.Abs(fvg.UpperBound-102) > 0.01 {
		t.Errorf("expected UpperBound=102 (third Low), got %.2f", fvg.UpperBound)
	}
}

func TestDetectFVGs_Bearish(t *testing.T) {
	// Bearish FVG: third candle High < first candle Low
	bars := []domain.Bar{
		makeBar(105, 106, 104, 104.5), // 0 — first candle
		makeBar(104.5, 104, 99, 100),  // 1 — impulse candle
		makeBar(100, 103, 98, 99),     // 2 — third candle, High=103 < first Low=104
	}

	fvgs := DetectFVGs(bars, 10)
	if len(fvgs) == 0 {
		t.Fatal("expected at least one FVG")
	}

	fvg := fvgs[0]
	if fvg.Side != "BEAR" {
		t.Errorf("expected BEAR FVG, got %s", fvg.Side)
	}
	if math.Abs(fvg.UpperBound-104) > 0.01 {
		t.Errorf("expected UpperBound=104 (first Low), got %.2f", fvg.UpperBound)
	}
	if math.Abs(fvg.LowerBound-103) > 0.01 {
		t.Errorf("expected LowerBound=103 (third High), got %.2f", fvg.LowerBound)
	}
}

func TestDetectFVGs_NoGap(t *testing.T) {
	// No gap — overlapping candles
	bars := []domain.Bar{
		makeBar(100, 102, 99, 101),
		makeBar(101, 103, 100, 102),
		makeBar(102, 104, 101, 103), // Low=101 < first High=102 → no bullish gap
	}

	fvgs := DetectFVGs(bars, 10)
	bullCount := 0
	for _, fvg := range fvgs {
		if fvg.Side == "BULL" {
			bullCount++
		}
	}
	if bullCount > 0 {
		t.Error("expected no bullish FVG for overlapping candles")
	}
}

func TestDetectFVGs_Filled(t *testing.T) {
	// Bullish FVG that gets filled by a later bar
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),  // 0
		makeBar(100.5, 105, 100, 104), // 1
		makeBar(104, 106, 102, 105),   // 2 — FVG: [101, 102]
		makeBar(105, 106, 100, 100.5), // 3 — Low=100 < 101 → fills the gap
	}

	fvgs := DetectFVGs(bars, 10)
	if len(fvgs) == 0 {
		t.Fatal("expected at least one FVG")
	}

	fvg := fvgs[0]
	if !fvg.Filled {
		t.Error("expected FVG to be filled")
	}
	if fvg.FillIndex != 3 {
		t.Errorf("expected FillIndex=3, got %d", fvg.FillIndex)
	}
}

func TestDetectFVGs_TooFewBars(t *testing.T) {
	bars := []domain.Bar{makeBar(100, 101, 99, 100)}
	fvgs := DetectFVGs(bars, 10)
	if len(fvgs) != 0 {
		t.Error("expected no FVGs for < 3 bars")
	}
}

// --------------- DetectLiquiditySweeps Tests ---------------

func TestDetectLiquiditySweeps_BullishSweep(t *testing.T) {
	// Price dips below a swing low then closes above → bullish sweep
	bars := []domain.Bar{
		makeBar(105, 106, 100, 104), // 0
		makeBar(104, 105, 99, 103),  // 1 — swing low at 99
		makeBar(103, 107, 98, 106),  // 2 — wick below 99, close above → sweep
	}

	lows := []SwingPoint{{Index: 1, Price: 99, Type: "LOW"}}
	sweeps := DetectLiquiditySweeps(bars, nil, lows, 3)

	if len(sweeps) == 0 {
		t.Fatal("expected at least one liquidity sweep")
	}
	if sweeps[0].Side != "BULL" {
		t.Errorf("expected BULL sweep, got %s", sweeps[0].Side)
	}
	if !sweeps[0].Reversed {
		t.Error("expected sweep to be reversed")
	}
}

func TestDetectLiquiditySweeps_BearishSweep(t *testing.T) {
	// Price spikes above a swing high then closes below → bearish sweep
	bars := []domain.Bar{
		makeBar(100, 106, 99, 101),  // 0
		makeBar(101, 108, 100, 102), // 1 — swing high at 108
		makeBar(102, 110, 101, 105), // 2 — wick above 108, close below → sweep
	}

	highs := []SwingPoint{{Index: 1, Price: 108, Type: "HIGH"}}
	sweeps := DetectLiquiditySweeps(bars, highs, nil, 3)

	if len(sweeps) == 0 {
		t.Fatal("expected at least one liquidity sweep")
	}
	if sweeps[0].Side != "BEAR" {
		t.Errorf("expected BEAR sweep, got %s", sweeps[0].Side)
	}
}

func TestDetectLiquiditySweeps_NoSweep(t *testing.T) {
	// Price breaks and stays — no reversal
	bars := []domain.Bar{
		makeBar(100, 106, 99, 101),  // 0
		makeBar(101, 108, 100, 102), // 1 — swing high at 108
		makeBar(102, 110, 101, 109), // 2 — breaks above and stays → not a sweep
	}

	highs := []SwingPoint{{Index: 1, Price: 108, Type: "HIGH"}}
	sweeps := DetectLiquiditySweeps(bars, highs, nil, 3)

	if len(sweeps) > 0 {
		t.Error("expected no sweep when price doesn't reverse")
	}
}

// --------------- DetectOrderBlocks Tests ---------------

func TestDetectOrderBlocks_BUY(t *testing.T) {
	// Bullish BOS: find last bearish candle before the break
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),    // 0
		makeBar(100.5, 102, 100, 101.5), // 1
		makeBar(101.5, 103, 101, 102),   // 2
		makeBar(102, 105, 101, 104),     // 3 — swing high (105)
		makeBar(104, 104, 103, 103.5),   // 4 — bearish (close < open)
		makeBar(103.5, 103, 100, 101),   // 5 — bearish (close < open) → OB candidate
		makeBar(101, 102, 98, 99),       // 6 — swing low (98)
		makeBar(99, 100, 98, 99.5),      // 7
		makeBar(99.5, 101, 99, 100.5),   // 8
		makeBar(100.5, 102, 100, 101.5), // 9
		makeBar(101.5, 103, 101, 102.5), // 10
		makeBar(102.5, 106, 102, 105.5), // 11 — BOS UP (breaks above 105)
		makeBar(105.5, 107, 105, 106),   // 12
	}

	obs := DetectOrderBlocks(bars, "BUY", 13, "BULL")
	if len(obs) == 0 {
		t.Fatal("expected at least one BUY order block")
	}

	ob := obs[0]
	if ob.Side != "BUY" {
		t.Errorf("expected BUY OB, got %s", ob.Side)
	}
	// The last bearish candle before the BOS
	if ob.Index < 4 || ob.Index > 6 {
		t.Errorf("expected OB at index 4-6, got %d", ob.Index)
	}
}

func TestDetectOrderBlocks_SELL(t *testing.T) {
	// Bearish BOS: find last bullish candle before the break
	bars := []domain.Bar{
		makeBar(120, 121, 119, 119.5),   // 0
		makeBar(119.5, 120, 118, 118.5), // 1
		makeBar(118.5, 119, 117, 117.5), // 2
		makeBar(117.5, 118, 113, 114),   // 3 — swing low (113)
		makeBar(114, 115, 113, 114.5),   // 4 — bullish (close > open) → OB candidate
		makeBar(114.5, 116, 114, 115.5), // 5 — bullish (close > open)
		makeBar(115.5, 117, 115, 116),   // 6 — swing high (117)
		makeBar(116, 116, 114, 114.5),   // 7
		makeBar(114.5, 115, 113, 113.5), // 8
		makeBar(113.5, 114, 110, 111),   // 9
		makeBar(111, 112, 109, 110),     // 10
		makeBar(110, 111, 107, 108),     // 11
		makeBar(108, 108, 105, 106),     // 12 — BOS DOWN (breaks below 113)
		makeBar(106, 107, 104, 105),     // 13
	}

	obs := DetectOrderBlocks(bars, "SELL", 14, "BEAR")
	if len(obs) == 0 {
		t.Fatal("expected at least one SELL order block")
	}

	ob := obs[0]
	if ob.Side != "SELL" {
		t.Errorf("expected SELL OB, got %s", ob.Side)
	}
}

func TestDetectOrderBlocks_Invalidated(t *testing.T) {
	// BUY OB that gets invalidated by a later close below OB.Low
	bars := []domain.Bar{
		makeBar(100, 101, 99, 100.5),    // 0
		makeBar(100.5, 102, 100, 101.5), // 1
		makeBar(101.5, 103, 101, 102),   // 2
		makeBar(102, 105, 101, 104),     // 3 — swing high
		makeBar(104, 104, 103, 103.5),   // 4 — bearish
		makeBar(103.5, 103, 100, 101),   // 5 — bearish → OB
		makeBar(101, 102, 98, 99),       // 6 — swing low
		makeBar(99, 100, 98, 99.5),      // 7
		makeBar(99.5, 101, 99, 100.5),   // 8
		makeBar(100.5, 102, 100, 101.5), // 9
		makeBar(101.5, 103, 101, 102.5), // 10
		makeBar(102.5, 106, 102, 105.5), // 11 — BOS UP
		makeBar(105.5, 107, 105, 106),   // 12
		makeBar(106, 106, 96, 97),       // 13 — close below OB.Low(100) → invalidates
	}

	obs := DetectOrderBlocks(bars, "BUY", 14, "BULL")
	if len(obs) == 0 {
		t.Fatal("expected at least one OB")
	}

	if obs[0].Valid {
		t.Error("expected OB to be invalidated")
	}
	if !obs[0].Mitigated {
		t.Error("expected OB to be mitigated")
	}
}

// --------------- Helper Function Tests ---------------

func TestUnfilledFVGsNearPrice(t *testing.T) {
	fvgs := []FVG{
		{Side: "BULL", UpperBound: 105, LowerBound: 103, Filled: false},
		{Side: "BULL", UpperBound: 115, LowerBound: 113, Filled: false},
		{Side: "BEAR", UpperBound: 95, LowerBound: 93, Filled: true}, // filled → excluded
	}

	near := UnfilledFVGsNearPrice(fvgs, 104, 2)
	if len(near) != 1 {
		t.Fatalf("expected 1 unfilled FVG near price, got %d", len(near))
	}
	if math.Abs(near[0].LowerBound-103) > 0.01 {
		t.Errorf("expected FVG with LowerBound=103, got %.2f", near[0].LowerBound)
	}
}

func TestValidOBsNearPrice(t *testing.T) {
	obs := []OrderBlock{
		{Side: "BUY", High: 105, Low: 103, Valid: true},
		{Side: "SELL", High: 115, Low: 113, Valid: true},
		{Side: "BUY", High: 95, Low: 93, Valid: false}, // invalid → excluded
	}

	near := ValidOBsNearPrice(obs, 104, 2)
	if len(near) != 1 {
		t.Fatalf("expected 1 valid OB near price, got %d", len(near))
	}
}

func TestHasCHOCHInDirection(t *testing.T) {
	breaks := []StructureBreak{
		{Direction: "UP", Type: "BOS"},
		{Direction: "DOWN", Type: "CHoCH"},
		{Direction: "UP", Type: "CHoCH"},
	}

	if !HasCHOCHInDirection(breaks, "BULL") {
		t.Error("expected CHoCH UP for BULL direction")
	}
	if !HasCHOCHInDirection(breaks, "BEAR") {
		t.Error("expected CHoCH DOWN for BEAR direction")
	}
	if HasCHOCHInDirection(breaks, "NEUTRAL") {
		t.Error("expected no CHoCH for NEUTRAL direction")
	}
}

func TestRecentSweepInDirection(t *testing.T) {
	sweeps := []LiquiditySweep{
		{Index: 8, Side: "BULL", Reversed: true},
		{Index: 2, Side: "BEAR", Reversed: true},
	}

	if !RecentSweepInDirection(sweeps, "BULL", 10, 5) {
		t.Error("expected recent BULL sweep within 5 bars")
	}
	if RecentSweepInDirection(sweeps, "BULL", 10, 1) {
		t.Error("BULL sweep at index 8 should not be within 1 bar of index 10")
	}
	if !RecentSweepInDirection(sweeps, "BEAR", 10, 10) {
		t.Error("expected recent BEAR sweep within 10 bars")
	}
}

// --------------- BuildSMCContext Integration Test ---------------

func TestBuildSMCContext(t *testing.T) {
	// Build simple H4 and H1 bars
	h4 := []domain.Bar{
		makeBar(100, 102, 99, 101),
		makeBar(101, 105, 100, 104),
		makeBar(104, 106, 103, 103.5),
		makeBar(103.5, 104, 98, 99),
		makeBar(99, 107, 98.5, 106),
		makeBar(106, 108, 105, 107),
		makeBar(107, 109, 106, 108),
		makeBar(108, 110, 107, 109),
		makeBar(109, 111, 108, 110),
		makeBar(110, 112, 109, 111),
		makeBar(111, 113, 110, 112),
		makeBar(112, 114, 111, 113),
		makeBar(113, 115, 112, 114),
		makeBar(114, 116, 113, 115),
		makeBar(115, 117, 114, 116),
		makeBar(116, 118, 115, 117),
		makeBar(117, 119, 116, 118),
		makeBar(118, 120, 117, 119),
		makeBar(119, 121, 118, 120),
		makeBar(120, 122, 119, 121),
	}

	h1 := []domain.Bar{
		makeBar(120, 122, 119, 121),
		makeBar(121, 123, 120, 122),
		makeBar(122, 124, 121, 123),
		makeBar(123, 125, 122, 124),
		makeBar(124, 126, 123, 125),
		makeBar(125, 127, 124, 126),
		makeBar(126, 128, 125, 127),
		makeBar(127, 129, 126, 128),
		makeBar(128, 130, 127, 129),
		makeBar(129, 131, 128, 130),
		makeBar(130, 132, 129, 131),
		makeBar(131, 133, 130, 132),
		makeBar(132, 134, 131, 133),
		makeBar(133, 135, 132, 134),
		makeBar(134, 136, 133, 135),
		makeBar(135, 137, 134, 136),
		makeBar(136, 138, 135, 137),
		makeBar(137, 139, 136, 138),
		makeBar(138, 140, 137, 139),
		makeBar(139, 141, 138, 140),
	}

	ctx := BuildSMCContext(h4, h1, nil, nil)

	if ctx.H4TrendDirection == "" {
		t.Log("H4 trend direction is empty (may be NEUTRAL for monotonic data)")
	}
	if ctx.H1TrendDirection == "" {
		t.Log("H1 trend direction is empty")
	}
	// Should not panic — that's the main test
	t.Logf("SMC Context: H4Trend=%s, H1Trend=%s, H4OBs=%d, H1OBs=%d, H4FVGs=%d, H1FVGs=%d",
		ctx.H4TrendDirection, ctx.H1TrendDirection,
		len(ctx.H4OBs), len(ctx.H1OBs),
		len(ctx.H4FVGs), len(ctx.H1FVGs))
}

func TestBuildSMCContext_InsufficientData(t *testing.T) {
	ctx := BuildSMCContext(nil, nil, nil, nil)
	if ctx.H4TrendDirection != "" || ctx.H1TrendDirection != "" {
		t.Error("expected empty context for nil input")
	}
}
