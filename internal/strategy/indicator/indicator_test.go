package indicator_test

import (
	"math"
	"testing"

	"gold-bot/internal/strategy/indicator"
)

func TestEMA20MatchesPythonFixture(t *testing.T) {
	closes := []float64{
		4430, 4433, 4438, 4435, 4437,
		4442, 4440, 4444, 4441, 4448,
		4450, 4446, 4452, 4455, 4451,
		4458, 4460, 4457, 4462, 4465,
	}

	got := indicator.EMA(closes, 20)
	if len(got) != len(closes) {
		t.Fatalf("EMA length = %d, want %d", len(got), len(closes))
	}

	wantTail := []float64{
		4442.15241473154,
		4443.661708566632,
		4445.217736322191,
		4446.339856672458,
		4447.831298894129,
		4449.466413285164,
	}
	assertTailClose(t, "EMA20", got, wantTail, 1e-9)
}

func TestATR14MatchesPythonFixture(t *testing.T) {
	closes := []float64{
		4430, 4433, 4438, 4435, 4437,
		4442, 4440, 4444, 4441, 4448,
		4450, 4446, 4452, 4455, 4451,
		4458, 4460, 4457, 4462, 4465,
	}
	highs := make([]float64, len(closes))
	lows := make([]float64, len(closes))
	for i, close := range closes {
		highs[i] = close + 2.5
		lows[i] = close - 2.0
	}

	got := indicator.ATR(highs, lows, closes, 14)
	if len(got) != len(closes) {
		t.Fatalf("ATR length = %d, want %d", len(got), len(closes))
	}

	wantTail := []float64{
		6.142857142857,
		6.428571428571,
		6.214285714286,
		6.214285714286,
		6.428571428571,
		6.285714285714,
	}
	assertTailClose(t, "ATR14", got, wantTail, 1e-9)
}

func TestRSI14MatchesPythonFixture(t *testing.T) {
	closes := []float64{
		4430, 4433, 4438, 4435, 4437,
		4442, 4440, 4444, 4441, 4448,
		4450, 4446, 4452, 4455, 4451,
		4458, 4460, 4457, 4462, 4465,
	}

	got := indicator.RSI(closes, 14)
	if len(got) != len(closes) {
		t.Fatalf("RSI length = %d, want %d", len(got), len(closes))
	}

	wantTail := []float64{
		69.811320754717,
		71.929824561404,
		70.37037037037,
		70.37037037037,
		71.929824561404,
		70.909090909091,
	}
	assertTailClose(t, "RSI14", got, wantTail, 1e-9)
}

func assertTailClose(t *testing.T, label string, got []float64, wantTail []float64, tolerance float64) {
	t.Helper()

	start := len(got) - len(wantTail)
	for i, want := range wantTail {
		gotValue := got[start+i]
		if math.IsNaN(want) {
			if !math.IsNaN(gotValue) {
				t.Fatalf("%s tail[%d] = %v, want NaN", label, i, gotValue)
			}
			continue
		}
		if math.Abs(gotValue-want) > tolerance {
			t.Fatalf("%s tail[%d] = %.12f, want %.12f", label, i, gotValue, want)
		}
	}
}
