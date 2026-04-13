package indicator

import "math"

func ADX(high, low, close []float64, period int) []float64 {
	plusDM := make([]float64, len(close))
	minusDM := make([]float64, len(close))
	tr := make([]float64, len(close))

	for i := range close {
		if i == 0 {
			plusDM[i] = 0
			minusDM[i] = 0
			tr[i] = high[i] - low[i]
			continue
		}

		plusRaw := high[i] - high[i-1]
		minusRaw := low[i-1] - low[i]

		if plusRaw > minusRaw && plusRaw > 0 {
			plusDM[i] = plusRaw
		} else {
			plusDM[i] = 0
		}
		if minusRaw > plusDM[i] && minusRaw > 0 {
			minusDM[i] = minusRaw
		} else {
			minusDM[i] = 0
		}

		tr[i] = math.Max(high[i]-low[i], math.Max(
			math.Abs(high[i]-close[i-1]),
			math.Abs(low[i]-close[i-1]),
		))
	}

	atr := rollingMean(tr, period)
	plusAvg := rollingMean(plusDM, period)
	minusAvg := rollingMean(minusDM, period)

	plusDI := make([]float64, len(close))
	minusDI := make([]float64, len(close))
	dx := make([]float64, len(close))
	for i := range close {
		plusDI[i] = math.NaN()
		minusDI[i] = math.NaN()
		dx[i] = math.NaN()
		if math.IsNaN(atr[i]) || atr[i] == 0 {
			continue
		}
		plusDI[i] = 100 * (plusAvg[i] / atr[i])
		minusDI[i] = 100 * (minusAvg[i] / atr[i])
		denominator := plusDI[i] + minusDI[i]
		if denominator == 0 {
			continue
		}
		dx[i] = 100 * (math.Abs(plusDI[i]-minusDI[i]) / denominator)
	}

	return rollingMean(dx, period)
}
