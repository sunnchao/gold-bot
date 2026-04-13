package indicator

import "math"

func Stoch(high, low, close []float64, period int, smooth int) ([]float64, []float64) {
	lowN := rollingMin(low, period)
	highN := rollingMax(high, period)
	k := make([]float64, len(close))
	for i := range close {
		k[i] = math.NaN()
		if math.IsNaN(lowN[i]) || math.IsNaN(highN[i]) {
			continue
		}
		denominator := highN[i] - lowN[i]
		if denominator == 0 {
			continue
		}
		k[i] = 100 * (close[i] - lowN[i]) / denominator
	}
	d := rollingMean(k, smooth)
	return k, d
}
