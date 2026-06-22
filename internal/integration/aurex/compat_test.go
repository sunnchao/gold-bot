package aurex

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/marketfilter"
)

func TestBuildAnalysisPayloadIncludesCappedSafeBarsForAllTimeframes(t *testing.T) {
	now := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)
	state := domain.AccountState{
		AccountID: "90011087",
		Tick: domain.TickSnapshot{
			Symbol: "XAUUSD",
			Bid:    3335.55,
			Ask:    3335.75,
			Spread: 0.2,
			Time:   "2026.06.06 09:00",
		},
		Bars: map[string][]domain.Bar{
			"M15": makePayloadBars("M15", 1050),
			"M30": makePayloadBars("M30", 1050),
			"H1":  makePayloadBars("H1", 1050),
			"H4":  makePayloadBars("H4", 1050),
		},
	}

	payload := BuildAnalysisPayload(
		domain.Account{AccountID: "90011087", Currency: "USD", Leverage: 500},
		domain.AccountRuntime{
			AccountID:      "90011087",
			Connected:      true,
			Balance:        1000,
			Equity:         1100,
			FreeMargin:     1000,
			MarketOpen:     true,
			IsTradeAllowed: true,
			LastTickAt:     now,
		},
		state,
		now,
	)

	if !json.Valid(mustMarshalPayload(t, payload)) {
		t.Fatal("analysis payload JSON is invalid")
	}

	for _, timeframe := range []string{"M15", "M30", "H1", "H4"} {
		bars := payload.Bars[timeframe]
		if got := len(bars); got != analysisPayloadBarsLimit {
			t.Fatalf("len(bars.%s) = %d, want %d", timeframe, got, analysisPayloadBarsLimit)
		}
		if got, want := bars[0].Time, fmt.Sprintf("%s-050", timeframe); got != want {
			t.Fatalf("bars.%s[0].time = %q, want %q", timeframe, got, want)
		}
		if got := bars[len(bars)-1].Close; got == 0 {
			t.Fatalf("bars.%s latest close = %v, want non-zero close", timeframe, got)
		}
		if got := bars[len(bars)-1].ATR; got == 0 {
			t.Fatalf("bars.%s latest ATR = %v, want enriched ATR", timeframe, got)
		}
	}
}

func TestBuildAnalysisPayloadIncludesMarketFilters(t *testing.T) {
	now := time.Date(2026, 6, 5, 20, 30, 0, 0, time.UTC)
	state := domain.AccountState{
		AccountID: "90011087",
		Tick: domain.TickSnapshot{
			Symbol: "XAUUSD",
			Bid:    3335.55,
			Ask:    3335.75,
			Spread: 8.2,
			Time:   "2026.06.05 20:30",
		},
				Bars: map[string][]domain.Bar{
					"M30": append(makePayloadBars("M30", 40), domain.Bar{
						Time:  "M30-expansion",
						Open:  3330,
						High:  3360,
						Low:   3300,
						Close: 3340,
					}),
				},
	}

	payload := BuildAnalysisPayload(
		domain.Account{AccountID: "90011087", Currency: "USD", Leverage: 500},
		domain.AccountRuntime{
			AccountID:      "90011087",
			Connected:      true,
			Balance:        1000,
			Equity:         1100,
			FreeMargin:     1000,
			MarketOpen:     true,
			IsTradeAllowed: true,
			LastTickAt:     now.Add(-10 * time.Second),
		},
		state,
		now,
	)

	if !payload.MarketFilters.Blocked {
		t.Fatalf("MarketFilters.Blocked = false, want true: %+v", payload.MarketFilters)
	}
	if !hasMarketFilterCode(payload.MarketFilters.Blocking, "spread.too_wide") {
		t.Fatalf("blocking filters = %+v, want spread.too_wide", payload.MarketFilters.Blocking)
	}
	if !hasMarketFilterCode(payload.MarketFilters.Blocking, "session.friday_close_window") {
		t.Fatalf("blocking filters = %+v, want session.friday_close_window", payload.MarketFilters.Blocking)
	}
	if !hasMarketFilterCode(payload.MarketFilters.Warnings, "volatility.atr_expansion") {
		t.Fatalf("warning filters = %+v, want volatility.atr_expansion", payload.MarketFilters.Warnings)
	}

	data := mustMarshalPayload(t, payload)
	if !json.Valid(data) {
		t.Fatal("analysis payload JSON is invalid")
	}
}

func makePayloadBars(prefix string, count int) []domain.Bar {
	bars := make([]domain.Bar, count)
	for i := range bars {
		close := 3300 + float64(i)*0.2
		bars[i] = domain.Bar{
			Time:   fmt.Sprintf("%s-%03d", prefix, i),
			Open:   close - 0.3,
			High:   close + 1.1,
			Low:    close - 1.2,
			Close:  close,
			Volume: int64(1000 + i),
		}
	}
	return bars
}

func mustMarshalPayload(t *testing.T, payload AnalysisPayload) []byte {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal(AnalysisPayload) returned error: %v", err)
	}
	return data
}

func hasMarketFilterCode(filters []marketfilter.Filter, code string) bool {
	for _, filter := range filters {
		if filter.Code == code {
			return true
		}
	}
	return false
}
