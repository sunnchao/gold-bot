package app

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"gold-bot/internal/config"
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
