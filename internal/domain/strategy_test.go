package domain

import "testing"

func TestBaseSymbolCanonicalizesAliases(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "trims and canonicalizes uppercase gold", raw: "  XAUUSD  ", want: "XAUUSD"},
		{name: "canonicalizes gold alias", raw: "GOLD", want: "XAUUSD"},
		{name: "canonicalizes gold alias with broker suffix", raw: "GOLDm#", want: "XAUUSD"},
		{name: "canonicalizes lowercase gold alias with hash suffix", raw: "gold#", want: "XAUUSD"},
		{name: "canonicalizes lowercase xauusd", raw: "xauusd", want: "XAUUSD"},
		{name: "canonicalizes xauusd with broker suffix", raw: "  xauusdm#  ", want: "XAUUSD"},
		{name: "normalizes gbpjpy", raw: "GBPJPY", want: "GBPJPY"},
		{name: "normalizes gbpjpy with broker suffix", raw: "GBPJPYm#", want: "GBPJPY"},
		{name: "normalizes lowercase gbpjpy with hash suffix", raw: "gbpjpy#", want: "GBPJPY"},
		{name: "preserves other symbols after trimming and uppercasing", raw: "  eurusd  ", want: "EURUSD"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BaseSymbol(tt.raw); got != tt.want {
				t.Fatalf("BaseSymbol(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
