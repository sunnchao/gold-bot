package legacy

import (
	"testing"

	"gold-bot/internal/domain"
)

func TestFilterPositionsForSymbolMatchesGoldAliasesByBaseSymbol(t *testing.T) {
	positions := []domain.Position{
		{Ticket: 1, Symbol: "GOLDm#"},
		{Ticket: 2, Symbol: "XAUUSD"},
		{Ticket: 3, Symbol: "gbpjpy#"},
		{Ticket: 4, Symbol: ""},
	}

	filtered := filterPositionsForSymbol(" xauusd ", positions)
	if len(filtered) != 3 {
		t.Fatalf("len(filtered) = %d, want 3", len(filtered))
	}
	if filtered[0].Ticket != 1 || filtered[1].Ticket != 2 || filtered[2].Ticket != 4 {
		t.Fatalf("filtered tickets = [%d %d %d], want [1 2 4]", filtered[0].Ticket, filtered[1].Ticket, filtered[2].Ticket)
	}
}

func TestFilterPositionsForSymbolMatchesGBPJPYAliasesByBaseSymbol(t *testing.T) {
	positions := []domain.Position{
		{Ticket: 1, Symbol: "GBPJPYm#"},
		{Ticket: 2, Symbol: "GBPJPY"},
		{Ticket: 3, Symbol: "XAUUSD"},
	}

	filtered := filterPositionsForSymbol(" gbpjpy# ", positions)
	if len(filtered) != 2 {
		t.Fatalf("len(filtered) = %d, want 2", len(filtered))
	}
	if filtered[0].Ticket != 1 || filtered[1].Ticket != 2 {
		t.Fatalf("filtered tickets = [%d %d], want [1 2]", filtered[0].Ticket, filtered[1].Ticket)
	}
}
