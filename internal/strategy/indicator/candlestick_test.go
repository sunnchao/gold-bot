package indicator

import (
	"testing"

	"gold-bot/internal/domain"
)

// Test helper to create a bar
func makeBar(open, high, low, close, atr float64) domain.Bar {
	return domain.Bar{
		Open:  open,
		High:  high,
		Low:   low,
		Close: close,
		ATR:   atr,
		EMA50: 2000.0, // Neutral baseline
	}
}

// Test helper to create bars with EMA50 values for trend detection
func makeBarsWithTrend(count int, trendType string, atr float64) []domain.Bar {
	bars := make([]domain.Bar, count)
	basePrice := 2000.0

	for i := 0; i < count; i++ {
		price := basePrice
		var open, high, low, close, ema50 float64

		if trendType == "bull" {
			price = basePrice + float64(i)*10
			open = price
			high = price + 8
			low = price - 2
			close = price + 6                   // Bullish bar
			ema50 = basePrice + float64(i)*10.5 // EMA50 slope > 0.1%
		} else if trendType == "bear" {
			price = basePrice - float64(i)*10
			open = price + 6
			high = price + 8
			low = price - 2
			close = price                       // Bearish bar
			ema50 = basePrice - float64(i)*10.5 // EMA50 slope < -0.1%
		} else {
			// neutral
			open = price
			high = price + 5
			low = price - 5
			close = price + 2
			ema50 = price
		}

		bars[i] = domain.Bar{
			Open:  open,
			High:  high,
			Low:   low,
			Close: close,
			ATR:   atr,
			EMA50: ema50,
		}
	}

	return bars
}

func appendTrendBar(bars []domain.Bar, trendType string, open, high, low, close, atr float64) []domain.Bar {
	bar := makeBar(open, high, low, close, atr)
	if len(bars) == 0 {
		return append(bars, bar)
	}

	switch trendType {
	case "bull":
		bar.EMA50 = bars[len(bars)-1].EMA50 + 10.5
	case "bear":
		bar.EMA50 = bars[len(bars)-1].EMA50 - 10.5
	default:
		bar.EMA50 = bars[len(bars)-1].EMA50
	}

	return append(bars, bar)
}

func TestDetectHammer(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid hammer in downtrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1900, 1902.5, 1880, 1902, atr,
				)
				return bars
			}(),
			index:    15,
			expected: true,
		},
		{
			name: "hammer in uptrend - should fail",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2152.5, 2130, 2152, atr,
				)
				return bars
			}(),
			index:    15,
			expected: false,
		},
		{
			name: "insufficient lower shadow",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1900, 1905, 1898, 1902, atr,
				)
				return bars
			}(),
			index:    15,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectHammer(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected hammer to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no hammer, got %+v", result)
			}
		})
	}
}

func TestDetectShootingStar(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid shooting star in uptrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2175, 2149.5, 2152, atr,
				)
				return bars
			}(),
			index:    15,
			expected: true,
		},
		{
			name: "shooting star in downtrend - should fail",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1850, 1885, 1849.5, 1852, atr,
				)
				return bars
			}(),
			index:    15,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectShootingStar(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected shooting star to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no shooting star, got %+v", result)
			}
		})
	}
}

func TestDetectBullishEngulfing(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid bullish engulfing in downtrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1900, 1905, 1890, 1892, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1891, 1910, 1890, 1908, atr,
				)
				return bars
			}(),
			index:    16,
			expected: true,
		},
		{
			name: "bullish engulfing in uptrend - should fail",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2155, 2140, 2142, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2141, 2160, 2140, 2158, atr,
				)
				return bars
			}(),
			index:    16,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectBullishEngulfing(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected bullish engulfing to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no bullish engulfing, got %+v", result)
			}
		})
	}
}

func TestDetectBearishEngulfing(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid bearish engulfing in uptrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2160, 2148, 2158, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2159, 2162, 2145, 2147, atr,
				)
				return bars
			}(),
			index:    16,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectBearishEngulfing(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected bearish engulfing to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no bearish engulfing, got %+v", result)
			}
		})
	}
}

func TestDetectPiercingLine(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid piercing line with 50% penetration",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1900, 1905, 1880, 1885, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1883, 1895, 1880, 1893, atr,
				)
				return bars
			}(),
			index:    16,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectPiercingLine(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected piercing line to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no piercing line, got %+v", result)
			}
		})
	}
}

func TestDetectMorningStar(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid morning star in downtrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1855, 1860, 1830, 1840, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1838, 1839, 1834, 1837, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1838, 1852, 1836, 1849, atr,
				)
				return bars
			}(),
			index:    17,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectMorningStar(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected morning star to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no morning star, got %+v", result)
			}
		})
	}
}

func TestDetectEveningStar(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid evening star in uptrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2170, 2148, 2165, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2166, 2168, 2165.5, 2167, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2166, 2167, 2148, 2154, atr,
				)
				return bars
			}(),
			index:    17,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectEveningStar(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected evening star to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no evening star, got %+v", result)
			}
		})
	}
}

func TestDetectThreeWhiteSoldiers(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid three white soldiers in uptrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bull", atr)
				bars = appendTrendBar(bars, "bull",
					2150, 2160, 2148, 2158, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2155, 2168, 2154, 2166, atr,
				)
				bars = appendTrendBar(bars, "bull",
					2162, 2176, 2161, 2174, atr,
				)
				return bars
			}(),
			index:    17,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectThreeWhiteSoldiers(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected three white soldiers to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no three white soldiers, got %+v", result)
			}
		})
	}
}

func TestDetectThreeBlackCrows(t *testing.T) {
	atr := 20.0

	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected bool
	}{
		{
			name: "valid three black crows in downtrend",
			bars: func() []domain.Bar {
				bars := makeBarsWithTrend(15, "bear", atr)
				bars = appendTrendBar(bars, "bear",
					1850, 1852, 1840, 1842, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1845, 1846, 1832, 1834, atr,
				)
				bars = appendTrendBar(bars, "bear",
					1837, 1838, 1824, 1826, atr,
				)
				return bars
			}(),
			index:    17,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectThreeBlackCrows(tt.bars, tt.index, atr)
			if tt.expected && result == nil {
				t.Errorf("expected three black crows to be detected, got nil")
			}
			if !tt.expected && result != nil {
				t.Errorf("expected no three black crows, got %+v", result)
			}
		})
	}
}

func TestDetectAll(t *testing.T) {
	atr := 20.0

	t.Run("index bounds checking", func(t *testing.T) {
		bars := makeBarsWithTrend(5, "neutral", atr)

		// Test negative index
		result := DetectAll(bars, -1)
		if result != nil {
			t.Errorf("expected nil for negative index, got %v", result)
		}

		// Test index >= len
		result = DetectAll(bars, 10)
		if result != nil {
			t.Errorf("expected nil for out-of-bounds index, got %v", result)
		}
	})

	t.Run("multi-pattern detection", func(t *testing.T) {
		bars := makeBarsWithTrend(15, "bear", atr)
		bars = appendTrendBar(bars, "bear",
			1900, 1902.5, 1880, 1902, atr,
		)

		result := DetectAll(bars, 15)
		if len(result) == 0 {
			t.Errorf("expected at least one pattern to be detected")
		}

		// Check if hammer is in results
		found := false
		for _, p := range result {
			if p == "hammer" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected hammer pattern in results, got %v", result)
		}
	})

	t.Run("strength threshold filtering", func(t *testing.T) {
		// Create bars with very weak patterns (should not pass 0.5 threshold)
		bars := make([]domain.Bar, 15)
		for i := range bars {
			bars[i] = domain.Bar{
				Open:  2000,
				High:  2001,
				Low:   1999,
				Close: 2000.5,
				ATR:   atr,
				EMA50: 2000,
			}
		}

		result := DetectAll(bars, 14)
		// Most patterns should be filtered out due to low strength
		if len(result) > 2 {
			t.Logf("warning: detected %d patterns with weak signals: %v", len(result), result)
		}
	})
}

func TestLocalTrend(t *testing.T) {
	tests := []struct {
		name     string
		bars     []domain.Bar
		index    int
		expected string
	}{
		{
			name:     "insufficient bars",
			bars:     makeBarsWithTrend(5, "bull", 20.0),
			index:    4,
			expected: "neutral",
		},
		{
			name:     "bullish trend",
			bars:     makeBarsWithTrend(15, "bull", 20.0),
			index:    14,
			expected: "bull",
		},
		{
			name:     "bearish trend",
			bars:     makeBarsWithTrend(15, "bear", 20.0),
			index:    14,
			expected: "bear",
		},
		{
			name: "neutral trend",
			bars: func() []domain.Bar {
				bars := make([]domain.Bar, 15)
				for i := range bars {
					bars[i] = domain.Bar{
						Open:  2000,
						High:  2005,
						Low:   1995,
						Close: 2000,
						ATR:   20.0,
						EMA50: 2000,
					}
				}
				return bars
			}(),
			index:    14,
			expected: "neutral",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := localTrend(tt.bars, tt.index)
			if result != tt.expected {
				t.Errorf("expected trend %s, got %s", tt.expected, result)
			}
		})
	}
}

func TestPatternStrength(t *testing.T) {
	atr := 20.0

	t.Run("base strength is 0.5", func(t *testing.T) {
		bars := makeBarsWithTrend(15, "neutral", atr)
		strength := patternStrength(CandleHammer, bars, 14, atr)
		if strength < 0.5 {
			t.Errorf("expected minimum strength 0.5, got %f", strength)
		}
	})

	t.Run("strength clamped to 1.0", func(t *testing.T) {
		bars := makeBarsWithTrend(15, "bear", atr)
		bars = append(bars, domain.Bar{
			Open:  1900,
			High:  1905,
			Low:   1800, // Extremely long shadow
			Close: 1902,
			ATR:   atr,
			EMA50: 1900,
			S1:    1902, // At support
		})
		strength := patternStrength(CandleHammer, bars, 15, atr)
		if strength > 1.0 {
			t.Errorf("expected strength <= 1.0, got %f", strength)
		}
	})

	t.Run("divide-by-zero guard", func(t *testing.T) {
		bars := makeBarsWithTrend(15, "neutral", atr)
		// Add a doji-like bar (body = 0)
		bars = append(bars, domain.Bar{
			Open:  2000,
			High:  2005,
			Low:   1995,
			Close: 2000, // Same as open
			ATR:   atr,
			EMA50: 2000,
		})
		// Should not panic
		strength := patternStrength(CandleHammer, bars, 15, atr)
		if strength < 0.0 || strength > 1.0 {
			t.Errorf("expected strength in [0,1], got %f", strength)
		}
	})
}

// Integration test: run EnrichBars on 100-bar sample
func TestEnrichBarsIntegration(t *testing.T) {
	// Create 100 bars of realistic XAUUSD H1 data
	bars := make([]domain.Bar, 100)
	basePrice := 2000.0

	for i := 0; i < 100; i++ {
		price := basePrice + float64(i%20)*5 - 50 // Simulate some price movement
		bars[i] = domain.Bar{
			Time:   "1640000000",
			Open:   price,
			High:   price + 10,
			Low:    price - 10,
			Close:  price + float64(i%3) - 1,
			Volume: 1000,
		}
	}

	// Run EnrichBars
	enriched := EnrichBars(bars)

	// Verify no panics and all bars processed
	if len(enriched) != 100 {
		t.Fatalf("expected 100 bars, got %d", len(enriched))
	}

	// Verify candlestick patterns field is present
	patternsFound := 0
	for i, bar := range enriched {
		if bar.ATR == 0 && i > 14 {
			t.Errorf("bar %d has ATR=0, expected non-zero", i)
		}

		// CandlestickPatterns should be initialized (can be empty array or nil)
		if bar.CandlestickPatterns != nil && len(bar.CandlestickPatterns) > 0 {
			patternsFound++
			t.Logf("bar %d has patterns: %v (strength threshold passed)", i, bar.CandlestickPatterns)
		}
	}

	t.Logf("EnrichBars integration test complete: %d bars with patterns detected", patternsFound)

	// Verify at least some bars have indicators
	if enriched[99].EMA20 == 0 {
		t.Errorf("expected EMA20 to be calculated on last bar")
	}
}
