package engine

import "testing"

func TestGetStrategyConfigBySymbolReturnsForexConfigs(t *testing.T) {
	tests := []struct {
		symbol  string
		wantADX float64
		wantRSI float64
	}{
		{symbol: "EURUSD", wantADX: 20.0, wantRSI: 40.0},
		{symbol: "GBPUSD", wantADX: 22.0, wantRSI: 42.0},
		{symbol: "USDCAD", wantADX: 25.0, wantRSI: 40.0},
	}

	for _, tt := range tests {
		cfg := GetStrategyConfigBySymbol(tt.symbol)
		if cfg.H4ADXThreshold != tt.wantADX {
			t.Fatalf("%s H4ADXThreshold = %v, want %v", tt.symbol, cfg.H4ADXThreshold, tt.wantADX)
		}
		if cfg.M15ConfirmRSIThreshold != tt.wantRSI {
			t.Fatalf("%s M15ConfirmRSIThreshold = %v, want %v", tt.symbol, cfg.M15ConfirmRSIThreshold, tt.wantRSI)
		}
	}
}
