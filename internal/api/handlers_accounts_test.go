package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/domain"
	"gold-bot/internal/ea"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestOverviewReturnsCutoverCard(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "api-overview.sqlite")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	commands := sqlitestore.NewCommandRepository(db)
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)

	if err := tokens.PutToken(context.Background(), "admin-token", "admin", true, now); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	if err := accounts.UpsertAccount(context.Background(), domain.Account{
		AccountID:   "90011087",
		Broker:      "Demo Broker",
		ServerName:  "Demo-1",
		AccountName: "Primary",
		Currency:    "USD",
		Leverage:    500,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(context.Background(), domain.AccountRuntime{
		AccountID:       "90011087",
		Connected:       true,
		Balance:         1000.5,
		Equity:          1100.25,
		Margin:          100,
		FreeMargin:      1000.25,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		MT4ServerTime:   "2026.04.13 08:00",
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(context.Background(), "90011087", domain.TickSnapshot{
		Symbol: "XAUUSD",
		Bid:    3335.55,
		Ask:    3335.75,
		Spread: 0.2,
		Time:   "08:00:00",
	}, now); err != nil {
		t.Fatalf("SaveTickSnapshot returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
	req.Header.Set("X-API-Token", "admin-token")

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/overview status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status string `json:"status"`
		Cards  []struct {
			Title string `json:"title"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal overview returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want OK", body.Status)
	}

	found := false
	for _, card := range body.Cards {
		if card.Title == "Cutover Health" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("cards = %+v, want Cutover Health card", body.Cards)
	}
}
