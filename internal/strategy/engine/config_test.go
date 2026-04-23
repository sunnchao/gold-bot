package engine

import "testing"

func TestDefaultStrategyConfigKeepsDefaultMomentumScalpThresholds(t *testing.T) {
	cfg := DefaultStrategyConfig()

	if cfg.MomentumScalpMinADX != 25 {
		t.Fatalf("MomentumScalpMinADX = %v, want 25", cfg.MomentumScalpMinADX)
	}
	if cfg.MomentumScalpVolConfirm != 1.3 {
		t.Fatalf("MomentumScalpVolConfirm = %v, want 1.3", cfg.MomentumScalpVolConfirm)
	}
	if cfg.MomentumScalpMinScore != 7 {
		t.Fatalf("MomentumScalpMinScore = %d, want 7", cfg.MomentumScalpMinScore)
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

			if cfg.MomentumScalpMinADX != 23 {
				t.Fatalf("MomentumScalpMinADX = %v, want 23", cfg.MomentumScalpMinADX)
			}
			if cfg.MomentumScalpVolConfirm != 1.15 {
				t.Fatalf("MomentumScalpVolConfirm = %v, want 1.15", cfg.MomentumScalpVolConfirm)
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

			if cfg.MomentumScalpMinADX != 25 {
				t.Fatalf("MomentumScalpMinADX = %v, want 25", cfg.MomentumScalpMinADX)
			}
			if cfg.MomentumScalpVolConfirm != 1.3 {
				t.Fatalf("MomentumScalpVolConfirm = %v, want 1.3", cfg.MomentumScalpVolConfirm)
			}
			if cfg.MomentumScalpMinScore != 7 {
				t.Fatalf("MomentumScalpMinScore = %d, want 7", cfg.MomentumScalpMinScore)
			}
		})
	}
}
