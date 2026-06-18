package engine

import "testing"

func TestDefaultStrategyConfigKeepsDefaultMomentumScalpThresholds(t *testing.T) {
	cfg := DefaultStrategyConfig()

	if cfg.MomentumScalpMinADX != 20 {
		t.Fatalf("MomentumScalpMinADX = %v, want 20", cfg.MomentumScalpMinADX)
	}
	if cfg.MomentumScalpVolConfirm != 1.05 {
		t.Fatalf("MomentumScalpVolConfirm = %v, want 1.05", cfg.MomentumScalpVolConfirm)
	}
	if cfg.MomentumScalpMinScore != 7 {
		t.Fatalf("MomentumScalpMinScore = %d, want 7", cfg.MomentumScalpMinScore)
	}
	// 验证新的 RSI 阈值
	if cfg.MomentumScalpRSIBullThresh != 45.0 {
		t.Fatalf("MomentumScalpRSIBullThresh = %v, want 45.0", cfg.MomentumScalpRSIBullThresh)
	}
	if cfg.MomentumScalpRSIBearThresh != 55.0 {
		t.Fatalf("MomentumScalpRSIBearThresh = %v, want 55.0", cfg.MomentumScalpRSIBearThresh)
	}
	if cfg.MomentumScalpRSICrossoverBull != 48.0 {
		t.Fatalf("MomentumScalpRSICrossoverBull = %v, want 48.0", cfg.MomentumScalpRSICrossoverBull)
	}
	if cfg.MomentumScalpRSICrossoverBear != 52.0 {
		t.Fatalf("MomentumScalpRSICrossoverBear = %v, want 52.0", cfg.MomentumScalpRSICrossoverBear)
	}
	if cfg.SRBufferATR != 0.5 {
		t.Fatalf("SRBufferATR = %v, want 0.5", cfg.SRBufferATR)
	}
	if cfg.SRMaxDistATR != 3.0 {
		t.Fatalf("SRMaxDistATR = %v, want 3.0", cfg.SRMaxDistATR)
	}
	if cfg.SRMinDistATR != 0.3 {
		t.Fatalf("SRMinDistATR = %v, want 0.3", cfg.SRMinDistATR)
	}
}

func TestNewForSymbolUsesGoldMomentumScalpThresholdsForGoldAliases(t *testing.T) {
	tests := []string{
		"XAUUSD",
		"GOLD",
		"GOLDm#",
		"xauusd",
		"gold#",
	}

	for _, symbol := range tests {
		t.Run(symbol, func(t *testing.T) {
			cfg := NewForSymbol(symbol).Config

			if cfg.MomentumScalpMinADX != 18 {
				t.Fatalf("MomentumScalpMinADX = %v, want 18", cfg.MomentumScalpMinADX)
			}
			if cfg.MomentumScalpVolConfirm != 1.05 {
				t.Fatalf("MomentumScalpVolConfirm = %v, want 1.05", cfg.MomentumScalpVolConfirm)
			}
			if cfg.MomentumScalpMinScore != 6 {
				t.Fatalf("MomentumScalpMinScore = %d, want 6", cfg.MomentumScalpMinScore)
			}
		})
	}
}

func TestNewForSymbolKeepsDefaultMomentumScalpThresholdsForGBPJPYAliases(t *testing.T) {
	tests := []string{
		"GBPJPY",
		"GBPJPYm#",
		"gbpjpy#",
	}

	for _, symbol := range tests {
		t.Run(symbol, func(t *testing.T) {
			cfg := NewForSymbol(symbol).Config

			// GBPJPY has intentionally optimized MomentumScalp params (not default)
			if cfg.MomentumScalpMinADX != 18 {
				t.Fatalf("MomentumScalpMinADX = %v, want 18", cfg.MomentumScalpMinADX)
			}
			if cfg.MomentumScalpVolConfirm != 1.02 {
				t.Fatalf("MomentumScalpVolConfirm = %v, want 1.02", cfg.MomentumScalpVolConfirm)
			}
			if cfg.MomentumScalpMinScore != 7 {
				t.Fatalf("MomentumScalpMinScore = %d, want 7", cfg.MomentumScalpMinScore)
			}
		})
	}
}
