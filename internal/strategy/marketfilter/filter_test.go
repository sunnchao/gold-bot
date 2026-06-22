package marketfilter

import (
	"testing"
	"time"

	"gold-bot/internal/domain"
)

func TestEvaluateMarketFilters(t *testing.T) {
	baseNow := time.Date(2026, 6, 4, 13, 0, 0, 0, time.UTC)

	testCases := []struct {
		name         string
		mutate       func(*Input)
		wantBlocked  bool
		wantBlocking string
		wantWarning  string
	}{
		{
			name: "market closed blocks",
			mutate: func(input *Input) {
				input.Runtime.MarketOpen = false
			},
			wantBlocked:  true,
			wantBlocking: "market.closed",
		},
		{
			name: "trade disabled blocks",
			mutate: func(input *Input) {
				input.Runtime.IsTradeAllowed = false
			},
			wantBlocked:  true,
			wantBlocking: "market.trade_not_allowed",
		},
		{
			name: "stale tick blocks",
			mutate: func(input *Input) {
				input.Runtime.LastTickAt = baseNow.Add(-3 * time.Minute)
			},
			wantBlocked:  true,
			wantBlocking: "tick.stale",
		},
		{
			name: "wide spread blocks",
			mutate: func(input *Input) {
				input.State.Tick.Spread = 8.1
			},
			wantBlocked:  true,
			wantBlocking: "spread.too_wide",
		},
		{
			name: "friday close window blocks",
			mutate: func(input *Input) {
				input.Now = time.Date(2026, 6, 5, 20, 45, 0, 0, time.UTC)
				input.Runtime.LastTickAt = input.Now.Add(-10 * time.Second)
			},
			wantBlocked:  true,
			wantBlocking: "session.friday_close_window",
		},
		{
			name: "rollover window warns",
			mutate: func(input *Input) {
				input.Now = time.Date(2026, 6, 4, 21, 58, 0, 0, time.UTC)
				input.Runtime.LastTickAt = input.Now.Add(-10 * time.Second)
			},
			wantWarning: "session.rollover_window",
		},
		{
			name: "low liquidity session warns",
			mutate: func(input *Input) {
				input.Now = time.Date(2026, 6, 4, 22, 30, 0, 0, time.UTC)
				input.Runtime.LastTickAt = input.Now.Add(-10 * time.Second)
			},
			wantWarning: "session.low_liquidity",
		},
		{
			name: "abnormal ATR expansion warns",
			mutate: func(input *Input) {
						input.State.Bars = map[string][]domain.Bar{
							"M30": atrBars(1.0, 24, 2.2),
						}
			},
			wantWarning: "volatility.atr_expansion",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			input := validInput(baseNow)
			tc.mutate(&input)

			result := Evaluate(input)

			if result.Blocked != tc.wantBlocked {
				t.Fatalf("Blocked = %v, want %v; result=%+v", result.Blocked, tc.wantBlocked, result)
			}
			if tc.wantBlocking != "" && !hasFilter(result.Blocking, tc.wantBlocking) {
				t.Fatalf("blocking filters = %+v, want code %q", result.Blocking, tc.wantBlocking)
			}
			if tc.wantWarning != "" && !hasFilter(result.Warnings, tc.wantWarning) {
				t.Fatalf("warning filters = %+v, want code %q", result.Warnings, tc.wantWarning)
			}
			if tc.wantBlocking != "" && !hasReason(result.ReasonCodes, tc.wantBlocking) {
				t.Fatalf("reason codes = %v, want %q", result.ReasonCodes, tc.wantBlocking)
			}
			if tc.wantWarning != "" && !hasReason(result.ReasonCodes, tc.wantWarning) {
				t.Fatalf("reason codes = %v, want %q", result.ReasonCodes, tc.wantWarning)
			}
		})
	}
}

func TestEvaluateHasNoActiveFiltersForNormalMarket(t *testing.T) {
	result := Evaluate(validInput(time.Date(2026, 6, 4, 13, 0, 0, 0, time.UTC)))

	if result.Blocked {
		t.Fatalf("Blocked = true, want false; result=%+v", result)
	}
	if len(result.Blocking) != 0 {
		t.Fatalf("blocking filters = %+v, want empty", result.Blocking)
	}
	if len(result.Warnings) != 0 {
		t.Fatalf("warning filters = %+v, want empty", result.Warnings)
	}
	if len(result.ReasonCodes) != 0 {
		t.Fatalf("reason codes = %v, want empty", result.ReasonCodes)
	}
}

func validInput(now time.Time) Input {
	return Input{
		Now: now,
		Runtime: domain.AccountRuntime{
			AccountID:      "90011087",
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
			Bars: map[string][]domain.Bar{
				"H1": atrBars(1.0, 24, 1.0),
			},
		},
	}
}

func atrBars(baseATR float64, historyCount int, latestATR float64) []domain.Bar {
	bars := make([]domain.Bar, 0, historyCount+1)
	for i := 0; i < historyCount; i++ {
		bars = append(bars, domain.Bar{ATR: baseATR, Close: 3300 + float64(i)})
	}
	return append(bars, domain.Bar{ATR: latestATR, Close: 3300 + float64(historyCount)})
}

func hasFilter(filters []Filter, code string) bool {
	for _, filter := range filters {
		if filter.Code == code {
			return true
		}
	}
	return false
}

func hasReason(reasonCodes []string, code string) bool {
	for _, reason := range reasonCodes {
		if reason == code {
			return true
		}
	}
	return false
}
