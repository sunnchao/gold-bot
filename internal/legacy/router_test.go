package legacy

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestRegisterPersistsAccountAndTokenBinding(t *testing.T) {
	ts, accounts, tokens := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewBufferString(`{
		"account_id":"90011087",
		"broker":"Demo Broker",
		"server_name":"Demo-1",
		"account_name":"Primary",
		"currency":"USD",
		"leverage":500
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /register status = %d, want %d", rec.Code, http.StatusOK)
	}

	account, err := accounts.GetAccount(context.Background(), "90011087")
	if err != nil {
		t.Fatalf("GetAccount returned error: %v", err)
	}
	if account.ServerName != "Demo-1" {
		t.Fatalf("ServerName = %q, want %q", account.ServerName, "Demo-1")
	}

	bound, err := tokens.AccountsForToken(context.Background(), "test-token")
	if err != nil {
		t.Fatalf("AccountsForToken returned error: %v", err)
	}
	if len(bound) != 1 || bound[0] != "90011087" {
		t.Fatalf("bound accounts = %v, want [90011087]", bound)
	}
}

func TestHeartbeatPersistsRuntimeSnapshot(t *testing.T) {
	ts, accounts, _ := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", bytes.NewBufferString(`{
		"account_id":"90011087",
		"balance":1000.5,
		"equity":1100.25,
		"margin":100,
		"free_margin":1000.25,
		"server_time":"2026.04.12 11:04",
		"market_open":true,
		"is_trade_allowed":true
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /heartbeat status = %d, want %d", rec.Code, http.StatusOK)
	}

	runtime, err := accounts.GetRuntime(context.Background(), "90011087")
	if err != nil {
		t.Fatalf("GetRuntime returned error: %v", err)
	}
	if !runtime.Connected {
		t.Fatal("Connected = false, want true")
	}
	if runtime.Balance != 1000.5 {
		t.Fatalf("Balance = %v, want %v", runtime.Balance, 1000.5)
	}
	if runtime.LastHeartbeatAt.IsZero() {
		t.Fatal("LastHeartbeatAt is zero")
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if body["status"] != "OK" {
		t.Fatalf("status = %v, want OK", body["status"])
	}
}

func TestTickUpdatesRuntimeTimestamp(t *testing.T) {
	ts, accounts, _ := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/tick", bytes.NewBufferString(`{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"bid":3344.1,
		"ask":3344.3,
		"spread":2
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /tick status = %d, want %d", rec.Code, http.StatusOK)
	}

	runtime, err := accounts.GetRuntime(context.Background(), "90011087")
	if err != nil {
		t.Fatalf("GetRuntime returned error: %v", err)
	}
	if runtime.LastTickAt.IsZero() {
		t.Fatal("LastTickAt is zero")
	}
}

func TestBarsReturnsReceivedCount(t *testing.T) {
	ts, _, _ := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/bars", bytes.NewBufferString(`{
		"account_id":"90011087",
		"timeframe":"H1",
		"bars":[{"time":"2026.04.12 10:00","open":3300},{"time":"2026.04.12 11:00","open":3310}]
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /bars status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if body["received"] != float64(2) {
		t.Fatalf("received = %v, want 2", body["received"])
	}
}

func TestPositionsReturnsCount(t *testing.T) {
	ts, _, _ := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/positions", bytes.NewBufferString(`{
		"account_id":"90011087",
		"positions":[{"ticket":1,"symbol":"XAUUSD","profit":12.5},{"ticket":2,"symbol":"XAUUSD","profit":-3.5}]
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /positions status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if body["count"] != float64(2) {
		t.Fatalf("count = %v, want 2", body["count"])
	}
}

func newTestServer(t *testing.T) (http.Handler, *sqlitestore.AccountRepository, *sqlitestore.TokenRepository) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "legacy.sqlite")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	if err := tokens.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	return NewRouter(Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
	}), accounts, tokens
}
