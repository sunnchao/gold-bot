package riskgate

import "testing"

func TestMetadataForReturnsForexMajorMetadata(t *testing.T) {
	tests := []struct {
		symbol        string
		wantSymbol    string
		wantMaxSpread float64
		wantMinSL     float64
		wantMaxSL     float64
	}{
		{symbol: "GBPUSD", wantSymbol: "GBPUSD", wantMaxSpread: 4.0, wantMinSL: 0.0005, wantMaxSL: 0.05},
		{symbol: "USDCADm#", wantSymbol: "USDCAD", wantMaxSpread: 4.0, wantMinSL: 0.0005, wantMaxSL: 0.05},
	}

	for _, tt := range tests {
		meta := metadataFor(tt.symbol)
		if meta.Symbol != tt.wantSymbol {
			t.Fatalf("%s Symbol = %q, want %q", tt.symbol, meta.Symbol, tt.wantSymbol)
		}
		if meta.MaxSpread != tt.wantMaxSpread {
			t.Fatalf("%s MaxSpread = %v, want %v", tt.symbol, meta.MaxSpread, tt.wantMaxSpread)
		}
		if meta.MinSLDistance != tt.wantMinSL {
			t.Fatalf("%s MinSLDistance = %v, want %v", tt.symbol, meta.MinSLDistance, tt.wantMinSL)
		}
		if meta.MaxSLDistance != tt.wantMaxSL {
			t.Fatalf("%s MaxSLDistance = %v, want %v", tt.symbol, meta.MaxSLDistance, tt.wantMaxSL)
		}
	}
}
