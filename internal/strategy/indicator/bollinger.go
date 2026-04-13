package indicator

func Bollinger(close []float64, period int, width float64) ([]float64, []float64, []float64) {
	mid := rollingMean(close, period)
	std := rollingStd(close, period)
	upper := make([]float64, len(close))
	lower := make([]float64, len(close))
	for i := range close {
		upper[i] = mid[i] + width*std[i]
		lower[i] = mid[i] - width*std[i]
	}
	return upper, mid, lower
}
