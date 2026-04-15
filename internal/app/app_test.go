package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/config"
	"gold-bot/internal/domain"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestNewAppRegistersHealthz(t *testing.T) {
	cfg := testConfig(t)

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	app.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestNewAppMountsLegacyRoutes(t *testing.T) {
	cfg := testConfig(t)

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	tokens := sqlitestore.NewTokenRepository(app.db)
	if err := tokens.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(`{
		"account_id":"90011087",
		"broker":"Demo Broker",
		"server_name":"Demo-1"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")
	rec := httptest.NewRecorder()

	app.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /register status = %d, want %d", rec.Code, http.StatusOK)
	}

	accounts := sqlitestore.NewAccountRepository(app.db)
	account, err := accounts.GetAccount(context.Background(), "90011087")
	if err != nil {
		t.Fatalf("GetAccount returned error: %v", err)
	}
	if account.ServerName != "Demo-1" {
		t.Fatalf("ServerName = %q, want %q", account.ServerName, "Demo-1")
	}
}

func TestNewAppBootstrapsAdminTokenCompatibility(t *testing.T) {
	cfg := testConfig(t)
	cfg.AdminToken = "legacy-admin-token"

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	req := httptest.NewRequest(http.MethodGet, "/api/tokens", nil)
	req.Header.Set("X-API-Token", "legacy-admin-token")
	rec := httptest.NewRecorder()

	app.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/tokens status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestNewAppImportsLegacyTokensJSONFromDatabaseDirectory(t *testing.T) {
	cfg := testConfig(t)

	legacyTokens := `{
		"legacy-user-token": {
			"accounts": ["90011087"],
			"name": "legacy-user"
		}
	}`
	if err := os.WriteFile(filepath.Join(filepath.Dir(cfg.DBPath), "tokens.json"), []byte(legacyTokens), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	req := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader(`{
		"account_id":"90011087",
		"broker":"Demo Broker",
		"server_name":"Demo-1"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "legacy-user-token")
	rec := httptest.NewRecorder()

	app.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /register with imported token status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestNewAppAppliesMigrations(t *testing.T) {
	cfg := testConfig(t)

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	var tableName string
	err = app.db.QueryRow(`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table' AND name = 'accounts'
	`).Scan(&tableName)
	if err != nil {
		t.Fatalf("accounts table lookup failed: %v", err)
	}
	if tableName != "accounts" {
		t.Fatalf("table name = %q, want %q", tableName, "accounts")
	}
}

func TestNewAppWiresPendingSignalAPI(t *testing.T) {
	cfg := testConfig(t)

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := app.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	tokens := sqlitestore.NewTokenRepository(app.db)
	accounts := sqlitestore.NewAccountRepository(app.db)
	pendingSignals := sqlitestore.NewPendingSignalRepository(app.db)
	now := time.Date(2026, 4, 15, 8, 0, 0, 0, time.UTC)

	if err := tokens.PutToken(context.Background(), "admin-token", "admin", true, now); err != nil {
		t.Fatalf("PutToken(admin) returned error: %v", err)
	}
	if err := accounts.EnsureAccount(context.Background(), "90011087", now); err != nil {
		t.Fatalf("EnsureAccount returned error: %v", err)
	}

	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      9,
		Strategy:   "pullback",
		Indicators: `{"adx":31,"rsi":58}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(30 * time.Second),
	}
	if err := pendingSignals.SavePendingSignal(context.Background(), signal); err != nil {
		t.Fatalf("SavePendingSignal returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/pending_signal/90011087/XAUUSD", nil)
	req.Header.Set("X-API-Token", "admin-token")
	rec := httptest.NewRecorder()

	app.server.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/pending_signal status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body []domain.PendingSignal
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if len(body) != 1 {
		t.Fatalf("len(body) = %d, want 1 body=%s", len(body), rec.Body.String())
	}
	if body[0].ID != signal.ID {
		t.Fatalf("body[0].id = %d, want %d", body[0].ID, signal.ID)
	}
}

func TestCloseClosesDatabase(t *testing.T) {
	cfg := testConfig(t)

	app, err := New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	if err := app.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	if err := app.db.Ping(); err == nil {
		t.Fatal("Ping succeeded after Close, want database closed")
	}
}

func testConfig(t *testing.T) config.Config {
	t.Helper()

	return config.Config{
		HTTPAddr: ":0",
		DBPath:   filepath.Join(t.TempDir(), "gold-bot.sqlite"),
	}
}
