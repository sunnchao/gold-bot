package legacy

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestBarsHandlerTriggersLiveTradingAfterSavingBars(t *testing.T) {
	ts, db, accounts, _, _ := newLegacyLiveServer(t, &recordingLiveTrading{})

	body := `{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"timeframe":"M1",
		"bars":[
			{"time":"2026.04.18 10:00","open":3330.0,"high":3332.0,"low":3329.0,"close":3331.0},
			{"time":"2026.04.18 10:01","open":3331.0,"high":3333.0,"low":3330.0,"close":3332.0}
		]
	}`

	rec := postLegacyJSON(t, ts, "/bars", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /bars status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	trader := ts.liveTrading
	if len(trader.barCalls) != 1 {
		t.Fatalf("live trader bar calls = %d, want 1", len(trader.barCalls))
	}
	if got := trader.barCalls[0]; got != (liveTradingBarCall{accountID: "90011087", symbol: "XAUUSD", timeframe: "M1"}) {
		t.Fatalf("live trader call = %+v, want %+v", got, liveTradingBarCall{accountID: "90011087", symbol: "XAUUSD", timeframe: "M1"})
	}

	state, err := accounts.GetStateSymbol(context.Background(), "90011087", "XAUUSD")
	if err != nil {
		t.Fatalf("GetStateSymbol returned error: %v", err)
	}
	if got := len(state.Bars["M1"]); got != 2 {
		t.Fatalf("saved M1 bars = %d, want 2", got)
	}

	if count := commandCount(t, db); count != 0 {
		t.Fatalf("commands count = %d, want 0 for recorder-only test", count)
	}
}

func TestBarsHandlerKeepsAckingWhenLiveTradingFails(t *testing.T) {
	trader := &recordingLiveTrading{barErr: errors.New("live trading unavailable")}
	ts, _, accounts, _, _ := newLegacyLiveServer(t, trader)

	body := `{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"timeframe":"M1",
		"bars":[
			{"time":"2026.04.18 10:00","open":3330.0,"high":3332.0,"low":3329.0,"close":3331.0},
			{"time":"2026.04.18 10:01","open":3331.0,"high":3333.0,"low":3330.0,"close":3332.0}
		]
	}`

	rec := postLegacyJSON(t, ts, "/bars", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /bars status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(trader.barCalls) != 1 {
		t.Fatalf("live trader bar calls = %d, want 1", len(trader.barCalls))
	}

	var resp struct {
		Status   string `json:"status"`
		Received int    `json:"received"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if resp.Status != "OK" {
		t.Fatalf("response status = %q, want OK", resp.Status)
	}
	if resp.Received != 2 {
		t.Fatalf("response received = %d, want 2", resp.Received)
	}

	state, err := accounts.GetStateSymbol(context.Background(), "90011087", "XAUUSD")
	if err != nil {
		t.Fatalf("GetStateSymbol returned error: %v", err)
	}
	if got := len(state.Bars["M1"]); got != 2 {
		t.Fatalf("saved M1 bars = %d, want 2", got)
	}
}

func TestPositionsHandlerKeepsAckingWhenLiveTradingFails(t *testing.T) {
	trader := &recordingLiveTrading{positionErr: errors.New("live trading unavailable")}
	ts, _, accounts, _, _ := newLegacyLiveServer(t, trader)

	body := `{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"positions":[
			{"ticket":123456,"symbol":"XAUUSD","type":"BUY","lots":0.10,"open_price":3330.5,"sl":3328.0,"tp":3338.0,"profit":12.5}
		]
	}`

	rec := postLegacyJSON(t, ts, "/positions", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /positions status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(trader.positionCalls) != 1 {
		t.Fatalf("live trader position calls = %d, want 1", len(trader.positionCalls))
	}
	if got := trader.positionCalls[0]; got != (liveTradingPositionCall{accountID: "90011087", symbol: "XAUUSD"}) {
		t.Fatalf("live trader position call = %+v, want %+v", got, liveTradingPositionCall{accountID: "90011087", symbol: "XAUUSD"})
	}

	var resp struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Unmarshal response returned error: %v", err)
	}
	if resp.Status != "OK" {
		t.Fatalf("response status = %q, want OK", resp.Status)
	}
	if resp.Count != 1 {
		t.Fatalf("response count = %d, want 1", resp.Count)
	}

	state, err := accounts.GetStateSymbol(context.Background(), "90011087", "XAUUSD")
	if err != nil {
		t.Fatalf("GetStateSymbol returned error: %v", err)
	}
	if got := len(state.Positions); got != 1 {
		t.Fatalf("saved positions = %d, want 1", got)
	}
	if got := state.Positions[0].Ticket; got != 123456 {
		t.Fatalf("saved ticket = %d, want 123456", got)
	}
}

func TestLiveTradingExecutorOnBarsEnqueuesSignalCommand(t *testing.T) {
	_, db, accounts, _, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 2, 0, 0, time.UTC)

	seedTradeableState(t, accounts, now, "90011087", "XAUUSD", "2026.04.18 10:00")

	analyzer := &fakeLiveSignalAnalyzer{
		signal: &domain.Signal{
			Side:      "BUY",
			Entry:     3335.7,
			StopLoss:  3331.2,
			TP1:       3339.8,
			TP2:       3344.1,
			Score:     8,
			Strategy:  "pullback",
			ATR:       1.5,
		},
	}
	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			if symbol != "XAUUSD" {
				t.Fatalf("analyzerFactory symbol = %q, want XAUUSD", symbol)
			}
			return analyzer
		},
		now: func() time.Time { return now },
	}

	if err := executor.OnBars(ctx, "90011087", "XAUUSD", "H1"); err != nil {
		t.Fatalf("OnBars returned error: %v", err)
	}

	if analyzer.calls != 1 {
		t.Fatalf("analyzer calls = %d, want 1", analyzer.calls)
	}
	if analyzer.snapshot.AccountID != "90011087" {
		t.Fatalf("snapshot account_id = %q, want 90011087", analyzer.snapshot.AccountID)
	}
	if analyzer.snapshot.Symbol != "XAUUSD" {
		t.Fatalf("snapshot symbol = %q, want XAUUSD", analyzer.snapshot.Symbol)
	}
	if analyzer.snapshot.CurrentPrice != 3335.6 {
		t.Fatalf("snapshot current price = %v, want 3335.6", analyzer.snapshot.CurrentPrice)
	}

	if got := commandCount(t, db); got != 1 {
		t.Fatalf("commands count = %d, want 1", got)
	}

	commandID := firstCommandID(t, db)
	command, err := commands.Get(ctx, commandID)
	if err != nil {
		t.Fatalf("Get(command) returned error: %v", err)
	}
	if command.Action != domain.CommandActionSignal {
		t.Fatalf("command action = %q, want %q", command.Action, domain.CommandActionSignal)
	}
	if got := command.Payload["symbol"]; got != "XAUUSD" {
		t.Fatalf("payload symbol = %#v, want XAUUSD", got)
	}
	if got := command.Payload["type"]; got != "BUY" {
		t.Fatalf("payload type = %#v, want BUY", got)
	}
	if got := command.Payload["strategy"]; got != "pullback" {
		t.Fatalf("payload strategy = %#v, want pullback", got)
	}
	if got := command.Payload["score"]; got != float64(8) {
		t.Fatalf("payload score = %#v, want 8", got)
	}
	if got := command.Payload["sl"]; got != 3331.2 {
		t.Fatalf("payload sl = %#v, want 3331.2", got)
	}
	if got := command.Payload["tp1"]; got != 3339.8 {
		t.Fatalf("payload tp1 = %#v, want 3339.8", got)
	}
	if got := command.Payload["tp2"]; got != 3344.1 {
		t.Fatalf("payload tp2 = %#v, want 3344.1", got)
	}
}

func TestBarsThenPollReturnsExecutorSignalPayloadCompatibleWithEA(t *testing.T) {
	_, db, accounts, tokens, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 2, 0, 0, time.UTC)

	seedTradeableState(t, accounts, now, "90011087", "XAUUSD", "2026.04.18 10:00")

	analyzer := &fakeLiveSignalAnalyzer{
		signal: &domain.Signal{
			Side:      "BUY",
			Entry:     3335.7,
			StopLoss:  3331.2,
			TP1:       3339.8,
			TP2:       3344.1,
			Score:     8,
			Strategy:  "pullback",
			ATR:       1.5,
		},
	}
	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			if symbol != "XAUUSD" {
				t.Fatalf("analyzerFactory symbol = %q, want XAUUSD", symbol)
			}
			return analyzer
		},
		now: func() time.Time { return now },
	}
	handler := NewRouter(Dependencies{
		Accounts:    accounts,
		Tokens:      tokens,
		Commands:    commands,
		LiveTrading: executor,
	})

	barRec := httptest.NewRecorder()
	barReq := httptest.NewRequest(http.MethodPost, "/bars", bytes.NewBufferString(`{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"timeframe":"H1",
		"bars":[
			{"time":"2026.04.18 10:00","open":3330.0,"high":3336.0,"low":3328.0,"close":3335.6}
		]
	}`))
	barReq.Header.Set("Content-Type", "application/json")
	barReq.Header.Set("X-API-Token", "test-token")
	handler.ServeHTTP(barRec, barReq)

	if barRec.Code != http.StatusOK {
		t.Fatalf("POST /bars status = %d, want %d body=%s", barRec.Code, http.StatusOK, barRec.Body.String())
	}
	if analyzer.calls != 1 {
		t.Fatalf("analyzer calls = %d, want 1", analyzer.calls)
	}
	if got := commandCount(t, db); got != 1 {
		t.Fatalf("commands count = %d, want 1", got)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "test-token")
	handler.ServeHTTP(pollRec, pollReq)

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

	expectedCommandID := buildStrategyCommandID("90011087", "XAUUSD", *analyzer.signal, "H1:2026.04.18 10:00")
	command := pollBody.Commands[0]
	if got := command["command_id"]; got != expectedCommandID {
		t.Fatalf("command_id = %#v, want %s", got, expectedCommandID)
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
	if got := command["entry"]; got != 3335.7 {
		t.Fatalf("entry = %#v, want 3335.7", got)
	}
	if got := command["sl"]; got != 3331.2 {
		t.Fatalf("sl = %#v, want 3331.2", got)
	}
	if got := command["tp1"]; got != 3339.8 {
		t.Fatalf("tp1 = %#v, want 3339.8", got)
	}
	if got := command["tp2"]; got != 3344.1 {
		t.Fatalf("tp2 = %#v, want 3344.1", got)
	}
	if got := command["score"]; got != float64(8) {
		t.Fatalf("score = %#v, want 8", got)
	}
	if got := command["strategy"]; got != "pullback" {
		t.Fatalf("strategy = %#v, want pullback", got)
	}
	if got := command["atr"]; got != 1.5 {
		t.Fatalf("atr = %#v, want 1.5", got)
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

	stored, err := commands.Get(ctx, expectedCommandID)
	if err != nil {
		t.Fatalf("Get(command) returned error: %v", err)
	}
	if stored.Status != domain.CommandStatusDelivered {
		t.Fatalf("stored status = %q, want delivered", stored.Status)
	}
}

func TestLiveTradingExecutorOnPositionsEnqueuesSignalCommand(t *testing.T) {
	_, db, accounts, _, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 2, 0, 0, time.UTC)

	seedTradeableState(t, accounts, now, "90011087", "XAUUSD", "2026.04.18 10:00")

	analyzer := &fakeLiveSignalAnalyzer{
		signal: &domain.Signal{
			Side:      "BUY",
			Entry:     3335.7,
			StopLoss:  3331.2,
			TP1:       3339.8,
			TP2:       3344.1,
			Score:     8,
			Strategy:  "pullback",
			ATR:       1.5,
		},
	}
	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			if symbol != "XAUUSD" {
				t.Fatalf("analyzerFactory symbol = %q, want XAUUSD", symbol)
			}
			return analyzer
		},
		now: func() time.Time { return now },
	}

	if err := executor.OnPositions(ctx, "90011087", "XAUUSD"); err != nil {
		t.Fatalf("OnPositions returned error: %v", err)
	}

	if analyzer.calls != 1 {
		t.Fatalf("analyzer calls = %d, want 1", analyzer.calls)
	}
	if got := commandCount(t, db); got != 1 {
		t.Fatalf("commands count = %d, want 1", got)
	}

	commandID := firstCommandID(t, db)
	command, err := commands.Get(ctx, commandID)
	if err != nil {
		t.Fatalf("Get(command) returned error: %v", err)
	}
	if got := command.Payload["analysis_mode"]; got != "positions" {
		t.Fatalf("payload analysis_mode = %#v, want positions", got)
	}
}

func TestLiveTradingExecutorDeduplicatesSameDecisionWindow(t *testing.T) {
	_, db, accounts, _, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 5, 0, 0, time.UTC)

	seedTradeableState(t, accounts, now, "90011087", "XAUUSD", "2026.04.18 10:00")

	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			return &fakeLiveSignalAnalyzer{
				signal: &domain.Signal{
					Side:      "BUY",
					Entry:     3335.7,
					StopLoss:  3331.2,
					TP1:       3339.8,
					TP2:       3344.1,
					Score:     8,
					Strategy:  "pullback",
					ATR:      1.5,
				},
			}
		},
		now: func() time.Time { return now },
	}

	if err := executor.OnBars(ctx, "90011087", "XAUUSD", "H1"); err != nil {
		t.Fatalf("first OnBars returned error: %v", err)
	}
	if err := executor.OnBars(ctx, "90011087", "XAUUSD", "H1"); err != nil {
		t.Fatalf("second OnBars returned error: %v", err)
	}

	if got := commandCount(t, db); got != 1 {
		t.Fatalf("commands count = %d, want 1 after duplicate decision window", got)
	}
}

func TestLiveTradingExecutorSkipsWhenTradingDisabled(t *testing.T) {
	_, db, accounts, _, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 10, 0, 0, time.UTC)

	seedAccountState(t, accounts, now, domain.AccountRuntime{
		AccountID:       "90011087",
		Connected:       true,
		MarketOpen:      true,
		IsTradeAllowed:  false,
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	})

	analyzer := &fakeLiveSignalAnalyzer{
		signal: &domain.Signal{
			Side:      "BUY",
			Entry:     3335.7,
			StopLoss:  3331.2,
			TP1:       3339.8,
			TP2:       3344.1,
			Score:     8,
			Strategy:  "pullback",
			ATR:      1.5,
		},
	}
	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer { return analyzer },
		now:             func() time.Time { return now },
	}

	if err := executor.OnBars(ctx, "90011087", "XAUUSD", "H1"); err != nil {
		t.Fatalf("OnBars returned error: %v", err)
	}

	if analyzer.calls != 0 {
		t.Fatalf("analyzer calls = %d, want 0 when trading disabled", analyzer.calls)
	}
	if got := commandCount(t, db); got != 0 {
		t.Fatalf("commands count = %d, want 0 when trading disabled", got)
	}
}

func TestLiveTradingExecutorLogsScalpContextWithAccountAndSymbol(t *testing.T) {
	_, _, accounts, _, commands := newLegacyLiveServer(t, nil)
	ctx := context.Background()
	now := time.Date(2026, time.April, 18, 10, 2, 0, 0, time.UTC)

	seedTradeableState(t, accounts, now, "90011087", "XAUUSD", "2026.04.18 10:00")

	analyzer := &fakeLiveSignalAnalyzer{
		logs: []domain.AnalysisLog{
			{Level: "info", Strategy: "动量剥头皮", Message: "M5 EMA多头排列未满足 ⏭"},
		},
	}
	executor := &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			return analyzer
		},
		now: func() time.Time { return now },
	}

	var buf bytes.Buffer
	prevWriter := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(prevWriter)
	defer log.SetOutput(io.Discard)

	if err := executor.OnBars(ctx, "90011087", "XAUUSD", "H1"); err != nil {
		t.Fatalf("OnBars returned error: %v", err)
	}

	output := buf.String()
	for _, want := range []string{
		"[STRATEGY-SCALP]",
		"account=90011087",
		"symbol=XAUUSD",
		"info",
		"M5 EMA多头排列未满足",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("log output = %q, want substring %q", output, want)
		}
	}
}

type fakeLiveSignalAnalyzer struct {
	signal   *domain.Signal
	logs     []domain.AnalysisLog
	calls    int
	snapshot domain.AnalysisSnapshot
}

func (f *fakeLiveSignalAnalyzer) Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog) {
	f.calls++
	f.snapshot = snapshot
	return f.signal, f.logs
}

type liveTradingBarCall struct {
	accountID string
	symbol    string
	timeframe string
}

type liveTradingPositionCall struct {
	accountID string
	symbol    string
}

type recordingLiveTrading struct {
	barCalls      []liveTradingBarCall
	positionCalls []liveTradingPositionCall
	barErr        error
	positionErr   error
}

func (r *recordingLiveTrading) OnBars(_ context.Context, accountID, symbol, timeframe string) error {
	r.barCalls = append(r.barCalls, liveTradingBarCall{accountID: accountID, symbol: symbol, timeframe: timeframe})
	return r.barErr
}

func (r *recordingLiveTrading) OnPositions(_ context.Context, accountID, symbol string) error {
	r.positionCalls = append(r.positionCalls, liveTradingPositionCall{accountID: accountID, symbol: symbol})
	return r.positionErr
}

type legacyHarness struct {
	http.Handler
	liveTrading *recordingLiveTrading
}

func newLegacyLiveServer(t *testing.T, trader *recordingLiveTrading) (*legacyHarness, *sql.DB, *sqlitestore.AccountRepository, *sqlitestore.TokenRepository, *sqlitestore.CommandRepository) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "legacy-live.sqlite")
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
	if trader == nil {
		trader = &recordingLiveTrading{}
	}

	return &legacyHarness{
		Handler: NewRouter(Dependencies{
			Accounts:    accounts,
			Tokens:      tokens,
			Commands:    commands,
			LiveTrading: trader,
		}),
		liveTrading: trader,
	}, db, accounts, tokens, commands
}

func seedTradeableState(t *testing.T, accounts *sqlitestore.AccountRepository, now time.Time, accountID, symbol, barTime string) {
	t.Helper()
	seedAccountState(t, accounts, now, domain.AccountRuntime{
		AccountID:       accountID,
		Connected:       true,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	})
	ctx := context.Background()
	if err := accounts.SaveTickSnapshot(ctx, accountID, symbol, domain.TickSnapshot{
		Symbol: symbol,
		Bid:    3335.5,
		Ask:    3335.7,
		Spread: 0.2,
		Time:   "10:00:00",
	}, now); err != nil {
		t.Fatalf("SaveTickSnapshot returned error: %v", err)
	}
	if err := accounts.SaveBars(ctx, accountID, symbol, "H1", []domain.Bar{{
		Time:  barTime,
		Open:  3330.0,
		High:  3336.0,
		Low:   3328.0,
		Close: 3335.0,
	}}, now); err != nil {
		t.Fatalf("SaveBars(H1) returned error: %v", err)
	}
	if err := accounts.SavePositions(ctx, accountID, symbol, nil, now); err != nil {
		t.Fatalf("SavePositions returned error: %v", err)
	}
}

func seedAccountState(t *testing.T, accounts *sqlitestore.AccountRepository, now time.Time, runtime domain.AccountRuntime) {
	t.Helper()
	ctx := context.Background()
	if err := accounts.EnsureAccount(ctx, runtime.AccountID, now); err != nil {
		t.Fatalf("EnsureAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(ctx, runtime); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
}

func postLegacyJSON(t *testing.T, ts http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")
	ts.ServeHTTP(rec, req)
	return rec
}

func commandCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM commands`).Scan(&count); err != nil {
		t.Fatalf("count commands returned error: %v", err)
	}
	return count
}

func firstCommandID(t *testing.T, db *sql.DB) string {
	t.Helper()
	var commandID string
	if err := db.QueryRow(`SELECT command_id FROM commands ORDER BY created_at ASC LIMIT 1`).Scan(&commandID); err != nil {
		t.Fatalf("first command id returned error: %v", err)
	}
	return commandID
}
