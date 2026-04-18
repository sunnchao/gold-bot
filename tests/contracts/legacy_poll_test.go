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

	"gold-bot/internal/domain"
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

func TestOrderResultIgnoresPendingAndDuplicateTerminalCallbacks(t *testing.T) {
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
		"sig_pending_contract",
		"90011087",
		"SIGNAL",
		`{"command_id":"sig_pending_contract","action":"SIGNAL","symbol":"XAUUSD"}`,
		"pending",
		time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC).Format(time.RFC3339Nano),
		"",
		"",
		"",
	); err != nil {
		t.Fatalf("seed pending command returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_pending_contract",
		"result":"ERROR",
		"ticket":0,
		"error":"too_early"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /order_result pending status = %d, want %d", rec.Code, http.StatusOK)
	}

	var pendingStatus string
	var pendingAckedAt string
	var pendingFailedAt string
	if err := db.QueryRow(`
		SELECT status, acked_at, failed_at
		FROM commands
		WHERE command_id = ?
	`, "sig_pending_contract").Scan(&pendingStatus, &pendingAckedAt, &pendingFailedAt); err != nil {
		t.Fatalf("query pending command returned error: %v", err)
	}
	if pendingStatus != "pending" {
		t.Fatalf("status = %q, want %q", pendingStatus, "pending")
	}
	if pendingAckedAt != "" || pendingFailedAt != "" {
		t.Fatalf("terminal timestamps = (%q, %q), want empty", pendingAckedAt, pendingFailedAt)
	}
	if got := commandResultCount(t, db, "sig_pending_contract"); got != 0 {
		t.Fatalf("pending command result count = %d, want 0", got)
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
		"sig_duplicate_contract",
		"90011087",
		"SIGNAL",
		`{"command_id":"sig_duplicate_contract","action":"SIGNAL","symbol":"XAUUSD"}`,
		"delivered",
		time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC).Format(time.RFC3339Nano),
		time.Date(2026, 4, 13, 1, 3, 0, 0, time.UTC).Format(time.RFC3339Nano),
		"",
		"",
	); err != nil {
		t.Fatalf("seed delivered command returned error: %v", err)
	}

	firstRec := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_duplicate_contract",
		"result":"OK",
		"ticket":321,
		"error":""
	}`))
	firstReq.Header.Set("Content-Type", "application/json")
	firstReq.Header.Set("X-API-Token", "test-token")
	ts.ServeHTTP(firstRec, firstReq)

	if firstRec.Code != http.StatusOK {
		t.Fatalf("first POST /order_result status = %d, want %d", firstRec.Code, http.StatusOK)
	}

	var firstAckedAt string
	if err := db.QueryRow(`
		SELECT acked_at
		FROM commands
		WHERE command_id = ?
	`, "sig_duplicate_contract").Scan(&firstAckedAt); err != nil {
		t.Fatalf("query first ack timestamp returned error: %v", err)
	}
	if firstAckedAt == "" {
		t.Fatal("first acked_at = empty, want timestamp")
	}

	secondRec := httptest.NewRecorder()
	secondReq := httptest.NewRequest(http.MethodPost, "/order_result", bytes.NewBufferString(`{
		"account_id":"90011087",
		"command_id":"sig_duplicate_contract",
		"result":"ERROR",
		"ticket":0,
		"error":"late_failure"
	}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondReq.Header.Set("X-API-Token", "test-token")
	ts.ServeHTTP(secondRec, secondReq)

	if secondRec.Code != http.StatusOK {
		t.Fatalf("second POST /order_result status = %d, want %d", secondRec.Code, http.StatusOK)
	}

	var status string
	var ackedAt string
	var failedAt string
	if err := db.QueryRow(`
		SELECT status, acked_at, failed_at
		FROM commands
		WHERE command_id = ?
	`, "sig_duplicate_contract").Scan(&status, &ackedAt, &failedAt); err != nil {
		t.Fatalf("query duplicate command returned error: %v", err)
	}
	if status != "acked" {
		t.Fatalf("status = %q, want %q", status, "acked")
	}
	if ackedAt != firstAckedAt {
		t.Fatalf("acked_at = %q, want %q", ackedAt, firstAckedAt)
	}
	if failedAt != "" {
		t.Fatalf("failed_at = %q, want empty", failedAt)
	}
	if got := commandResultCount(t, db, "sig_duplicate_contract"); got != 1 {
		t.Fatalf("duplicate command result count = %d, want 1", got)
	}
}

func TestBarsThenPollReturnsLiveSignalPayloadCompatibleWithEA(t *testing.T) {
	trader := &scriptedLiveTrading{
		commandID: "live_sig_contract",
		payload: map[string]any{
			"symbol":        "XAUUSD",
			"type":          "BUY",
			"entry":         3345.5,
			"sl":            3338.0,
			"tp1":           3358.0,
			"tp2":           3364.0,
			"score":         7,
			"strategy":      "pullback",
			"atr":           1.4,
			"trigger_key":   "H1:2026.04.18 10:00",
			"source":        "live_strategy",
			"analysis_mode": "bars",
		},
	}
	ts, db := newLegacyServerWithLiveTrading(t, trader)

	barRec := httptest.NewRecorder()
	barReq := httptest.NewRequest(http.MethodPost, "/bars", bytes.NewBufferString(`{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"timeframe":"H1",
		"bars":[
			{"time":"2026.04.18 10:00","open":3330.0,"high":3348.0,"low":3329.0,"close":3345.5}
		]
	}`))
	barReq.Header.Set("Content-Type", "application/json")
	barReq.Header.Set("X-API-Token", "test-token")
	ts.ServeHTTP(barRec, barReq)

	if barRec.Code != http.StatusOK {
		t.Fatalf("POST /bars status = %d, want %d body=%s", barRec.Code, http.StatusOK, barRec.Body.String())
	}
	if trader.onBarsCalls != 1 {
		t.Fatalf("OnBars calls = %d, want 1", trader.onBarsCalls)
	}
	if trader.lastAccountID != "90011087" {
		t.Fatalf("OnBars account_id = %q, want 90011087", trader.lastAccountID)
	}
	if trader.lastSymbol != "XAUUSD" {
		t.Fatalf("OnBars symbol = %q, want XAUUSD", trader.lastSymbol)
	}
	if trader.lastTimeframe != "H1" {
		t.Fatalf("OnBars timeframe = %q, want H1", trader.lastTimeframe)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "test-token")
	ts.ServeHTTP(pollRec, pollReq)

	if pollRec.Code != http.StatusOK {
		t.Fatalf("POST /poll status = %d, want %d body=%s", pollRec.Code, http.StatusOK, pollRec.Body.String())
	}

	var pollBody struct {
		Status   string                   `json:"status"`
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Status != "OK" {
		t.Fatalf("status = %q, want OK", pollBody.Status)
	}
	if pollBody.Count != 1 {
		t.Fatalf("count = %d, want 1", pollBody.Count)
	}
	if len(pollBody.Commands) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(pollBody.Commands))
	}

	command := pollBody.Commands[0]
	if got := command["command_id"]; got != "live_sig_contract" {
		t.Fatalf("command_id = %#v, want live_sig_contract", got)
	}
	if got := command["action"]; got != "SIGNAL" {
		t.Fatalf("action = %#v, want SIGNAL", got)
	}
	if got := command["symbol"]; got != "XAUUSD" {
		t.Fatalf("symbol = %#v, want XAUUSD", got)
	}
	if got := command["type"]; got != "BUY" {
		t.Fatalf("type = %#v, want BUY", got)
	}
	if got := command["entry"]; got != 3345.5 {
		t.Fatalf("entry = %#v, want 3345.5", got)
	}
	if got := command["sl"]; got != 3338.0 {
		t.Fatalf("sl = %#v, want 3338.0", got)
	}
	if got := command["tp1"]; got != 3358.0 {
		t.Fatalf("tp1 = %#v, want 3358.0", got)
	}
	if got := command["tp2"]; got != 3364.0 {
		t.Fatalf("tp2 = %#v, want 3364.0", got)
	}
	if got := command["atr"]; got != 1.4 {
		t.Fatalf("atr = %#v, want 1.4", got)
	}
	if got := command["score"]; got != float64(7) {
		t.Fatalf("score = %#v, want 7", got)
	}
	if got := command["strategy"]; got != "pullback" {
		t.Fatalf("strategy = %#v, want pullback", got)
	}
	if got := command["source"]; got != "live_strategy" {
		t.Fatalf("source = %#v, want live_strategy", got)
	}
	if got := command["analysis_mode"]; got != "bars" {
		t.Fatalf("analysis_mode = %#v, want bars", got)
	}
	if got := command["trigger_key"]; got != "H1:2026.04.18 10:00" {
		t.Fatalf("trigger_key = %#v, want H1:2026.04.18 10:00", got)
	}

	var status string
	if err := db.QueryRow(`SELECT status FROM commands WHERE command_id = ?`, "live_sig_contract").Scan(&status); err != nil {
		t.Fatalf("query delivered live command returned error: %v", err)
	}
	if status != "delivered" {
		t.Fatalf("status = %q, want delivered", status)
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

func newLegacyServerWithLiveTrading(t *testing.T, liveTrading legacy.LiveTrading) (http.Handler, *sql.DB) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "contracts-live-poll.sqlite")
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
	commands := sqlitestore.NewCommandRepository(db)
	if err := tokens.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	if stub, ok := liveTrading.(*scriptedLiveTrading); ok {
		stub.commands = commands
	}

	return legacy.NewRouter(legacy.Dependencies{
		Accounts:    accounts,
		Tokens:      tokens,
		Commands:    commands,
		LiveTrading: liveTrading,
	}), db
}

type scriptedLiveTrading struct {
	commands  *sqlitestore.CommandRepository
	commandID string
	payload   map[string]any
	onBarsCalls int
	lastAccountID string
	lastSymbol string
	lastTimeframe string
}

func (s *scriptedLiveTrading) OnBars(ctx context.Context, accountID, symbol string, timeframe string) error {
	if s == nil || s.commands == nil {
		return nil
	}
	s.onBarsCalls++
	s.lastAccountID = accountID
	s.lastSymbol = symbol
	s.lastTimeframe = timeframe
	payload := make(map[string]any, len(s.payload))
	for k, v := range s.payload {
		payload[k] = v
	}
	return s.commands.Enqueue(ctx, domain.Command{
		CommandID: s.commandID,
		AccountID: accountID,
		Action:    domain.CommandActionSignal,
		CreatedAt: time.Date(2026, 4, 18, 2, 3, 4, 0, time.UTC),
		Payload:   payload,
	})
}

func (s *scriptedLiveTrading) OnPositions(context.Context, string, string) error {
	return nil
}

func commandResultCount(t *testing.T, db *sql.DB, commandID string) int {
	t.Helper()

	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM command_results WHERE command_id = ?`, commandID).Scan(&count); err != nil {
		t.Fatalf("count command results returned error: %v", err)
	}

	return count
}
