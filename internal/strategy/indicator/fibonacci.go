package indicator

// FibLevels holds Fibonacci retracement levels
type FibLevels struct {
	Fib236 float64 `json:"fib_236,omitempty"`
	Fib382 float64 `json:"fib_382,omitempty"`
	Fib500 float64 `json:"fib_500,omitempty"`
	Fib618 float64 `json:"fib_618,omitempty"`
	Fib786 float64 `json:"fib_786,omitempty"`
}

// Fibonacci calculates retracement levels from swing high/low in the given window.
// For uptrend: levels are below the high (retracement down)
// For downtrend: levels are above the low (retracement up)
// Returns the levels based on the most recent swing.
func Fibonacci(highs, lows []float64, window int) FibLevels {
	if len(highs) < window || len(lows) < window || window < 2 {
		return FibLevels{}
	}
	// Find swing high and low in the last `window` bars
	swingHigh := highs[0]
	swingLow := lows[0]
	for i := 1; i < window && i < len(highs); i++ {
		if highs[i] > swingHigh {
			swingHigh = highs[i]
		}
		if lows[i] < swingLow {
			swingLow = lows[i]
		}
	}

	diff := swingHigh - swingLow
	return FibLevels{
		Fib236: swingHigh - diff*0.236,
		Fib382: swingHigh - diff*0.382,
		Fib500: swingHigh - diff*0.500,
		Fib618: swingHigh - diff*0.618,
		Fib786: swingHigh - diff*0.786,
	}
}