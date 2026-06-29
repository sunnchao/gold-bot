package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/domain"
	"gold-bot/internal/ea"
	"gold-bot/internal/store"
)

func TestAISymbolsFallsBackToTradingSymbols(t *testing.T) {
	ctx := context.Background()
	accounts := store.NewMemoryAccountStore()
	tokens := symbolTestTokenStore{
		validTokens: map[string]bool{"test-token": true},
	}
	now := time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC)

	if err := accounts.SaveTickSnapshot(ctx, "account_A", "XAUUSD", domain.TickSnapshot{Symbol: "XAUUSD"}, now); err != nil {
		t.Fatalf("SaveTickSnapshot(XAUUSD) returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(ctx, "account_A", "GBPJPY", domain.TickSnapshot{Symbol: "GBPJPY"}, now); err != nil {
		t.Fatalf("SaveTickSnapshot(GBPJPY) returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: symbolTestCommandStore{},
		Releases: ea.NewLocalReleaseSource("."),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ai_symbols/account_A", nil)
	req.Header.Set("X-API-Token", "test-token")

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/ai_symbols/account_A status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var got []string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}

	want := map[string]bool{"XAUUSD": true, "GBPJPY": true}
	if len(got) != len(want) {
		t.Fatalf("symbols = %v, want XAUUSD and GBPJPY", got)
	}
	for _, symbol := range got {
		if !want[symbol] {
			t.Fatalf("symbols = %v, unexpected symbol %q", got, symbol)
		}
		delete(want, symbol)
	}
}

type symbolTestTokenStore struct {
	validTokens map[string]bool
}

func (s symbolTestTokenStore) Validate(_ context.Context, token string) (bool, error) {
	return s.validTokens[token], nil
}

func (s symbolTestTokenStore) IsAdmin(_ context.Context, token string) (bool, error) {
	return false, nil
}

func (s symbolTestTokenStore) AccountsForToken(_ context.Context, token string) ([]string, error) {
	return nil, nil
}

func (s symbolTestTokenStore) PutToken(_ context.Context, token, name string, isAdmin bool, createdAt time.Time) error {
	return nil
}

func (s symbolTestTokenStore) BindAccount(_ context.Context, token, accountID string) error {
	return nil
}

func (s symbolTestTokenStore) List(_ context.Context) ([]domain.TokenRecord, error) {
	return nil, nil
}

func (s symbolTestTokenStore) FindByPrefix(_ context.Context, prefix string) (string, error) {
	return "", nil
}

func (s symbolTestTokenStore) Delete(_ context.Context, token string) error {
	return nil
}

type symbolTestCommandStore struct{}

func (symbolTestCommandStore) Enqueue(_ context.Context, command domain.Command) error {
	return nil
}

func (symbolTestCommandStore) FindPendingAI(_ context.Context, accountID, symbol, side string) (bool, error) {
	return false, nil
}
