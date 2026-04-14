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

	// Fibonacci retracement (using last 50 bars for swing high/low)
	fibWindow := 50
	if len(out) < fibWindow {
		fibWindow = len(out)
	}
	for i := range out {
		start := i - fibWindow
		if start < 0 {
			start = 0
		}
		windowHighs := make([]float64, i-start+1)
		windowLows := make([]float64, i-start+1)
		for j := start; j <= i; j++ {
			windowHighs[j-start] = out[j].High
			windowLows[j-start] = out[j].Low
		}
		fib := Fibonacci(windowHighs, windowLows, len(windowHighs))
		out[i].Fib236 = fib.Fib236
		out[i].Fib382 = fib.Fib382
		out[i].Fib500 = fib.Fib500
		out[i].Fib618 = fib.Fib618
		out[i].Fib786 = fib.Fib786
	}

	// Pivot Points (using previous bar's HLC)
	for i := 1; i < len(out); i++ {
		piv := PivotPoints(out[i-1].High, out[i-1].Low, out[i-1].Close)
		out[i].PP = piv.PP
		out[i].R1 = piv.R1
		out[i].R2 = piv.R2
		out[i].S1 = piv.S1
		out[i].S2 = piv.S2
	}

	return out
}
