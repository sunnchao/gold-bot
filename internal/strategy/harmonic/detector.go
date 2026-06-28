package harmonic

import (
	"fmt"
	"math"
	"sort"

	"gold-bot/internal/domain"
)

const (
	directionBullish = "bullish"
	directionBearish = "bearish"
	statusCompleted  = "completed"
	statusInvalid    = "invalidated"
	statusNeutral    = "neutral"

	patternGartley   = "gartley"
	patternBat       = "bat"
	patternButterfly = "butterfly"
	patternCrab      = "crab"
	patternABCD      = "abcd"
	patternCypher    = "cypher"
	patternShark     = "shark"
)

type swingPoint struct {
	Index int
	Price float64
	Kind  string
}

// structureType defines the geometric constraint for a harmonic pattern.
//   "standard" — all pivots stay within the XA range (Gartley, Bat, Butterfly, Crab, ABCD)
//   "cypher"   — C exceeds X (extension beyond the initial impulse leg)
//   "shark"    — B exceeds X (AB extends beyond XA, i.e. AB/XA > 1.0)
const (
	structureStandard = "standard"
	structureCypher   = "cypher"
	structureShark    = "shark"
)

type patternSpec struct {
	patternType string
	structure   string         // geometric constraint
	abTargets   []ratioTarget  // AB/XA ratio
	xdTargets   []ratioTarget  // XD/XA ratio (standard retrace)
	xcTargets   []ratioTarget  // XD/XC ratio (Cypher retrace: D retrace of XC)
	cdTargets   []ratioTarget  // CD/BC ratio
	abcdTargets []ratioTarget  // CD/AB ratio
}

type ratioTarget struct {
	Value     float64
	Tolerance float64
}

var toleranceByRatio = map[float64]float64{
	0.382: 0.04,
	0.500: 0.05,
	0.618: 0.05,
	0.786: 0.04,
	0.886: 0.04,
	1.000: 0.06,
	1.13:  0.07,
	1.272: 0.08,
	1.618: 0.10,
	2.0:   0.12,
	2.24:  0.13,
	2.618: 0.15,
}

type patternCandidate struct {
	spec          patternSpec
	x             swingPoint
	a             swingPoint
	b             swingPoint
	c             swingPoint
	d             swingPoint
	direction     string
	abRatio       float64
	bcRatio       float64
	cdRatio       float64
	xdRatio       float64
	ratioQuality  float64
	przTargets    []float64
	expectedDLow  float64
	expectedDHigh float64
}

var patternSpecs = []patternSpec{
	{
		patternType: patternGartley,
		structure:   structureStandard,
		abTargets:   []ratioTarget{target(0.618)},
		xdTargets:   []ratioTarget{target(0.786)},
		cdTargets:   []ratioTarget{target(1.272), target(1.618)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
	{
		patternType: patternBat,
		structure:   structureStandard,
		abTargets:   []ratioTarget{target(0.382), target(0.500)},
		xdTargets:   []ratioTarget{target(0.886)},
		cdTargets:   []ratioTarget{target(1.618), target(2.618)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
	{
		patternType: patternButterfly,
		structure:   structureStandard,
		abTargets:   []ratioTarget{target(0.786)},
		xdTargets:   []ratioTarget{target(1.272), target(1.618)},
		cdTargets:   []ratioTarget{target(1.618), target(2.618)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
	{
		patternType: patternCrab,
		structure:   structureStandard,
		abTargets:   []ratioTarget{target(0.382), target(0.618)},
		xdTargets:   []ratioTarget{target(1.618)},
		cdTargets:   []ratioTarget{target(2.618)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
	{
		patternType: patternABCD,
		structure:   structureStandard,
		abTargets:   nil,
		xdTargets:   nil,
		cdTargets:   nil,
		abcdTargets: []ratioTarget{target(1.0)},
	},
	// Cypher: AB retraces 0.382-0.618 of XA, BC extends 1.272-2.0 of AB,
	// C exceeds X (the defining structural feature), D at 0.786 retrace of XC.
	// Note: Cypher uses XC retrace (xdXcRatio) not XA retrace (xdRatio).
	{
		patternType: patternCypher,
		structure:   structureCypher,
		abTargets:   []ratioTarget{target(0.382), target(0.618)},
		xdTargets:   nil, // Cypher doesn't use XD/XA
		xcTargets:   []ratioTarget{target(0.786)}, // D retrace of XC at 0.786
		cdTargets:   []ratioTarget{target(1.272), target(2.0)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
	// Shark: AB extends 1.13-1.618 beyond X (B exceeds X), CD/BC=1.618-2.24,
	// D at 0.886 retrace of the initial move.
	{
		patternType: patternShark,
		structure:   structureShark,
		abTargets:   []ratioTarget{target(1.13), target(1.618)},
		xdTargets:   []ratioTarget{target(0.886)},
		cdTargets:   []ratioTarget{target(1.618), target(2.24)},
		abcdTargets: []ratioTarget{target(1.0)},
	},
}

func DetectPatterns(bars []domain.Bar, timeframe string) []HarmonicPattern {
	patterns := make([]HarmonicPattern, 0)
	swings := extractSwings(bars)
	if len(swings) < 4 {
		return patterns
	}

	start := len(swings) - 12
	if start < 0 {
		start = 0
	}

	// Try 5-swing windows: X, A, B, C, D (standard alternating direction)
	for i := start; i <= len(swings)-5; i++ {
		x := swings[i]
		a := swings[i+1]
		b := swings[i+2]
		c := swings[i+3]
		d := swings[i+4]
		direction, ok := xabcdDirection(x, a, b, c, d)
		if !ok {
			continue
		}

		for _, spec := range patternSpecs {
			candidate, ok := validateCandidate(spec, x, a, b, c, d, direction)
			if !ok {
				continue
			}
			patterns = append(patterns, buildPattern(candidate, timeframe))
		}
	}

	// Try skip-1 5-swing windows: X, A, B, skip, C, D
	// This handles the case where zigzag inserts a small noise swing
	// between two significant same-direction pivots (e.g., between B and C
	// in a Cypher pattern). We try skipping swing[i+3] and using swing[i+4]
	// as C, swing[i+5] as D.
	for i := start; i <= len(swings)-6; i++ {
		x := swings[i]
		a := swings[i+1]
		b := swings[i+2]
		// skip swings[i+3]
		c := swings[i+4]
		d := swings[i+5]
		direction, ok := xabcdDirection(x, a, b, c, d)
		if !ok {
			continue
		}

		for _, spec := range patternSpecs {
			candidate, ok := validateCandidate(spec, x, a, b, c, d, direction)
			if !ok {
				continue
			}
			// Deduplicate against existing patterns
			dup := false
			for _, existing := range patterns {
				if existing.DIndex == d.Index && existing.Type == spec.patternType && existing.Direction == direction {
					dup = true
					break
				}
			}
			if dup {
				continue
			}
			patterns = append(patterns, buildPattern(candidate, timeframe))
		}
	}

	// Try 4-swing windows: X, A, B, D where C is same-direction as D.
	// This handles the common case where C and D are both lows (bullish)
	// or both highs (bearish) and the zigzag merges them into one down/up leg.
	// C is inferred by backtracking from D using each pattern's CD/BC target ratios.
	// D can be at i+3, i+5, or i+7 (skipping noise swings) to handle patterns
	// where zigzag inserts micro-reversals between B and D.
	for i := start; i <= len(swings)-4; i++ {
		x := swings[i]
		a := swings[i+1]
		b := swings[i+2]

		// Try D at various offsets: i+3 (standard), i+5 (skip 1), i+7 (skip 2)
		dOffsets := []int{3}
		if i+5 < len(swings) {
			dOffsets = append(dOffsets, 5)
		}
		if i+7 < len(swings) {
			dOffsets = append(dOffsets, 7)
		}

		for _, dOff := range dOffsets {
			d := swings[i+dOff]

		// Check XAB direction
		// Standard patterns: B must be strictly between X and A
		// ABCD patterns: B can equal X (AB=CD allows B≈X)
		// Shark/Cypher patterns: B can exceed X (AB extension beyond XA)
		xabOkStandard := (x.Price > a.Price && b.Price > a.Price && b.Price < x.Price) ||
			(x.Price < a.Price && b.Price < a.Price && b.Price > x.Price)
		xabOkExtension := (x.Price >= a.Price && b.Price >= a.Price && b.Price <= x.Price) ||
			(x.Price <= a.Price && b.Price <= a.Price && b.Price >= x.Price)
		xabOkBeyond := (x.Price > a.Price && b.Price > x.Price) ||
			(x.Price < a.Price && b.Price < x.Price)
		if !xabOkStandard && !xabOkExtension && !xabOkBeyond {
			continue
		}

		// Determine direction and check D is in PRZ
		direction := ""
		if x.Price > a.Price && d.Price < b.Price {
			direction = directionBullish
		} else if x.Price < a.Price && d.Price > b.Price {
			direction = directionBearish
		}
		// For beyond-X patterns (Shark), also allow D < a (PRZ extends below A)
		if direction == "" && xabOkBeyond {
			if x.Price > a.Price && d.Price < a.Price {
				direction = directionBullish
			} else if x.Price < a.Price && d.Price > a.Price {
				direction = directionBearish
			}
		}
		if direction == "" {
			continue
		}

		// For each pattern spec, backtrack C from D.
		// Two strategies depending on which ratios the spec defines:
		//
		// 1) CD/BC ratios (most patterns): Given D and CD/BC target r,
		//    CD = r * |B-C| → C = (D + rB) / (1+r)
		//
		// 2) CD/AB ratios (ABCD pattern): Given D and CD/AB target r,
		//    CD = r * AB → |C-D| = r * AB
		//    Bullish: C = D + r*AB   Bearish: C = D - r*AB
		for _, spec := range patternSpecs {
			// Strategy 1: CD/BC backtrack
			for _, t := range spec.cdTargets {
				cdTargetRatio := t.Value
				cPrice := (d.Price + cdTargetRatio*b.Price) / (1 + cdTargetRatio)

				// Validate C is between B and D (it must be a retracement)
				if direction == directionBullish {
					if cPrice >= b.Price || cPrice <= d.Price {
						continue
					}
				} else {
					if cPrice <= b.Price || cPrice >= d.Price {
						continue
					}
				}

				c := swingPoint{
					Index: b.Index + 1,
					Price: cPrice,
					Kind:  "low",
				}
				if direction == directionBearish {
					c.Kind = "high"
				}

				candidate, ok := validateCandidate(spec, x, a, b, c, d, direction)
				if !ok {
					continue
				}

				// Deduplicate: skip if we already found a pattern with this D
				dup := false
				for _, existing := range patterns {
					if existing.DIndex == d.Index && existing.Type == spec.patternType && existing.Direction == direction {
						dup = true
						break
					}
				}
				if dup {
					continue
				}
				patterns = append(patterns, buildPattern(candidate, timeframe))
			}

			// Strategy 2: CD/AB backtrack (for ABCD and patterns with abcdTargets)
			for _, t := range spec.abcdTargets {
				cdAbRatio := t.Value
				ab := math.Abs(b.Price - a.Price)
				var cPrice float64
				if direction == directionBullish {
					cPrice = d.Price + cdAbRatio*ab // C is above D
					if cPrice >= b.Price || cPrice <= d.Price {
						continue
					}
				} else {
					cPrice = d.Price - cdAbRatio*ab // C is below D
					if cPrice <= b.Price || cPrice >= d.Price {
						continue
					}
				}

				c := swingPoint{
					Index: b.Index + 1,
					Price: cPrice,
					Kind:  "low",
				}
				if direction == directionBearish {
					c.Kind = "high"
				}

				candidate, ok := validateCandidate(spec, x, a, b, c, d, direction)
				if !ok {
					continue
				}

				dup := false
				for _, existing := range patterns {
					if existing.DIndex == d.Index && existing.Type == spec.patternType && existing.Direction == direction {
						dup = true
						break
					}
				}
				if dup {
					continue
				}
				patterns = append(patterns, buildPattern(candidate, timeframe))
			}
		}
		} // end dOff loop
	}

	sort.SliceStable(patterns, func(i, j int) bool {
		if patterns[i].DIndex != patterns[j].DIndex {
			return patterns[i].DIndex > patterns[j].DIndex
		}
		return patterns[i].Score > patterns[j].Score
	})
	return patterns
}

func BuildContext(h4, h1, m30 []domain.Bar) HarmonicContext {
	context := HarmonicContext{
		H4Patterns:    DetectPatterns(h4, "H4"),
		H1Patterns:    DetectPatterns(h1, "H1"),
		M30Patterns:   DetectPatterns(m30, "M30"),
		DirectionBias: statusNeutral,
		Summary:       "No completed harmonic pattern detected.",
	}

	all := make([]HarmonicPattern, 0, len(context.H4Patterns)+len(context.H1Patterns)+len(context.M30Patterns))
	all = append(all, context.H4Patterns...)
	all = append(all, context.H1Patterns...)
	all = append(all, context.M30Patterns...)

	for i := range all {
		pattern := all[i]
		if pattern.Invalidated || pattern.Status == statusInvalid {
			continue
		}
		if context.ActivePattern == nil || pattern.Score > context.ActivePattern.Score {
			active := pattern
			context.ActivePattern = &active
		}
	}

	if context.ActivePattern != nil {
		context.DirectionBias = context.ActivePattern.Direction
		context.Score = context.ActivePattern.Score
		context.Summary = fmt.Sprintf(
			"%s %s %s completed score=%d PRZ=%.2f-%.2f",
			context.ActivePattern.Timeframe,
			context.ActivePattern.Direction,
			context.ActivePattern.Type,
			context.ActivePattern.Score,
			context.ActivePattern.PRZLow,
			context.ActivePattern.PRZHigh,
		)
	}

	return context
}

func extractSwings(bars []domain.Bar) []swingPoint {
	swings := make([]swingPoint, 0)
	if len(bars) < 2 {
		return swings
	}

	// Zigzag swing detection using sign-of-delta for harmonic patterns.
	// Records a swing each time price direction (mid-price delta) flips.
	// This is intentionally sensitive — harmonic patterns need to capture
	// every directional turning point, even small bounces between C and D.
	// No minimum-move threshold: any sign flip counts.

	prices := make([]float64, len(bars))
	for i, bar := range bars {
		prices[i] = (bar.High + bar.Low) / 2
	}

	// Find initial direction
	dir := 0 // 1=up, -1=down
	for i := 1; i < len(prices); i++ {
		if prices[i] > prices[i-1] {
			dir = 1
			break
		} else if prices[i] < prices[i-1] {
			dir = -1
			break
		}
	}
	if dir == 0 {
		// Flat series — no swings
		return swings
	}

	// Track extremes in current direction
	var extremumIdx int
	var extremumPrice float64

	if dir == 1 {
		extremumIdx = 0
		extremumPrice = prices[0]
	} else {
		extremumIdx = 0
		extremumPrice = prices[0]
	}

	for i := 1; i < len(prices); i++ {
		if dir == 1 {
			if prices[i] > extremumPrice {
				extremumPrice = prices[i]
				extremumIdx = i
			}
			if prices[i] < prices[i-1] {
				// Direction flipped to down — record the high
				swings = append(swings, swingPoint{Index: extremumIdx, Price: bars[extremumIdx].High, Kind: "high"})
				dir = -1
				extremumPrice = prices[i]
				extremumIdx = i
			}
		} else { // dir == -1
			if prices[i] < extremumPrice {
				extremumPrice = prices[i]
				extremumIdx = i
			}
			if prices[i] > prices[i-1] {
				// Direction flipped to up — record the low
				swings = append(swings, swingPoint{Index: extremumIdx, Price: bars[extremumIdx].Low, Kind: "low"})
				dir = 1
				extremumPrice = prices[i]
				extremumIdx = i
			}
		}
	}

	// Append final pending extreme
	if dir == 1 {
		swings = append(swings, swingPoint{Index: extremumIdx, Price: bars[extremumIdx].High, Kind: "high"})
	} else {
		swings = append(swings, swingPoint{Index: extremumIdx, Price: bars[extremumIdx].Low, Kind: "low"})
	}

	if len(swings) > 20 {
		return swings[len(swings)-20:]
	}
	return swings
}

func appendSwing(swings []swingPoint, point swingPoint) []swingPoint {
	if len(swings) == 0 {
		return append(swings, point)
	}

	last := &swings[len(swings)-1]
	if last.Kind != point.Kind {
		return append(swings, point)
	}

	if point.Kind == "high" && point.Price > last.Price {
		*last = point
	}
	if point.Kind == "low" && point.Price < last.Price {
		*last = point
	}
	return swings
}

// filterNoiseSwings removes swings whose amplitude is insignificant compared
// to their neighbors. A swing is "noise" if the move to reach it and leave it
// is less than noiseRatio (default 0.20 = 20%) of the larger adjacent move.
// This is critical for Cypher/Shark where zigzag inserts micro-reversals
// between B and C that should be treated as a single leg.
func filterNoiseSwings(swings []swingPoint) []swingPoint {
	if len(swings) < 5 {
		return swings
	}

	const noiseRatio = 0.25

	// Compute move sizes between consecutive swings
	type move struct {
		from, to int
		size     float64
	}
	moves := make([]move, len(swings)-1)
	for i := 0; i < len(swings)-1; i++ {
		moves[i] = move{from: i, to: i + 1, size: math.Abs(swings[i+1].Price - swings[i].Price)}
	}

	// Mark swings as noise: if BOTH the incoming and outgoing moves at a swing
	// are < noiseRatio * max(incoming, outgoing neighbor moves), it's noise.
	noise := make([]bool, len(swings))
	for i := 1; i < len(swings)-1; i++ {
		inMove := moves[i-1].size   // move arriving at swing[i]
		outMove := moves[i].size    // move leaving swing[i]

		// Find the largest adjacent move for context
		maxAdjacent := inMove
		if outMove > maxAdjacent {
			maxAdjacent = outMove
		}
		// Also check one step further out for larger context
		if i-2 >= 0 && moves[i-2].size > maxAdjacent {
			maxAdjacent = moves[i-2].size
		}
		if i+1 < len(moves) && moves[i+1].size > maxAdjacent {
			maxAdjacent = moves[i+1].size
		}

		if maxAdjacent == 0 {
			continue
		}
		if inMove < noiseRatio*maxAdjacent && outMove < noiseRatio*maxAdjacent {
			noise[i] = true
		}
	}

	// Build filtered list, keeping first and last swings always
	filtered := make([]swingPoint, 0, len(swings))
	for i, s := range swings {
		if !noise[i] || i == 0 || i == len(swings)-1 {
			filtered = append(filtered, s)
		}
	}

	return filtered
}

func typicalPrice(bar domain.Bar) float64 {
	if bar.High != 0 || bar.Low != 0 {
		return (bar.High + bar.Low) / 2
	}
	if bar.Close != 0 {
		return bar.Close
	}
	return bar.Open
}

func xabcdDirection(x, a, b, c, d swingPoint) (string, bool) {
	// Determine direction from price relationships.
	// Standard harmonic (Gartley/Bat/Butterfly/Crab):
	//   Bullish: X > A, A < B < X, B > C, D < B (D in PRZ below B)
	//   Bearish: X < A, A > B > X, B < C, D > B (D in PRZ above B)
	//
	// ABCD extension (D can exceed X):
	//   Bullish ABCD: X >= A, B >= A (or B ≈ X), C < B, D < C
	//   Bearish ABCD: X <= A, B <= A (or B ≈ X), C > B, D > C
	//
	// Cypher (C exceeds X — the signature structural move):
	//   Bullish: X > A, B between A and X, C > X (exceeds!), D between A and X
	//   Bearish: X < A, B between A and X, C < X (exceeds!), D between A and X
	//
	// Shark (B exceeds X — AB extends beyond XA):
	//   Bullish: X > A, B > X (exceeds!), C between B and A, D between A and X
	//   Bearish: X < A, B < X (exceeds!), C between B and A, D between A and X
	//
	// We also accept "same-direction" C/D pairs (e.g., C and D both below B
	// in bullish patterns) as long as D is the deeper retracement.

	// Standard harmonic patterns (D stays within XA range)
	if x.Price > a.Price && b.Price > a.Price && b.Price < x.Price && c.Price < b.Price && d.Price < b.Price {
		return directionBullish, true
	}
	if x.Price < a.Price && b.Price < a.Price && b.Price > x.Price && c.Price > b.Price && d.Price > b.Price {
		return directionBearish, true
	}

	// Cypher patterns: C exceeds X (extension)
	// Bullish Cypher: X > A, B between A and X, C > X, D < B (D in PRZ)
	if x.Price > a.Price && b.Price > a.Price && b.Price <= x.Price && c.Price > x.Price && d.Price < b.Price {
		return directionBullish, true
	}
	// Bearish Cypher: X < A, B between A and X, C < X, D > B (D in PRZ)
	if x.Price < a.Price && b.Price < a.Price && b.Price >= x.Price && c.Price < x.Price && d.Price > b.Price {
		return directionBearish, true
	}

	// Shark patterns: B exceeds X (AB extension beyond XA)
	// Bullish Shark: X > A, B > X, C between B and X (pulling back), D < B
	if x.Price > a.Price && b.Price > x.Price && c.Price < b.Price && c.Price >= x.Price && d.Price < b.Price && d.Price >= a.Price {
		return directionBullish, true
	}
	// Bearish Shark: X < A, B < X, C between B and X (pulling back), D > B
	if x.Price < a.Price && b.Price < x.Price && c.Price > b.Price && c.Price <= x.Price && d.Price > b.Price && d.Price <= a.Price {
		return directionBearish, true
	}

	// ABCD / extension patterns where D may exceed X
	// Bullish: price generally declining from X→A, bouncing to B, declining through C to D
	if x.Price >= a.Price && b.Price >= a.Price && c.Price < b.Price && d.Price < c.Price {
		return directionBullish, true
	}
	// Bearish: price generally rising from X→A, dropping to B, rising through C to D
	if x.Price <= a.Price && b.Price <= a.Price && c.Price > b.Price && d.Price > c.Price {
		return directionBearish, true
	}

	return "", false
}

func alternates(points ...swingPoint) bool {
	for i := 1; i < len(points); i++ {
		if points[i].Kind == points[i-1].Kind {
			return false
		}
	}
	return true
}

func validateCandidate(spec patternSpec, x, a, b, c, d swingPoint, direction string) (patternCandidate, bool) {
	// Structure constraint check — must match before ratio validation.
	switch spec.structure {
	case structureStandard:
		// Standard: all pivots within XA range
		// Bullish: A < D < B < X, Bearish: A > D > B > X
		// C must stay within XA (below X for bullish, above X for bearish)
		if direction == directionBullish && c.Price > x.Price {
			return patternCandidate{}, false
		}
		if direction == directionBearish && c.Price < x.Price {
			return patternCandidate{}, false
		}
		// B must stay within XA (below X for bullish, above X for bearish)
		if direction == directionBullish && b.Price > x.Price {
			return patternCandidate{}, false
		}
		if direction == directionBearish && b.Price < x.Price {
			return patternCandidate{}, false
		}
	case structureCypher:
		// Cypher: C must exceed X (the defining structural move)
		if direction == directionBullish && c.Price <= x.Price {
			return patternCandidate{}, false
		}
		if direction == directionBearish && c.Price >= x.Price {
			return patternCandidate{}, false
		}
		// B must stay within XA
		if direction == directionBullish && b.Price > x.Price {
			return patternCandidate{}, false
		}
		if direction == directionBearish && b.Price < x.Price {
			return patternCandidate{}, false
		}
	case structureShark:
		// Shark: B must exceed X (AB extension beyond XA)
		if direction == directionBullish && b.Price <= x.Price {
			return patternCandidate{}, false
		}
		if direction == directionBearish && b.Price >= x.Price {
			return patternCandidate{}, false
		}
	}

	xa := math.Abs(a.Price - x.Price)
	ab := math.Abs(b.Price - a.Price)
	bc := math.Abs(c.Price - b.Price)
	cd := math.Abs(d.Price - c.Price)
	if xa == 0 || ab == 0 || bc == 0 || cd == 0 {
		return patternCandidate{}, false
	}

	candidate := patternCandidate{
		spec:      spec,
		x:         x,
		a:         a,
		b:         b,
		c:         c,
		d:         d,
		direction: direction,
		abRatio:   ab / xa,
		bcRatio:   bc / ab,
		cdRatio:   cd / bc,
		xdRatio:   math.Abs(d.Price-x.Price) / xa,
	}

	// XC retrace ratio: |D-X| / |C-X| (used by Cypher where D retrace is of XC, not XA)
	xcRatio := 0.0
	xc := math.Abs(c.Price - x.Price)
	if xc > 0 {
		xcRatio = math.Abs(d.Price - x.Price) / xc
	}

	var qualities []float64
	if len(spec.abTargets) > 0 {
		quality, ok := bestRatioQuality(candidate.abRatio, spec.abTargets)
		if !ok {
			return patternCandidate{}, false
		}
		qualities = append(qualities, quality)
	}
	if len(spec.xdTargets) > 0 {
		quality, ok := bestRatioQuality(candidate.xdRatio, spec.xdTargets)
		if !ok {
			return patternCandidate{}, false
		}
		qualities = append(qualities, quality)
	}
	if len(spec.xcTargets) > 0 {
		quality, ok := bestRatioQuality(xcRatio, spec.xcTargets)
		if !ok {
			return patternCandidate{}, false
		}
		qualities = append(qualities, quality)
	}
	if len(spec.cdTargets) > 0 {
		quality, ok := bestRatioQuality(candidate.cdRatio, spec.cdTargets)
		if !ok {
			return patternCandidate{}, false
		}
		qualities = append(qualities, quality)
	}
	if len(spec.abcdTargets) > 0 {
		abcdRatio := cd / ab
		quality, ok := bestRatioQuality(abcdRatio, spec.abcdTargets)
		if spec.patternType == patternABCD && !ok {
			return patternCandidate{}, false
		}
		if ok {
			qualities = append(qualities, quality)
		}
	}

	if len(qualities) == 0 {
		return patternCandidate{}, false
	}
	candidate.ratioQuality = average(qualities)
	candidate.przTargets = projectedDTargets(candidate)
	if len(candidate.przTargets) == 0 {
		return patternCandidate{}, false
	}
	candidate.expectedDLow, candidate.expectedDHigh = minMax(candidate.przTargets)
	if !priceInRange(candidate.d.Price, candidate.expectedDLow, candidate.expectedDHigh) {
		return patternCandidate{}, false
	}
	return candidate, true
}

func buildPattern(candidate patternCandidate, timeframe string) HarmonicPattern {
	przLow, przHigh := buildPRZ(candidate)
	invalidated := isInvalidated(candidate, przLow, przHigh)
	status := statusCompleted
	if invalidated {
		status = statusInvalid
	}

	score := scoreCandidate(candidate, timeframe, przLow, przHigh, invalidated)
	pattern := HarmonicPattern{
		Type:        candidate.spec.patternType,
		Direction:   candidate.direction,
		Timeframe:   timeframe,
		Status:      status,
		XIndex:      candidate.x.Index,
		AIndex:      candidate.a.Index,
		BIndex:      candidate.b.Index,
		CIndex:      candidate.c.Index,
		DIndex:      candidate.d.Index,
		XPrice:      round(candidate.x.Price),
		APrice:      round(candidate.a.Price),
		BPrice:      round(candidate.b.Price),
		CPrice:      round(candidate.c.Price),
		DPrice:      round(candidate.d.Price),
		ABRatio:     roundRatio(candidate.abRatio),
		BCRatio:     roundRatio(candidate.bcRatio),
		CDRatio:     roundRatio(candidate.cdRatio),
		XDRatio:     roundRatio(candidate.xdRatio),
		PRZLow:      round(przLow),
		PRZHigh:     round(przHigh),
		Invalidated: invalidated,
		Score:       score,
		Confidence:  roundRatio(float64(score) / 100),
	}
	pattern.StopLoss, pattern.Target1, pattern.Target2 = tradeLevels(candidate, pattern.PRZLow, pattern.PRZHigh)
	pattern.Reason = fmt.Sprintf("AB/XA=%.3f, BC/AB=%.3f, CD/BC=%.3f, XD/XA=%.3f", pattern.ABRatio, pattern.BCRatio, pattern.CDRatio, pattern.XDRatio)
	return pattern
}

func buildPRZ(candidate patternCandidate) (float64, float64) {
	targets := append([]float64{}, candidate.przTargets...)
	targets = append(targets, candidate.d.Price)
	low, high := minMax(targets)

	price := math.Abs(candidate.d.Price)
	maxWidth := math.Max(math.Abs(candidate.a.Price-candidate.x.Price)*0.20, price*0.0015)
	if maxWidth <= 0 {
		return low, high
	}

	mid := (low + high) / 2
	if high-low > maxWidth {
		low = mid - maxWidth/2
		high = mid + maxWidth/2
		if candidate.d.Price < low {
			low = candidate.d.Price
		}
		if candidate.d.Price > high {
			high = candidate.d.Price
		}
	}
	return low, high
}

func tradeLevels(candidate patternCandidate, przLow, przHigh float64) (float64, float64, float64) {
	rangeSize := math.Abs(candidate.a.Price - candidate.d.Price)
	if rangeSize == 0 {
		rangeSize = math.Abs(candidate.x.Price-candidate.a.Price) * 0.5
	}
	if candidate.direction == directionBullish {
		stopLoss := przLow - math.Abs(candidate.x.Price-candidate.a.Price)*0.10
		target1 := candidate.d.Price + rangeSize*0.382
		target2 := candidate.d.Price + rangeSize*0.618
		return round(stopLoss), round(target1), round(target2)
	}

	stopLoss := przHigh + math.Abs(candidate.x.Price-candidate.a.Price)*0.10
	target1 := candidate.d.Price - rangeSize*0.382
	target2 := candidate.d.Price - rangeSize*0.618
	return round(stopLoss), round(target1), round(target2)
}

func scoreCandidate(candidate patternCandidate, timeframe string, przLow, przHigh float64, invalidated bool) int {
	ratioScore := candidate.ratioQuality * 40

	width := math.Abs(przHigh - przLow)
	xa := math.Abs(candidate.a.Price - candidate.x.Price)
	przScore := 20.0
	if xa > 0 {
		przScore = clampFloat(20-(width/xa)*40, 0, 20)
	}

	completionScore := 15.0
	timeframeScore := map[string]float64{
		"H4":  10,
		"H1":  8,
		"M30": 6,
	}[timeframe]
	if timeframeScore == 0 {
		timeframeScore = 5
	}

	score := int(math.Round(ratioScore + przScore + completionScore + timeframeScore))
	if invalidated {
		score -= 30
	}
	return clampInt(score, 0, 100)
}

func isInvalidated(candidate patternCandidate, przLow, przHigh float64) bool {
	buffer := math.Abs(candidate.a.Price-candidate.x.Price) * 0.10
	if candidate.direction == directionBullish {
		return candidate.d.Price < przLow-buffer
	}
	return candidate.d.Price > przHigh+buffer
}

func projectedDTargets(candidate patternCandidate) []float64 {
	targets := make([]float64, 0, len(candidate.spec.xdTargets)+len(candidate.spec.cdTargets)+len(candidate.spec.abcdTargets))
	xa := math.Abs(candidate.a.Price - candidate.x.Price)
	bc := math.Abs(candidate.c.Price - candidate.b.Price)
	ab := math.Abs(candidate.b.Price - candidate.a.Price)

	for _, ratio := range candidate.spec.xdTargets {
		if candidate.direction == directionBullish {
			targets = append(targets, candidate.x.Price-xa*ratio.Value)
		} else {
			targets = append(targets, candidate.x.Price+xa*ratio.Value)
		}
	}
	for _, ratio := range candidate.spec.cdTargets {
		if candidate.direction == directionBullish {
			targets = append(targets, candidate.c.Price-bc*ratio.Value)
		} else {
			targets = append(targets, candidate.c.Price+bc*ratio.Value)
		}
	}
	for _, ratio := range candidate.spec.abcdTargets {
		if candidate.direction == directionBullish {
			targets = append(targets, candidate.c.Price-ab*ratio.Value)
		} else {
			targets = append(targets, candidate.c.Price+ab*ratio.Value)
		}
	}
	return targets
}

func bestRatioQuality(value float64, targets []ratioTarget) (float64, bool) {
	best := 0.0
	for _, target := range targets {
		delta := math.Abs(value - target.Value)
		if delta > target.Tolerance {
			continue
		}
		quality := 1 - delta/target.Tolerance
		if quality > best {
			best = quality
		}
	}
	return best, best > 0
}

func target(value float64) ratioTarget {
	tolerance, ok := toleranceByRatio[value]
	if !ok {
		tolerance = 0.05
	}
	return ratioTarget{Value: value, Tolerance: tolerance}
}

func minMax(values []float64) (float64, float64) {
	low := values[0]
	high := values[0]
	for _, value := range values[1:] {
		if value < low {
			low = value
		}
		if value > high {
			high = value
		}
	}
	return low, high
}

func priceInRange(price, low, high float64) bool {
	if low > high {
		low, high = high, low
	}
	return price >= low && price <= high
}

func average(values []float64) float64 {
	sum := 0.0
	for _, value := range values {
		sum += value
	}
	return sum / float64(len(values))
}

func clampFloat(value, low, high float64) float64 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}

func roundRatio(value float64) float64 {
	return math.Round(value*1000) / 1000
}
