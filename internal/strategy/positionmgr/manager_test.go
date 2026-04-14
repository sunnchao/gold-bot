package positionmgr_test

import (
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

func samplePositionBars() []domain.Bar {
	return []domain.Bar{
		{EMA20: 3341.0, EMA50: 3337.0, RSI: 65, ADX: 32, MACDHist: 0.6, ATR: 2.0},
		{EMA20: 3341.5, EMA50: 3337.5, RSI: 63, ADX: 31, MACDHist: 0.5, ATR: 2.0},
		{EMA20: 3342.0, EMA50: 3338.0, RSI: 60, ADX: 30, MACDHist: 0.4, ATR: 2.0},
		{EMA20: 3342.5, EMA50: 3338.5, RSI: 58, ADX: 31, MACDHist: 0.3, ATR: 2.0},
		{EMA20: 3343.0, EMA50: 3339.0, RSI: 56, ADX: 29, MACDHist: 0.2, ATR: 2.0},
	}
}
