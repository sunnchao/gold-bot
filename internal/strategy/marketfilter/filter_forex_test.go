package marketfilter

import "testing"

func TestMaxSpreadForSymbolUsesPerPairThresholds(t *testing.T) {
	tests := []struct {
		symbol string
		want   float64
	}{
		{symbol: "GBPJPY", want: 6.0},
		{symbol: "EURJPYm#", want: 5.0},
		{symbol: "USDJPY", want: 5.0},
		{symbol: "GBPUSD", want: 4.0},
		{symbol: "USDCAD#", want: 4.0},
		{symbol: "XAUUSD", want: defaultMaxSpread},
	}

	for _, tt := range tests {
		if got := maxSpreadForSymbol(tt.symbol); got != tt.want {
			t.Fatalf("maxSpreadForSymbol(%q) = %v, want %v", tt.symbol, got, tt.want)
		}
	}
}
