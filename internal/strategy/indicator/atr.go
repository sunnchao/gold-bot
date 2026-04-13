package indicator

import "math"

func ATR(high, low, close []float64, period int) []float64 {
	tr := make([]float64, len(close))
	for i := range close {
		if i == 0 {
			tr[i] = high[i] - low[i]
			continue
		}
		tr[i] = math.Max(high[i]-low[i], math.Max(
			math.Abs(high[i]-close[i-1]),
			math.Abs(low[i]-close[i-1]),
		))
	}
	return rollingMean(tr, period)
}
