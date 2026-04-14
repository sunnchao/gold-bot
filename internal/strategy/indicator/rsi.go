package indicator

import "math"

func RSI(close []float64, period int) []float64 {
	out := make([]float64, len(close))
	for i := range out {
		out[i] = math.NaN()
	}
	if len(close) == 0 || period <= 0 {
		return out
	}

	delta := make([]float64, len(close))
	gains := make([]float64, len(close))
	losses := make([]float64, len(close))
	for i := range close {
		if i == 0 {
			delta[i] = 0
			gains[i] = 0
			losses[i] = 0
			continue
		}
		delta[i] = close[i] - close[i-1]
		if delta[i] > 0 {
			gains[i] = delta[i]
		} else {
			gains[i] = 0
		}
		if delta[i] < 0 {
			losses[i] = -delta[i]
		} else {
			losses[i] = 0
		}
	}

	avgGain := WildersSmoothing(gains, period)
	avgLoss := WildersSmoothing(losses, period)
	for i := range close {
		if math.IsNaN(avgGain[i]) || math.IsNaN(avgLoss[i]) || avgLoss[i] == 0 {
			continue
		}
		rs := avgGain[i] / avgLoss[i]
		out[i] = 100 - (100 / (1 + rs))
	}
	return out
}
