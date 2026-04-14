package indicator

import (
	"math"

	"gold-bot/internal/domain"
)

func EnrichBars(bars []domain.Bar) []domain.Bar {
	out := make([]domain.Bar, len(bars))
	copy(out, bars)
	if len(out) == 0 {
		return out
	}

	closeValues := make([]float64, len(out))
	highValues := make([]float64, len(out))
	lowValues := make([]float64, len(out))
	volValues := make([]float64, len(out))
	for i, bar := range out {
		closeValues[i] = bar.Close
		highValues[i] = bar.High
		lowValues[i] = bar.Low
		volValues[i] = float64(bar.Volume)
	}

	ema20 := EMA(closeValues, 20)
	ema50 := EMA(closeValues, 50)
	ema200 := EMA(closeValues, 200)
	atr := ATR(highValues, lowValues, closeValues, 14)
	rsi := RSI(closeValues, 14)
	macd, macdSignal, macdHist := MACD(closeValues)
	adx := ADX(highValues, lowValues, closeValues, 14)
	bbUpper, bbMid, bbLower := Bollinger(closeValues, 20, 2)
	stochK, stochD := Stoch(highValues, lowValues, closeValues, 14, 3)
	volSMA := rollingMean(volValues, 20)

	for i := range out {
		out[i].EMA20 = ema20[i]
		out[i].EMA50 = ema50[i]
		if len(out) >= 200 {
			out[i].EMA200 = ema200[i]
		}
		out[i].ATR = atr[i]
		out[i].RSI = rsi[i]
		out[i].MACD = macd[i]
		out[i].MACDSignal = macdSignal[i]
		out[i].MACDHist = macdHist[i]
		out[i].ADX = adx[i]
		out[i].BBUpper = bbUpper[i]
		out[i].BBMid = bbMid[i]
		out[i].BBLower = bbLower[i]
		out[i].StochK = stochK[i]
		out[i].StochD = stochD[i]
		if !math.IsNaN(volSMA[i]) {
			out[i].VolSMA = volSMA[i]
		}
	}

	return out
}
