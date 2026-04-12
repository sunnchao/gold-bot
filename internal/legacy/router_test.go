package legacy

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
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

func TestRegisterRejectsAccountOutsideTokenBinding(t *testing.T) {
	ts, accounts, tokens := newTestServer(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewBufferString(`{
		"account_id":"90022000",
		"broker":"Demo Broker"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /register status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	assertAccountMissing(t, accounts, "90022000")
	assertTokenAccounts(t, tokens, "test-token", []string{"90011087"})
}

func TestHeartbeatRejectsAccountOutsideTokenBinding(t *testing.T) {
	ts, accounts, tokens := newTestServer(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", bytes.NewBufferString(`{
		"account_id":"90022000",
		"balance":1000
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /heartbeat status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	assertAccountMissing(t, accounts, "90022000")
	assertTokenAccounts(t, tokens, "test-token", []string{"90011087"})
}

func TestStreamingHandlersRejectAccountOutsideTokenBinding(t *testing.T) {
	testCases := []struct {
		name string
		path string
		body string
	}{
		{
			name: "tick",
			path: "/tick",
			body: `{
				"account_id":"90022000",
				"symbol":"XAUUSD",
				"bid":3344.1,
				"ask":3344.3
			}`,
		},
		{
			name: "bars",
			path: "/bars",
			body: `{
				"account_id":"90022000",
				"timeframe":"H1",
				"bars":[{"time":"2026.04.12 10:00","open":3300}]
			}`,
		},
		{
			name: "positions",
			path: "/positions",
			body: `{
				"account_id":"90022000",
				"positions":[{"ticket":1,"symbol":"XAUUSD","profit":12.5}]
			}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ts, accounts, tokens := newTestServer(t)
			ctx := context.Background()

			if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
				t.Fatalf("BindAccount returned error: %v", err)
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-API-Token", "test-token")

			ts.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("POST %s status = %d, want %d", tc.path, rec.Code, http.StatusForbidden)
			}

			assertAccountMissing(t, accounts, "90022000")
			assertRuntimeMissing(t, accounts, "90022000")
			assertTokenAccounts(t, tokens, "test-token", []string{"90011087"})
		})
	}
}

func TestLegacyHandlersRejectBadRequestWithoutPersistingDefaultAccount(t *testing.T) {
	testCases := []struct {
		name string
		path string
		body string
	}{
		{name: "register invalid json", path: "/register", body: `{"account_id":`},
		{name: "register missing account", path: "/register", body: `{"broker":"Demo Broker"}`},
		{name: "heartbeat invalid json", path: "/heartbeat", body: `{"account_id":`},
		{name: "heartbeat missing account", path: "/heartbeat", body: `{"balance":1000}`},
		{name: "tick invalid json", path: "/tick", body: `{"account_id":`},
		{name: "tick missing account", path: "/tick", body: `{"symbol":"XAUUSD"}`},
		{name: "bars invalid json", path: "/bars", body: `{"account_id":`},
		{name: "bars missing account", path: "/bars", body: `{"bars":[]}`},
		{name: "positions invalid json", path: "/positions", body: `{"account_id":`},
		{name: "positions missing account", path: "/positions", body: `{"positions":[]}`},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ts, accounts, tokens := newTestServer(t)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-API-Token", "test-token")

			ts.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s status = %d, want %d", tc.path, rec.Code, http.StatusBadRequest)
			}

			assertAccountMissing(t, accounts, "default")
			assertAccountMissing(t, accounts, "")
			assertTokenAccounts(t, tokens, "test-token", nil)
		})
	}
}

func TestPollRejectsAccountOutsideTokenBinding(t *testing.T) {
	ts, db, _, tokens := newTestServerWithDB(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO commands (
			command_id,
			account_id,
			action,
			payload_json,
			status,
			created_at,
			delivered_at,
			acked_at,
			failed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		"sig_forbidden",
		"90022000",
		"SIGNAL",
		`{"command_id":"sig_forbidden","action":"SIGNAL","symbol":"XAUUSD"}`,
		"pending",
		time.Now().UTC().Format(time.RFC3339Nano),
		"",
		"",
		"",
	); err != nil {
		t.Fatalf("seed pending command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90022000"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /poll status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	var status string
	if err := db.QueryRow(`SELECT status FROM commands WHERE command_id = ?`, "sig_forbidden").Scan(&status); err != nil {
		t.Fatalf("query pending command returned error: %v", err)
	}
	if status != "pending" {
		t.Fatalf("status = %q, want %q", status, "pending")
	}
	assertTokenAccounts(t, tokens, "test-token", []string{"90011087"})
}

func TestOrderResultRejectsAccountOutsideTokenBinding(t *testing.T) {
	ts, db, _, tokens := newTestServerWithDB(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO commands (
			command_id,
			account_id,
			action,
			payload_json,
			status,
			created_at,
			delivered_at,
			acked_at,
			failed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		"sig_denied_result",
		"90022000",
		"SIGNAL",
		`{"command_id":"sig_denied_result","action":"SIGNAL","symbol":"XAUUSD"}`,
		"delivered",
		time.Now().UTC().Format(time.RFC3339Nano),
		time.Now().UTC().Format(time.RFC3339Nano),
		"",
		"",
	); err != nil {
		t.Fatalf("seed delivered command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90022000",
		"command_id":"sig_denied_result",
		"result":"ERROR",
		"ticket":0,
		"error":"denied"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /order_result status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	var status string
	if err := db.QueryRow(`SELECT status FROM commands WHERE command_id = ?`, "sig_denied_result").Scan(&status); err != nil {
		t.Fatalf("query delivered command returned error: %v", err)
	}
	if status != "delivered" {
		t.Fatalf("status = %q, want %q", status, "delivered")
	}

	var resultCount int
	if err := db.QueryRow(`SELECT COUNT(1) FROM command_results WHERE command_id = ?`, "sig_denied_result").Scan(&resultCount); err != nil {
		t.Fatalf("query command results returned error: %v", err)
	}
	if resultCount != 0 {
		t.Fatalf("command result count = %d, want %d", resultCount, 0)
	}
	assertTokenAccounts(t, tokens, "test-token", []string{"90011087"})
}

func TestOrderResultIgnoresCommandOwnedByDifferentAccount(t *testing.T) {
	ts, db, _, tokens := newTestServerWithDB(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO commands (
			command_id,
			account_id,
			action,
			payload_json,
			status,
			created_at,
			delivered_at,
			acked_at,
			failed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		"sig_cross_account",
		"90022000",
		"SIGNAL",
		`{"command_id":"sig_cross_account","action":"SIGNAL","symbol":"XAUUSD"}`,
		"delivered",
		time.Now().UTC().Format(time.RFC3339Nano),
		time.Now().UTC().Format(time.RFC3339Nano),
		"",
		"",
	); err != nil {
		t.Fatalf("seed delivered command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_cross_account",
		"result":"OK",
		"ticket":123,
		"error":""
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /order_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	var status string
	var ackedAt string
	var failedAt string
	if err := db.QueryRow(`
		SELECT status, acked_at, failed_at
		FROM commands
		WHERE command_id = ?
	`, "sig_cross_account").Scan(&status, &ackedAt, &failedAt); err != nil {
		t.Fatalf("query command returned error: %v", err)
	}
	if status != "delivered" {
		t.Fatalf("status = %q, want %q", status, "delivered")
	}
	if ackedAt != "" {
		t.Fatalf("acked_at = %q, want empty", ackedAt)
	}
	if failedAt != "" {
		t.Fatalf("failed_at = %q, want empty", failedAt)
	}

	var resultCount int
	if err := db.QueryRow(`SELECT COUNT(1) FROM command_results WHERE command_id = ?`, "sig_cross_account").Scan(&resultCount); err != nil {
		t.Fatalf("query command results returned error: %v", err)
	}
	if resultCount != 0 {
		t.Fatalf("command result count = %d, want %d", resultCount, 0)
	}
}

func TestOrderResultIgnoresUnknownCommand(t *testing.T) {
	ts, db, _, tokens := newTestServerWithDB(t)
	ctx := context.Background()

	if err := tokens.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_missing",
		"result":"ERROR",
		"ticket":0,
		"error":"missing"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /order_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resultCount int
	if err := db.QueryRow(`SELECT COUNT(1) FROM command_results WHERE command_id = ?`, "sig_missing").Scan(&resultCount); err != nil {
		t.Fatalf("query command results returned error: %v", err)
	}
	if resultCount != 0 {
		t.Fatalf("command result count = %d, want %d", resultCount, 0)
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

func newTestServerWithDB(t *testing.T) (http.Handler, *sql.DB, *sqlitestore.AccountRepository, *sqlitestore.TokenRepository) {
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
	}), db, accounts, tokens
}

func assertTokenAccounts(t *testing.T, tokens *sqlitestore.TokenRepository, token string, want []string) {
	t.Helper()

	got, err := tokens.AccountsForToken(context.Background(), token)
	if err != nil {
		t.Fatalf("AccountsForToken returned error: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("AccountsForToken = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("AccountsForToken = %v, want %v", got, want)
		}
	}
}

func assertAccountMissing(t *testing.T, accounts *sqlitestore.AccountRepository, accountID string) {
	t.Helper()

	_, err := accounts.GetAccount(context.Background(), accountID)
	if err == nil {
		t.Fatalf("GetAccount(%q) unexpectedly succeeded", accountID)
	}
	if !errors.Is(err, sql.ErrNoRows) && !strings.Contains(err.Error(), "sql: no rows in result set") {
		t.Fatalf("GetAccount(%q) returned unexpected error: %v", accountID, err)
	}
}

func assertRuntimeMissing(t *testing.T, accounts *sqlitestore.AccountRepository, accountID string) {
	t.Helper()

	_, err := accounts.GetRuntime(context.Background(), accountID)
	if err == nil {
		t.Fatalf("GetRuntime(%q) unexpectedly succeeded", accountID)
	}
	if !errors.Is(err, sql.ErrNoRows) && !strings.Contains(err.Error(), "sql: no rows in result set") {
		t.Fatalf("GetRuntime(%q) returned unexpected error: %v", accountID, err)
	}
}
