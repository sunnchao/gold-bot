package api

import (
	"math"
	"testing"

	"gold-bot/internal/domain"
)

func TestAverageEntryPrice(t *testing.T) {
	positions := []domain.Position{
		{Symbol: "XAUUSD", Type: "BUY", Lots: 0.1, OpenPrice: 3300},
		{Symbol: "xauusd", Type: "buy", Lots: 0.2, OpenPrice: 3310},
		{Symbol: "XAUUSD", Type: "SELL", Lots: 0.3, OpenPrice: 3320},
		{Symbol: "EURUSD", Type: "BUY", Lots: 1.0, OpenPrice: 1.1},
		{Symbol: "XAUUSD", Type: "BUY", Lots: 0, OpenPrice: 3290},
	}

	got := averageEntryPrice(positions, "XAUUSD", "buy")
	want := (0.1*3300 + 0.2*3310) / 0.3
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("averageEntryPrice = %v, want %v", got, want)
	}
}

func TestAverageEntryPriceReturnsZeroWhenNoMatchingLots(t *testing.T) {
	positions := []domain.Position{
		{Symbol: "XAUUSD", Type: "BUY", Lots: 0, OpenPrice: 3300},
		{Symbol: "XAUUSD", Type: "BUY", Lots: 0.1, OpenPrice: 0},
	}

	if got := averageEntryPrice(positions, "XAUUSD", "buy"); got != 0 {
		t.Fatalf("averageEntryPrice = %v, want 0", got)
	}
}

func TestGetM30ATR(t *testing.T) {
	bars := map[string][]domain.Bar{
		"M30": {
			{ATR: 8.5},
			{ATR: 12.25},
		},
		"H1": {
			{ATR: 20},
		},
	}

	if got := getM30ATR(bars); got != 12.25 {
		t.Fatalf("getM30ATR = %v, want 12.25", got)
	}
}

func TestGetM30ATRReturnsZeroWhenMissing(t *testing.T) {
	if got := getM30ATR(map[string][]domain.Bar{"H1": {{ATR: 20}}}); got != 0 {
		t.Fatalf("getM30ATR = %v, want 0", got)
	}
}
