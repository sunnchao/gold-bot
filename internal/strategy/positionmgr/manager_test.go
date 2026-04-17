package positionmgr_test

import (
	"context"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/positionmgr"
)

func TestAnalyzeTimeStopWinsBeforeOtherExitRules(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       101,
		OpenTime:     now.Add(-49 * time.Hour),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3340.8,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    101,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Action != domain.PositionActionClose {
		t.Fatalf("action = %q, want %q", got[0].Action, domain.PositionActionClose)
	}
	if got[0].Ticket != 101 {
		t.Fatalf("ticket = %d, want 101", got[0].Ticket)
	}
	if got[0].Lots != 0.5 {
		t.Fatalf("lots = %v, want 0.5", got[0].Lots)
	}
	if got[0].Reason != "time_48h_0.4ATR" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "time_48h_0.4ATR")
	}
}

func TestAnalyzeBreakevenAndTP1CanFireInSamePass(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       202,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    202,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) != 2 {
		t.Fatalf("len(commands) = %d, want 2", len(got))
	}

	if got[0].Action != domain.PositionActionModify {
		t.Fatalf("first action = %q, want %q", got[0].Action, domain.PositionActionModify)
	}
	if got[0].NewSL != 3340.0 {
		t.Fatalf("first new_sl = %v, want 3340.0", got[0].NewSL)
	}
	if got[0].Reason != "breakeven_1.6ATR" {
		t.Fatalf("first reason = %q, want %q", got[0].Reason, "breakeven_1.6ATR")
	}

	if got[1].Action != domain.PositionActionClose {
		t.Fatalf("second action = %q, want %q", got[1].Action, domain.PositionActionClose)
	}
	if got[1].Lots != 0.2 {
		t.Fatalf("second lots = %v, want 0.2", got[1].Lots)
	}
	if got[1].Reason != "TP1_1.6ATR" {
		t.Fatalf("second reason = %q, want %q", got[1].Reason, "TP1_1.6ATR")
	}
}

func TestManagerLoadAndPersistStatesIncludeSymbol(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	store := &recordingStateStore{
		loaded: map[int64]domain.PositionState{
			303: {
				Ticket:       303,
				OpenTime:     now.Add(-2 * time.Hour),
				BETriggerATR: 1.5,
			},
		},
	}
	manager := positionmgr.New(
		positionmgr.WithNow(func() time.Time { return now }),
		positionmgr.WithStore(store),
	)

	if err := manager.LoadStates("90011087", "GBPJPY"); err != nil {
		t.Fatalf("LoadStates returned error: %v", err)
	}

	got := manager.Analyze(domain.PositionSnapshot{
		AccountID:    "90011087",
		Symbol:       "GBPJPY",
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    303,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) == 0 {
		t.Fatal("len(commands) = 0, want at least one command so state is persisted")
	}
	if store.loadSymbol != "GBPJPY" {
		t.Fatalf("load symbol = %q, want %q", store.loadSymbol, "GBPJPY")
	}
	if len(store.saved) == 0 {
		t.Fatal("len(saved) = 0, want at least one persisted state")
	}
	if store.saved[0].symbol != "GBPJPY" {
		t.Fatalf("saved symbol = %q, want %q", store.saved[0].symbol, "GBPJPY")
	}
}

func TestAnalyzeMomentumScalpTimeStopWinsBeforeOtherRules(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       404,
		OpenTime:     now.Add(-21 * time.Minute),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 100.15,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars: []domain.Bar{
			{Close: 99.6},
			{Close: 99.8},
			{Close: 100.0},
			{Close: 100.1},
			{Close: 100.2},
			{Close: 100.3},
			{Close: 100.35},
			{Close: 100.4},
		},
		M1Bars: []domain.Bar{
			{RSI: 82},
		},
		Positions: []domain.Position{
			{
				Ticket:    404,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "bot momentum_scalp entry",
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Reason != "momentum_scalp_time_stop_0.2ATR" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "momentum_scalp_time_stop_0.2ATR")
	}
	if got[0].Action != domain.PositionActionClose {
		t.Fatalf("action = %q, want %q", got[0].Action, domain.PositionActionClose)
	}
	if got[0].Lots != 0.5 {
		t.Fatalf("lots = %v, want 0.5", got[0].Lots)
	}
}

func TestAnalyzeMomentumScalpRSIPartialThenFullExit(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:           505,
		OpenTime:         now.Add(-5 * time.Minute),
		BETriggerATR:     1.5,
		RSITp75Triggered: false,
	})

	first := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 101.0,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars:       bullishMomentumM5Bars(),
		M1Bars: []domain.Bar{
			{RSI: 76},
		},
		Positions: []domain.Position{
			{
				Ticket:    505,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(first) != 1 {
		t.Fatalf("first len(commands) = %d, want 1", len(first))
	}
	if first[0].Action != domain.PositionActionClose {
		t.Fatalf("first action = %q, want %q", first[0].Action, domain.PositionActionClose)
	}
	if first[0].Lots != 0.25 {
		t.Fatalf("first lots = %v, want 0.25", first[0].Lots)
	}
	if first[0].Reason != "momentum_scalp_rsi_tp75" {
		t.Fatalf("first reason = %q, want %q", first[0].Reason, "momentum_scalp_rsi_tp75")
	}

	second := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 101.2,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars:       bullishMomentumM5Bars(),
		M1Bars: []domain.Bar{
			{RSI: 82},
		},
		Positions: []domain.Position{
			{
				Ticket:    505,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(second) != 1 {
		t.Fatalf("second len(commands) = %d, want 1", len(second))
	}
	if second[0].Lots != 0.5 {
		t.Fatalf("second lots = %v, want 0.5", second[0].Lots)
	}
	if second[0].Reason != "momentum_scalp_rsi_extreme" {
		t.Fatalf("second reason = %q, want %q", second[0].Reason, "momentum_scalp_rsi_extreme")
	}
}

func TestAnalyzeMomentumScalpClosesWhenM5StructureBreaks(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       606,
		OpenTime:     now.Add(-5 * time.Minute),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 100.9,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars: []domain.Bar{
			{Close: 100.8},
			{Close: 100.7},
			{Close: 100.6},
			{Close: 100.5},
			{Close: 100.4},
			{Close: 100.3},
			{Close: 100.2},
			{Close: 100.1},
		},
		M1Bars: []domain.Bar{
			{RSI: 60},
		},
		Positions: []domain.Position{
			{
				Ticket:    606,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Reason != "momentum_scalp_m5_structure_break" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "momentum_scalp_m5_structure_break")
	}
}

type recordingStateStore struct {
	loadAccount string
	loadSymbol  string
	loaded      map[int64]domain.PositionState
	saved       []persistedState
}

type persistedState struct {
	accountID string
	symbol    string
	state     domain.PositionState
}

func (s *recordingStateStore) SavePositionState(_ context.Context, accountID, symbol string, state domain.PositionState) error {
	s.saved = append(s.saved, persistedState{accountID: accountID, symbol: symbol, state: state})
	return nil
}

func (s *recordingStateStore) LoadPositionStates(_ context.Context, accountID, symbol string) (map[int64]domain.PositionState, error) {
	s.loadAccount = accountID
	s.loadSymbol = symbol
	return s.loaded, nil
}

func samplePositionBars() []domain.Bar {
	return []domain.Bar{
		{EMA20: 3341.0, EMA50: 3337.0, RSI: 65, ADX: 32, MACDHist: 0.6, ATR: 2.0},
		{EMA20: 3341.5, EMA50: 3337.5, RSI: 63, ADX: 31, MACDHist: 0.5, ATR: 2.0},
		{EMA20: 3342.0, EMA50: 3338.0, RSI: 60, ADX: 30, MACDHist: 0.4, ATR: 2.0},
		{EMA20: 3342.5, EMA50: 3338.5, RSI: 58, ADX: 31, MACDHist: 0.3, ATR: 2.0},
		{EMA20: 3343.0, EMA50: 3339.0, RSI: 56, ADX: 29, MACDHist: 0.2, ATR: 2.0},
	}
}

func bullishMomentumM5Bars() []domain.Bar {
	return []domain.Bar{
		{Close: 99.6},
		{Close: 99.8},
		{Close: 100.0},
		{Close: 100.1},
		{Close: 100.2},
		{Close: 100.3},
		{Close: 100.35},
		{Close: 100.4},
	}
}
