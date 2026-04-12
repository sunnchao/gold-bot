package contracts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/legacy"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestPollReturnsPendingCommandsAndMarksDelivered(t *testing.T) {
	ts, db := newLegacyServerWithDB(t)

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
		"sig_1",
		"90011087",
		"SIGNAL",
		`{"command_id":"sig_1","action":"SIGNAL","type":"BUY","symbol":"XAUUSD","entry":3345.5,"sl":3338,"tp1":3358,"score":7,"strategy":"pullback"}`,
		"pending",
		time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC).Format(time.RFC3339Nano),
		"",
		"",
		"",
	); err != nil {
		t.Fatalf("seed pending command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /poll status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status   string                   `json:"status"`
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want %q", body.Status, "OK")
	}
	if body.Count != 1 {
		t.Fatalf("count = %d, want %d", body.Count, 1)
	}
	if len(body.Commands) != 1 {
		t.Fatalf("len(commands) = %d, want %d", len(body.Commands), 1)
	}
	if got := body.Commands[0]["command_id"]; got != "sig_1" {
		t.Fatalf("command_id = %v, want sig_1", got)
	}
	if got := body.Commands[0]["action"]; got != "SIGNAL" {
		t.Fatalf("action = %v, want SIGNAL", got)
	}

	var status string
	var deliveredAt string
	if err := db.QueryRow(`
		SELECT status, delivered_at
		FROM commands
		WHERE command_id = ?
	`, "sig_1").Scan(&status, &deliveredAt); err != nil {
		t.Fatalf("query delivered command returned error: %v", err)
	}
	if status != "delivered" {
		t.Fatalf("status = %q, want %q", status, "delivered")
	}
	if deliveredAt == "" {
		t.Fatal("delivered_at = empty, want timestamp")
	}
}

func TestOrderResultPersistsAuditAndUpdatesCommandStatus(t *testing.T) {
	ts, db := newLegacyServerWithDB(t)

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
		"sig_2",
		"90011087",
		"SIGNAL",
		`{"command_id":"sig_2","action":"SIGNAL","symbol":"XAUUSD"}`,
		"delivered",
		time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC).Format(time.RFC3339Nano),
		time.Date(2026, 4, 13, 1, 3, 0, 0, time.UTC).Format(time.RFC3339Nano),
		"",
		"",
	); err != nil {
		t.Fatalf("seed delivered command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_2",
		"result":"OK",
		"ticket":321,
		"error":""
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /order_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if body["status"] != "OK" {
		t.Fatalf("status = %v, want OK", body["status"])
	}

	var status string
	var ackedAt string
	if err := db.QueryRow(`
		SELECT status, acked_at
		FROM commands
		WHERE command_id = ?
	`, "sig_2").Scan(&status, &ackedAt); err != nil {
		t.Fatalf("query acked command returned error: %v", err)
	}
	if status != "acked" {
		t.Fatalf("status = %q, want %q", status, "acked")
	}
	if ackedAt == "" {
		t.Fatal("acked_at = empty, want timestamp")
	}

	var accountID string
	var result string
	var ticket int
	var errorText string
	if err := db.QueryRow(`
		SELECT account_id, result, ticket, error_text
		FROM command_results
		WHERE command_id = ?
	`, "sig_2").Scan(&accountID, &result, &ticket, &errorText); err != nil {
		t.Fatalf("query command result returned error: %v", err)
	}
	if accountID != "90011087" {
		t.Fatalf("account_id = %q, want %q", accountID, "90011087")
	}
	if result != "OK" {
		t.Fatalf("result = %q, want %q", result, "OK")
	}
	if ticket != 321 {
		t.Fatalf("ticket = %d, want %d", ticket, 321)
	}
	if errorText != "" {
		t.Fatalf("error_text = %q, want empty", errorText)
	}
}

func newLegacyServerWithDB(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "contracts-poll.sqlite")
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

	return legacy.NewRouter(legacy.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
	}), db
}
