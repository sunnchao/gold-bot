package domain

import "testing"

func TestBaseSymbolCanonicalizesForexPairs(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{raw: "GBPUSD", want: "GBPUSD"},
		{raw: "gbpusd#", want: "GBPUSD"},
		{raw: "USDCADm#", want: "USDCAD"},
		{raw: "eurjpy", want: "EURJPY"},
		{raw: "USDJPYm#", want: "USDJPY"},
		{raw: "eurusd#", want: "EURUSD"},
	}

	for _, tt := range tests {
		if got := BaseSymbol(tt.raw); got != tt.want {
			t.Fatalf("BaseSymbol(%q) = %q, want %q", tt.raw, got, tt.want)
		}
	}
}
