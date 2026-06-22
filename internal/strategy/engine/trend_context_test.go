package engine

import (
	"testing"

	"gold-bot/internal/domain"
)

func makeBar(closePrice, ema20, ema50, adx, rsi float64) domain.Bar {
	return domain.Bar{
		Close: closePrice,
		EMA20: ema20,
		EMA50: ema50,
		ADX:   adx,
		RSI:   rsi,
	}
}

func defaultTrendCfg() TrendConfig {
	return DefaultTrendConfig()
}

func TestBuildTrendContext_AllBull(t *testing.T) {
	bullBar := makeBar(2000, 1990, 1950, 40, 60)
	d1 := []domain.Bar{bullBar}
	h4 := []domain.Bar{bullBar}
	h1 := []domain.Bar{bullBar}
	m30 := []domain.Bar{bullBar}
	m15 := []domain.Bar{bullBar}

	tc := BuildTrendContext(d1, h4, h1, m30, m15, defaultTrendCfg())

	if tc.ConsensusDirection != "BULL" {
		t.Fatalf("ConsensusDirection = %q, want BULL", tc.ConsensusDirection)
	}
	if tc.ConsensusStrength < 0.8 {
		t.Fatalf("ConsensusStrength = %.2f, want > 0.8", tc.ConsensusStrength)
	}
	if tc.D1Direction != "BULL" {
		t.Fatalf("D1Direction = %q, want BULL", tc.D1Direction)
	}
}

func TestBuildTrendContext_MixedSignals(t *testing.T) {
	// H4 BEAR, H1/M30 BULL → BULL should win (0.35+0.35 > 0.25)
	h4Bear := makeBar(1940, 1950, 1960, 35, 45) // Close < EMA20 < EMA50 for BEAR
	h1Bull := makeBar(2000, 1990, 1950, 35, 60)
	m30Bull := makeBar(2000, 1990, 1950, 35, 60)
	d1 := []domain.Bar{makeBar(2000, 1990, 1950, 40, 60)}
	m15 := []domain.Bar{makeBar(2000, 1990, 1950, 30, 60)}

	tc := BuildTrendContext(d1, []domain.Bar{h4Bear}, []domain.Bar{h1Bull}, []domain.Bar{m30Bull}, m15, defaultTrendCfg())

	if tc.ConsensusDirection != "BULL" {
		t.Fatalf("ConsensusDirection = %q, want BULL (H1+M30=0.70 > H4=0.25)", tc.ConsensusDirection)
	}
	if tc.H4Direction != "BEAR" {
		t.Fatalf("H4Direction = %q, want BEAR", tc.H4Direction)
	}
	if tc.H1Direction != "BULL" {
		t.Fatalf("H1Direction = %q, want BULL", tc.H1Direction)
	}
}

func TestBuildTrendContext_AllNeutral(t *testing.T) {
	// EMA20 == EMA50 → NEUTRAL
	neutralBar := makeBar(2000, 2000, 2000, 10, 50)
	d1 := []domain.Bar{neutralBar}
	h4 := []domain.Bar{neutralBar}
	h1 := []domain.Bar{neutralBar}
	m30 := []domain.Bar{neutralBar}
	m15 := []domain.Bar{neutralBar}

	tc := BuildTrendContext(d1, h4, h1, m30, m15, defaultTrendCfg())

	if tc.ConsensusDirection != "NEUTRAL" {
		t.Fatalf("ConsensusDirection = %q, want NEUTRAL", tc.ConsensusDirection)
	}
	if tc.ConsensusStrength != 0 {
		t.Fatalf("ConsensusStrength = %.2f, want 0", tc.ConsensusStrength)
	}
}

func TestBuildTrendContext_EmptyBars(t *testing.T) {
	tc := BuildTrendContext(nil, nil, nil, nil, nil, defaultTrendCfg())

	if tc.ConsensusDirection != "NEUTRAL" {
		t.Fatalf("ConsensusDirection = %q, want NEUTRAL", tc.ConsensusDirection)
	}
	if tc.ConsensusStrength != 0 {
		t.Fatalf("ConsensusStrength = %.2f, want 0", tc.ConsensusStrength)
	}
}

func TestApplyTrendRating_Soft(t *testing.T) {
	// All NEUTRAL → strength=0 → soft threshold triggered
	neutralBar := makeBar(2000, 2000, 2000, 10, 50)
	tc := BuildTrendContext(
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		defaultTrendCfg(),
	)

	sig := &domain.Signal{Side: "BUY", Score: 7, Strategy: "pullback"}
	rating := ApplyTrendRating(sig, tc, defaultTrendCfg())

	if rating.Penalty != 1 {
		t.Fatalf("Penalty = %d, want 1", rating.Penalty)
	}
	if rating.LotMultiplier != 1.0 {
		t.Fatalf("LotMultiplier = %.2f, want 1.0", rating.LotMultiplier)
	}
}

func TestApplyTrendRating_Medium(t *testing.T) {
	// H4 BEAR, others NEUTRAL → consensus weak + H4 inverse to BUY → medium
	h4Bear := makeBar(1940, 1950, 1960, 15, 45) // Close < EMA20 < EMA50 = BEAR
	neutralBar := makeBar(2000, 2000, 2000, 10, 50)
	tc := BuildTrendContext(
		[]domain.Bar{neutralBar},
		[]domain.Bar{h4Bear},
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		[]domain.Bar{neutralBar},
		defaultTrendCfg(),
	)

	sig := &domain.Signal{Side: "BUY", Score: 7, Strategy: "pullback"}
	rating := ApplyTrendRating(sig, tc, defaultTrendCfg())

	if rating.Penalty != 2 {
		t.Fatalf("Penalty = %d, want 2", rating.Penalty)
	}
	if rating.LotMultiplier != 0.7 {
		t.Fatalf("LotMultiplier = %.2f, want 0.7", rating.LotMultiplier)
	}
}

func TestApplyTrendRating_Normal(t *testing.T) {
	// Strong BULL consensus
	bullBar := makeBar(2000, 1990, 1950, 40, 60)
	tc := BuildTrendContext(
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		defaultTrendCfg(),
	)

	sig := &domain.Signal{Side: "BUY", Score: 7, Strategy: "pullback"}
	rating := ApplyTrendRating(sig, tc, defaultTrendCfg())

	if rating.Penalty != 0 {
		t.Fatalf("Penalty = %d, want 0", rating.Penalty)
	}
	if rating.LotMultiplier != 1.0 {
		t.Fatalf("LotMultiplier = %.2f, want 1.0", rating.LotMultiplier)
	}
}

func TestApplyTrendRating_Disabled(t *testing.T) {
	bullBar := makeBar(2000, 1990, 1950, 40, 60)
	tc := BuildTrendContext(
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		[]domain.Bar{bullBar},
		defaultTrendCfg(),
	)

	cfg := defaultTrendCfg()
	cfg.Enabled = false

	sig := &domain.Signal{Side: "BUY", Score: 7, Strategy: "pullback"}
	rating := ApplyTrendRating(sig, tc, cfg)

	if rating.Penalty != 0 {
		t.Fatalf("Penalty = %d, want 0 (disabled)", rating.Penalty)
	}
}

func TestBarDirection_Bull(t *testing.T) {
	bars := []domain.Bar{makeBar(2000, 1990, 1950, 35, 60)}
	dir, adx := barDirection(bars)
	if dir != "BULL" {
		t.Fatalf("dir = %q, want BULL", dir)
	}
	if adx != 35 {
		t.Fatalf("adx = %.1f, want 35", adx)
	}
}

func TestBarDirection_Bear(t *testing.T) {
	bars := []domain.Bar{makeBar(1940, 1950, 1960, 28, 40)}
	dir, _ := barDirection(bars)
	if dir != "BEAR" {
		t.Fatalf("dir = %q, want BEAR", dir)
	}
}

func TestBarDirection_Empty(t *testing.T) {
	dir, adx := barDirection(nil)
	if dir != "NEUTRAL" {
		t.Fatalf("dir = %q, want NEUTRAL", dir)
	}
	if adx != 0 {
		t.Fatalf("adx = %.1f, want 0", adx)
	}
}

func TestM15Direction(t *testing.T) {
	if dir := m15Direction([]domain.Bar{makeBar(0, 0, 0, 0, 60)}); dir != "BULL" {
		t.Fatalf("dir = %q, want BULL", dir)
	}
	if dir := m15Direction([]domain.Bar{makeBar(0, 0, 0, 0, 40)}); dir != "BEAR" {
		t.Fatalf("dir = %q, want BEAR", dir)
	}
	if dir := m15Direction([]domain.Bar{makeBar(0, 0, 0, 0, 50)}); dir != "NEUTRAL" {
		t.Fatalf("dir = %q, want NEUTRAL", dir)
	}
	if dir := m15Direction(nil); dir != "NEUTRAL" {
		t.Fatalf("dir = %q, want NEUTRAL", dir)
	}
}
