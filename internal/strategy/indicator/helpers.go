package indicator

import (
	"math"
)

func rollingMean(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if period <= 0 {
		return out
	}

	for i := period - 1; i < len(values); i++ {
		sum := 0.0
		valid := 0
		for j := i - period + 1; j <= i; j++ {
			if math.IsNaN(values[j]) {
				continue
			}
			sum += values[j]
			valid++
		}
		if valid == period {
			out[i] = sum / float64(period)
		}
	}
	return out
}

func rollingMin(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if period <= 0 {
		return out
	}

	for i := period - 1; i < len(values); i++ {
		minValue := math.Inf(1)
		valid := 0
		for j := i - period + 1; j <= i; j++ {
			if math.IsNaN(values[j]) {
				continue
			}
			if values[j] < minValue {
				minValue = values[j]
			}
			valid++
		}
		if valid == period {
			out[i] = minValue
		}
	}
	return out
}

func rollingMax(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if period <= 0 {
		return out
	}

	for i := period - 1; i < len(values); i++ {
		maxValue := math.Inf(-1)
		valid := 0
		for j := i - period + 1; j <= i; j++ {
			if math.IsNaN(values[j]) {
				continue
			}
			if values[j] > maxValue {
				maxValue = values[j]
			}
			valid++
		}
		if valid == period {
			out[i] = maxValue
		}
	}
	return out
}

func rollingStd(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if period <= 0 {
		return out
	}

	for i := period - 1; i < len(values); i++ {
		sum := 0.0
		valid := 0
		for j := i - period + 1; j <= i; j++ {
			if math.IsNaN(values[j]) {
				continue
			}
			sum += values[j]
			valid++
		}
		if valid != period || period == 1 {
			continue
		}

		mean := sum / float64(period)
		variance := 0.0
		for j := i - period + 1; j <= i; j++ {
			diff := values[j] - mean
			variance += diff * diff
		}
		out[i] = math.Sqrt(variance / float64(period-1))
	}
	return out
}

func round2(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}
