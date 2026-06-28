package harmonic

import (
	"testing"

	"gold-bot/internal/domain"
)

type patternFixture struct {
	name      string
	pattern   string
	direction string
	points    []float64
	explicit  bool // if true, use barsFromExplicitSwings (for Cypher/Shark)
}

func TestDetectPatternsCompletedFixtures(t *testing.T) {
	fixtures := []patternFixture{
		{
			name:      "bullish gartley",
			pattern:   "gartley",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 92.36, 86.18, 84.28},
		},
		{
			name:      "bearish gartley",
			pattern:   "gartley",
			direction: "bearish",
			points:    []float64{100.00, 120.00, 107.64, 113.82, 115.72},
		},
		{
			name:      "bullish bat",
			pattern:   "bat",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 90.00, 84.00, 82.28},
		},
		{
			name:      "bearish bat",
			pattern:   "bat",
			direction: "bearish",
			points:    []float64{100.00, 120.00, 110.00, 116.00, 117.72},
		},
		{
			name:      "bullish butterfly",
			pattern:   "butterfly",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 95.72, 87.86, 74.56},
		},
		{
			name:      "bearish butterfly",
			pattern:   "butterfly",
			direction: "bearish",
			points:    []float64{100.00, 120.00, 104.28, 112.14, 125.44},
		},
		{
			name:      "bullish crab",
			pattern:   "crab",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 92.36, 86.18, 67.64},
		},
		{
			name:      "bearish crab",
			pattern:   "crab",
			direction: "bearish",
			points:    []float64{100.00, 120.00, 107.64, 113.82, 132.36},
		},
		{
			name:      "bullish abcd",
			pattern:   "abcd",
			direction: "bullish",
			points:    []float64{110.00, 100.00, 110.00, 105.00, 95.00},
		},
		{
			name:      "bearish abcd",
			pattern:   "abcd",
			direction: "bearish",
			points:    []float64{90.00, 100.00, 90.00, 95.00, 105.00},
		},
		// Cypher: AB retraces 0.382-0.618 of XA, C exceeds X (signature move),
		// D at 0.786 retrace of XC (NOT XA — Cypher uses XC retrace).
		// Uses barsFromExplicitSwings because zigzag merges B→C without forced dips.
		// Verified ratios: AB/XA=0.382, CD/BC=1.277, XD/XC=0.786
		{
			name:      "bullish cypher",
			pattern:   "cypher",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 87.64, 131.00, 75.63},
			explicit:  true,
		},
		// Bearish Cypher: mirror of bullish.
		// X=80(low), A=100(high), B=92.36(AB/XA=0.382), C=49(exceeds X=80!), D=104.37
		// Verified ratios: AB/XA=0.382, CD/BC=1.277, XD/XC=0.786
		{
			name:      "bearish cypher",
			pattern:   "cypher",
			direction: "bearish",
			points:    []float64{80.00, 100.00, 92.36, 49.00, 104.37},
			explicit:  true,
		},
		// Shark: AB extends 1.13-1.618 beyond X (B exceeds X), D at 0.886 XD/XA
		// Bullish Shark: X=100, A=80, B=102.60(AB/XA=1.13, B>X!), C=94.84, D=82.28(XD/XA=0.886)
		// Verified ratios: AB/XA=1.130, CD/BC=1.618, XD/XA=0.886
		{
			name:      "bullish shark",
			pattern:   "shark",
			direction: "bullish",
			points:    []float64{100.00, 80.00, 102.60, 94.84, 82.28},
			explicit:  true,
		},
		// Bearish Shark: X=80, A=100, B=77.40(AB/XA=1.13, B<X!), C=85.16, D=97.72(XD/XA=0.886)
		// Verified ratios: AB/XA=1.130, CD/BC=1.618, XD/XA=0.886
		{
			name:      "bearish shark",
			pattern:   "shark",
			direction: "bearish",
			points:    []float64{80.00, 100.00, 77.40, 85.16, 97.72},
			explicit:  true,
		},
	}

	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			var bars []domain.Bar
			if fixture.explicit {
				bars = barsFromExplicitSwings(fixture.points)
			} else {
				bars = barsFromSwings(fixture.points)
			}
			patterns := DetectPatterns(bars, "H1")
			pattern := findPattern(patterns, fixture.pattern, fixture.direction)
			if pattern == nil {
				t.Fatalf("missing %s %s in patterns: %#v", fixture.direction, fixture.pattern, patterns)
			}

			if pattern.Status != "completed" {
				t.Fatalf("Status = %q, want completed", pattern.Status)
			}
			if pattern.Timeframe != "H1" {
				t.Fatalf("Timeframe = %q, want H1", pattern.Timeframe)
			}
			if pattern.PRZLow <= 0 || pattern.PRZHigh <= 0 || pattern.PRZLow > pattern.PRZHigh {
				t.Fatalf("invalid PRZ boundaries: low=%v high=%v", pattern.PRZLow, pattern.PRZHigh)
			}
			if pattern.DPrice < pattern.PRZLow || pattern.DPrice > pattern.PRZHigh {
				t.Fatalf("DPrice %v outside PRZ [%v,%v]", pattern.DPrice, pattern.PRZLow, pattern.PRZHigh)
			}
			if pattern.Score <= 0 {
				t.Fatalf("Score = %d, want > 0", pattern.Score)
			}
			if pattern.Confidence <= 0 || pattern.Confidence > 1 {
				t.Fatalf("Confidence = %v, want within (0,1]", pattern.Confidence)
			}
			if pattern.Invalidated {
				t.Fatal("completed fixture should not be invalidated")
			}
			if pattern.Reason == "" {
				t.Fatal("Reason should not be empty")
			}
		})
	}
}

func TestDetectPatternsEmptyAndInsufficientBars(t *testing.T) {
	cases := []struct {
		name string
		bars []domain.Bar
	}{
		{name: "empty", bars: nil},
		{name: "insufficient", bars: barsFromSwings([]float64{100, 90, 95, 92})},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			patterns := DetectPatterns(tc.bars, "M30")
			if patterns == nil {
				t.Fatal("patterns should be an empty non-nil slice")
			}
			if len(patterns) != 0 {
				t.Fatalf("len(patterns) = %d, want 0", len(patterns))
			}
		})
	}
}

func TestBuildContextSelectsHighestScoreActivePattern(t *testing.T) {
	h4 := barsFromSwings([]float64{100.00, 80.00, 92.36, 86.18, 67.64})
	h1 := barsFromSwings([]float64{100.00, 80.00, 90.00, 84.00, 82.28})
	m30 := barsFromSwings([]float64{90.00, 100.00, 90.00, 95.00, 105.00})

	context := BuildContext(h4, h1, m30)
	if context.H4Patterns == nil {
		t.Fatal("H4Patterns should be non-nil")
	}
	if context.H1Patterns == nil {
		t.Fatal("H1Patterns should be non-nil")
	}
	if context.M30Patterns == nil {
		t.Fatal("M30Patterns should be non-nil")
	}
	if context.ActivePattern == nil {
		t.Fatal("ActivePattern should be selected")
	}

	all := append([]HarmonicPattern{}, context.H4Patterns...)
	all = append(all, context.H1Patterns...)
	all = append(all, context.M30Patterns...)
	best := all[0]
	for _, pattern := range all[1:] {
		if !pattern.Invalidated && pattern.Score > best.Score {
			best = pattern
		}
	}

	if context.ActivePattern.Type != best.Type {
		t.Fatalf("ActivePattern.Type = %q, want %q", context.ActivePattern.Type, best.Type)
	}
	if context.ActivePattern.Direction != best.Direction {
		t.Fatalf("ActivePattern.Direction = %q, want %q", context.ActivePattern.Direction, best.Direction)
	}
	if context.ActivePattern.Score != best.Score {
		t.Fatalf("ActivePattern.Score = %d, want %d", context.ActivePattern.Score, best.Score)
	}
	if context.DirectionBias != context.ActivePattern.Direction {
		t.Fatalf("DirectionBias = %q, want %q", context.DirectionBias, context.ActivePattern.Direction)
	}
	if context.Score != context.ActivePattern.Score {
		t.Fatalf("Score = %d, want %d", context.Score, context.ActivePattern.Score)
	}
	if context.Summary == "" {
		t.Fatal("Summary should not be empty")
	}
}

// barsFromSwings builds a bar series where each element of points becomes
// a zigzag swing point. BETWEEN each pair of swings, a bridge bar at the
// 50% midpoint ensures the zigzag detects the direction change.
//
// Important: the zigzag will MERGE consecutive same-direction swings.
// For example, if points are [100, 80, 92.36, 86.18, 84.28], the C=86.18
// and D=84.28 (both descending) will merge into a single swing low at 84.28.
// The DetectPatterns 4-swing inference path handles this correctly by
// inferring C from AB ratios.
func barsFromSwings(points []float64) []domain.Bar {
	if len(points) == 0 {
		return nil
	}

	bars := make([]domain.Bar, 0, len(points)*2+4)

	// Prepend: approach the first swing from the opposite direction
	if len(points) >= 2 {
		firstDelta := points[1] - points[0]
		approach := points[0] + firstDelta*0.5
		bars = append(bars, barAround(approach, len(bars)))
	}

	for i, point := range points {
		bars = append(bars, barAround(point, len(bars)))
		if i == len(points)-1 {
			continue
		}
		next := points[i+1]
		delta := next - point
		// Bridge: 50% toward next swing
		halfway := point + delta*0.5
		bars = append(bars, barAround(halfway, len(bars)))
	}

	// Postamble: move away from last swing to trigger the final reversal
	post := points[len(points)-1]
	if len(points) > 1 {
		lastDelta := points[len(points)-1] - points[len(points)-2]
		post = points[len(points)-1] - lastDelta*0.5
	}
	bars = append(bars, barAround(post, len(bars)))

	return bars
}

// barsFromExplicitSwings builds a bar series that forces the zigzag to produce
// alternating high/low swing points at exactly the specified price levels.
//
// The zigzag algorithm records a swing when price direction FLIPS. For standard
// patterns (Gartley/Bat/etc.), the pivots naturally alternate high/low/low/high/low
// and barsFromSwings works fine. But for Cypher (C > X) and Shark (B > X),
// consecutive pivots may be on the same side, and the zigzag merges them.
//
// This generator solves the problem by inserting a "valley" or "peak" bar
// between each pair of same-direction pivots, forcing a zigzag flip.
// The key insight: if current pivot is a HIGH and next pivot is also a HIGH
// (higher), we insert a bar BELOW current to force a flip at current.
// If current is a LOW and next is also a LOW (lower), we insert a bar ABOVE current.
func barsFromExplicitSwings(points []float64) []domain.Bar {
	if len(points) == 0 {
		return nil
	}

	bars := make([]domain.Bar, 0, len(points)*3+4)

	// Prepend: approach from opposite direction to trigger first swing
	if len(points) >= 2 {
		if points[1] < points[0] {
			// points[0] is high → approach from below
			approach := points[0] - (points[0]-points[1])*0.5
			bars = append(bars, barAround(approach, len(bars)))
		} else {
			// points[0] is low → approach from above
			approach := points[0] + (points[1]-points[0])*0.5
			bars = append(bars, barAround(approach, len(bars)))
		}
	}

	for i, point := range points {
		bars = append(bars, barAround(point, len(bars)))

		if i == len(points)-1 {
			continue
		}

		next := points[i+1]
		sameDirection := (next > point && i > 0 && points[i] > points[i-1]) ||
			(next < point && i > 0 && points[i] < points[i-1])

		if sameDirection {
			// Consecutive same-direction pivots: need a forced flip.
			// If both are highs (next > current), insert a valley BELOW current.
			// If both are lows (next < current), insert a peak ABOVE current.
			if next > point {
				// Both highs → insert valley below current
				valley := point - (next-point)*0.3
				bars = append(bars, barAround(valley, len(bars)))
			} else {
				// Both lows → insert peak above current
				peak := point + (point-next)*0.3
				bars = append(bars, barAround(peak, len(bars)))
			}
		} else {
			// Normal alternating direction: just insert a midpoint bridge
			mid := (point + next) / 2
			bars = append(bars, barAround(mid, len(bars)))
		}
	}

	// Postamble: move away from last swing to trigger the final reversal
	post := points[len(points)-1]
	if len(points) > 1 {
		lastDelta := points[len(points)-1] - points[len(points)-2]
		post = points[len(points)-1] - lastDelta*0.5
	}
	bars = append(bars, barAround(post, len(bars)))

	return bars
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func barAround(price float64, index int) domain.Bar {
	// Use a very tight spread (0.001) so bar High ≈ bar Low ≈ price.
	// This prevents the zigzag detector from capturing the wrong extreme
	// (e.g., bar.High when we intend it to be a swing low).
	// The tiny offset ensures High > Low > 0 for valid bar data.
	return domain.Bar{
		Open:  round(price - 0.0005),
		High:  round(price + 0.0005),
		Low:   round(price - 0.0005),
		Close: round(price + 0.0005),
	}
}

func findPattern(patterns []HarmonicPattern, patternType, direction string) *HarmonicPattern {
	for i := range patterns {
		if patterns[i].Type == patternType && patterns[i].Direction == direction {
			return &patterns[i]
		}
	}
	return nil
}

func twoDigit(value int) string {
	if value < 10 {
		return "0" + string(rune('0'+value))
	}
	return string(rune('0'+value/10)) + string(rune('0'+value%10))
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}
