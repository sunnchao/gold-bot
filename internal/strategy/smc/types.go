package smc

// SwingPoint represents a local swing high or swing low on a price chart.
type SwingPoint struct {
	Index int     // Bar index in the source slice
	Price float64 // High for swing high, Low for swing low
	Type  string  // "HIGH" or "LOW"
}

// StructureBreak represents a break of market structure.
// Type distinguishes trend continuation (BOS) from potential reversal (CHoCH).
type StructureBreak struct {
	Index     int     // Bar index where the break occurred
	Direction string  // "UP" or "DOWN" — direction of the break
	Level     float64 // The swing point price that was broken
	Type      string  // "BOS" (continuation) or "CHoCH" (reversal)
}

// FVG represents a Fair Value Gap — a three-candle price imbalance.
type FVG struct {
	StartIndex int     // First candle index
	EndIndex   int     // Third candle index
	Side       string  // "BULL" or "BEAR"
	UpperBound float64 // Top of the gap zone
	LowerBound float64 // Bottom of the gap zone
	Filled     bool    // Whether price has retraced into and filled the gap
	FillIndex  int     // Bar index where gap was filled (0 = not filled)
}

// OrderBlock represents an institutional order block zone.
type OrderBlock struct {
	Index     int     // Bar index of the order block candle
	Side      string  // "BUY" or "SELL"
	High      float64 // Upper bound of the OB zone
	Low       float64 // Lower bound of the OB zone
	Valid     bool    // Whether the OB is still unmitigated
	Mitigated bool    // Whether price has returned and filled through the zone
	AgeBars   int     // Number of bars since formation
}

// LiquiditySweep represents a liquidity grab — price sweeps a key level then reverses.
type LiquiditySweep struct {
	Index    int     // Bar index of the sweep candle
	Level    float64 // The swing point level that was swept
	Side     string  // "BULL" (swept lows then reversed up) or "BEAR" (swept highs then reversed down)
	Reversed bool    // Whether price has reversed after the sweep
}

// SMCContext holds multi-timeframe SMC analysis results.
type SMCContext struct {
	H4OBs    []OrderBlock
	H1OBs    []OrderBlock
	H1ShortOBs []OrderBlock // lookback=20 for breakout_pyramid strategy
	H4FVGs   []FVG
	H1FVGs   []FVG
	H4Breaks []StructureBreak
	H1Breaks []StructureBreak
	H4Sweeps []LiquiditySweep
	H1Sweeps []LiquiditySweep

	// Trend direction derived from structure breaks
	H4TrendDirection string // "BULL", "BEAR", "NEUTRAL"
	H1TrendDirection string // "BULL", "BEAR", "NEUTRAL"
}
