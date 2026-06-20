package riskgate

import (
	"testing"
	"time"

	"gold-bot/internal/domain"
)

func TestEvaluateRejectsTradeabilityFailures(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)

	testCases := []struct {
		name     string
		mutate   func(*Input)
		wantCode string
	}{
		{
			name:     "closed market",
			mutate:   func(input *Input) { input.Runtime.MarketOpen = false },
			wantCode: "market.closed",
		},
		{
			name:     "trade disabled",
			mutate:   func(input *Input) { input.Runtime.IsTradeAllowed = false },
			wantCode: "market.trade_not_allowed",
		},
		{
			name:     "stale tick",
			mutate:   func(input *Input) { input.Runtime.LastTickAt = now.Add(-3 * time.Minute) },
			wantCode: "tick.stale",
		},
		{
			name:     "wide spread",
			mutate:   func(input *Input) { input.State.Tick.Spread = 80.1 },
			wantCode: "spread.too_wide",
		},
		{
			name:     "expired plan",
			mutate:   func(input *Input) { input.Plan.ExpiresAt = now.Add(-time.Second) },
			wantCode: "plan.expired",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			input := validInput(now)
			tc.mutate(&input)

			result := Evaluate(input)

			if result.Status != StatusRejected {
				t.Fatalf("status = %q, want %q", result.Status, StatusRejected)
			}
			if !hasReason(result, tc.wantCode) {
				t.Fatalf("reason codes = %v, want %q", result.ReasonCodes, tc.wantCode)
			}
		})
	}
}

func TestEvaluateRejectsMissingOrUnreasonableStopLoss(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)

	testCases := []struct {
		name     string
		stopLoss float64
		wantCode string
	}{
		{name: "missing", stopLoss: 0, wantCode: "sl.missing"},
		{name: "too close", stopLoss: 3335.50, wantCode: "sl.too_close"},
		{name: "too far", stopLoss: 3150.00, wantCode: "sl.too_far"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			input := validInput(now)
			input.Plan.StopLoss = tc.stopLoss

			result := Evaluate(input)

			if result.Status != StatusRejected {
				t.Fatalf("status = %q, want %q", result.Status, StatusRejected)
			}
			if !hasReason(result, tc.wantCode) {
				t.Fatalf("reason codes = %v, want %q", result.ReasonCodes, tc.wantCode)
			}
		})
	}
}

func TestEvaluateRejectsUnapprovedHedgeOrAdd(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)

	testCases := []struct {
		name           string
		position       domain.Position
		sourceStrategy string
		wantCode       string
	}{
		{
			name:           "same side add - same strategy",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "BUY", Lots: 0.10, Strategy: "pullback"},
			sourceStrategy: "pullback",
			wantCode:       "position.add_not_allowed",
		},
		{
			name:           "opposite side hedge - same strategy",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "SELL", Lots: 0.10, Strategy: "pullback"},
			sourceStrategy: "pullback",
			wantCode:       "position.hedge_not_allowed",
		},
		{
			name:           "same side add - different strategy should pass",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "BUY", Lots: 0.10, Strategy: "pullback"},
			sourceStrategy: "ai_signal",
			wantCode:       "",
		},
		{
			name:           "opposite side hedge - different strategy should pass",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "SELL", Lots: 0.10, Strategy: "pullback"},
			sourceStrategy: "ai_signal",
			wantCode:       "",
		},
		{
			name:           "same side add - position has no strategy backward compat",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "BUY", Lots: 0.10},
			sourceStrategy: "ai_signal",
			wantCode:       "position.add_not_allowed",
		},
		{
			name:           "same side add - input has no source strategy backward compat",
			position:       domain.Position{Ticket: 123456, Symbol: "XAUUSD", Type: "BUY", Lots: 0.10, Strategy: "pullback"},
			sourceStrategy: "",
			wantCode:       "position.add_not_allowed",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			input := validInput(now)
			input.State.Positions = []domain.Position{tc.position}
			input.SourceStrategy = tc.sourceStrategy

			result := Evaluate(input)

			if tc.wantCode == "" {
				if result.Status == StatusRejected && hasReason(result, "position.add_not_allowed") {
					t.Fatalf("expected no add_not_allowed rejection but got status=%q reasons=%v", result.Status, result.ReasonCodes)
				}
				if result.Status == StatusRejected && hasReason(result, "position.hedge_not_allowed") {
					t.Fatalf("expected no hedge_not_allowed rejection but got status=%q reasons=%v", result.Status, result.ReasonCodes)
				}
				return
			}

			if result.Status != StatusRejected {
				t.Fatalf("status = %q, want %q", result.Status, StatusRejected)
			}
			if !hasReason(result, tc.wantCode) {
				t.Fatalf("reason codes = %v, want %q", result.ReasonCodes, tc.wantCode)
			}
		})
	}
}

func TestEvaluateClampsOversizedLots(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)
	input := validInput(now)
	input.Plan.MaxLots = 3.77

	result := Evaluate(input)

	if result.Status != StatusClamped {
		t.Fatalf("status = %q, want %q", result.Status, StatusClamped)
	}
	if result.AllowedLots <= 0 || result.AllowedLots >= input.Plan.MaxLots {
		t.Fatalf("allowed lots = %v, want positive clamp below requested %v", result.AllowedLots, input.Plan.MaxLots)
	}
	if !hasReason(result, "lots.clamped") {
		t.Fatalf("reason codes = %v, want lots.clamped", result.ReasonCodes)
	}
}

func TestEvaluateValidCloseAndReduceAreAccepted(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)

	for _, mode := range []string{"close", "reduce"} {
		t.Run(mode, func(t *testing.T) {
			input := validInput(now)
			input.Plan.Mode = mode
			input.Plan.Side = "none"
			input.Plan.StopLoss = 0
			input.Plan.EntryZone = domain.TradePlanEntryZone{}
			input.Plan.TakeProfit = nil

			result := Evaluate(input)

			if result.Status != StatusAccepted {
				t.Fatalf("status = %q, want %q; reasons=%v", result.Status, StatusAccepted, result.ReasonCodes)
			}
			if !hasReason(result, "action.audit_safe") {
				t.Fatalf("reason codes = %v, want action.audit_safe", result.ReasonCodes)
			}
		})
	}
}

func validInput(now time.Time) Input {
	return Input{
		Now: now,
		Account: domain.Account{
			AccountID: "90011087",
			Leverage:  500,
		},
		Runtime: domain.AccountRuntime{
			AccountID:      "90011087",
			Equity:         1100.25,
			FreeMargin:     1000.25,
			MarketOpen:     true,
			IsTradeAllowed: true,
			LastTickAt:     now.Add(-10 * time.Second),
		},
		State: domain.AccountState{
			AccountID: "90011087",
			Symbol:    "XAUUSD",
			Tick: domain.TickSnapshot{
				Symbol: "XAUUSD",
				Bid:    3335.55,
				Ask:    3335.75,
				Spread: 0.2,
			},
			Positions: []domain.Position{},
		},
		CandidateSignal: &domain.PendingSignal{
			ID:        42,
			AccountID: "90011087",
			Symbol:    "XAUUSD",
			Side:      "BUY",
			Score:     82,
			Strategy:  "pullback",
		},
		Plan: &domain.TradePlan{
			SchemaVersion: domain.TradePlanSchemaVersion,
			DecisionID:    "tpv1_gate_test",
			AccountID:     "90011087",
			Symbol:        "XAUUSD",
			Mode:          "approve",
			Side:          "buy",
			Confidence:    82,
			EntryZone:     domain.TradePlanEntryZone{Min: 3335.55, Max: 3335.75},
			StopLoss:      3328.00,
			TakeProfit:    []float64{3350.00},
			MaxLots:       0.20,
			ExpiresAt:     now.Add(15 * time.Minute),
			ReasonCodes:   []string{"mode.approve", "side.buy"},
			Narrative:     "test plan",
		},
	}
}

func hasReason(result Result, code string) bool {
	for _, reason := range result.ReasonCodes {
		if reason == code {
			return true
		}
	}
	return false
}
