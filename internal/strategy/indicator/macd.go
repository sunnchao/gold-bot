package indicator

func MACD(close []float64) ([]float64, []float64, []float64) {
	ema12 := EMA(close, 12)
	ema26 := EMA(close, 26)

	macd := make([]float64, len(close))
	for i := range close {
		macd[i] = ema12[i] - ema26[i]
	}
	signal := EMA(macd, 9)
	hist := make([]float64, len(close))
	for i := range close {
		hist[i] = macd[i] - signal[i]
	}
	return macd, signal, hist
}
