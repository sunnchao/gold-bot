package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/config"
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
