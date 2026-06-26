package api_test

import (
	"bytes"
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

func TestVisualPollReturnsAISummaryAndFilteredAlerts(t *testing.T) {
	ctx := context.Background()
	accounts := store.NewMemoryAccountStore()
	tokens := visualTestTokenStore{
		validTokens: map[string]bool{"test-token": true},
		accounts:    map[string][]string{"test-token": {"account_A"}},
	}
	commands := visualTestCommandStore{}
	now := time.Date(2026, 6, 26, 8, 0, 0, 0, time.UTC)

	if err := accounts.UpsertAccount(ctx, domain.Account{
		AccountID: "account_A",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(ctx, domain.AccountRuntime{
		AccountID:       "account_A",
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(ctx, "account_A", "XAUUSD", domain.TickSnapshot{
		Symbol: "XAUUSD",
		Bid:    3335.55,
		Ask:    3335.75,
		Spread: 20,
		Time:   "08:00:00",
	}, now); err != nil {
		t.Fatalf("SaveTickSnapshot returned error: %v", err)
	}

	rawAI := json.RawMessage(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"alert_reason":"",
		"narrative":"top-level narrative",
		"trade_plan":{
			"decision_id":"tpv1_abc123",
			"mode":"approve",
			"side":"buy",
			"entry_zone":{"min":3330.0,"max":3334.0},
			"stop_loss":3320.0,
			"take_profit":[3360.0],
			"narrative":"trade plan narrative"
		},
		"risk_gate":{"status":"accepted"}
	}`)
	if err := accounts.SaveAIResult(ctx, "account_A", "XAUUSD", rawAI, now); err != nil {
		t.Fatalf("SaveAIResult returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
	})

	postVisualAlert(t, mux, "test-token", map[string]any{
		"id":          "xau-alert",
		"type":        "divergence",
		"indicator":   "rsi",
		"direction":   "bullish",
		"symbol":      "XAUUSD",
		"timeframe":   "H1",
		"time":        "2026-06-26T08:00:00Z",
		"price":       3335.5,
		"strength":    "strong",
		"confidence":  0.91,
		"description": "xau match",
	})
	postVisualAlert(t, mux, "test-token", map[string]any{
		"id":          "gbp-alert",
		"type":        "divergence",
		"indicator":   "rsi",
		"direction":   "bearish",
		"symbol":      "GBPJPY",
		"timeframe":   "H1",
		"time":        "2026-06-26T08:00:00Z",
		"price":       199.2,
		"strength":    "weak",
		"confidence":  0.33,
		"description": "gbp filtered out",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/visual/poll", bytes.NewBufferString(`{
		"account_id":"account_A",
		"symbol":"XAUUSD",
		"timeframe":"H1",
		"client":"mt4_visual_bridge"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /visual/poll status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Status     string `json:"status"`
		AccountID  string `json:"account_id"`
		Symbol     string `json:"symbol"`
		Timeframe  string `json:"timeframe"`
		ServerTime string `json:"server_time"`
		Tick       struct {
			Symbol string  `json:"symbol"`
			Bid    float64 `json:"bid"`
			Ask    float64 `json:"ask"`
			Spread float64 `json:"spread"`
			Time   string  `json:"time"`
		} `json:"tick"`
		AI struct {
			HasResult      bool    `json:"has_result"`
			Bias           string  `json:"bias"`
			Confidence     float64 `json:"confidence"`
			DecisionID     string  `json:"decision_id"`
			TradePlanMode  string  `json:"trade_plan_mode"`
			Side           string  `json:"side"`
			EntryMin       float64 `json:"entry_min"`
			EntryMax       float64 `json:"entry_max"`
			StopLoss       float64 `json:"stop_loss"`
			TakeProfit     float64 `json:"take_profit"`
			RiskGateStatus string  `json:"risk_gate_status"`
			Narrative      string  `json:"narrative"`
		} `json:"ai"`
		Alerts []struct {
			ID     string `json:"id"`
			Symbol string `json:"symbol"`
		} `json:"alerts"`
		Count int `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal visual response returned error: %v", err)
	}

	if body.Status != "ok" {
		t.Fatalf("status = %q, want ok", body.Status)
	}
	if body.AccountID != "account_A" {
		t.Fatalf("account_id = %q, want account_A", body.AccountID)
	}
	if body.Symbol != "XAUUSD" {
		t.Fatalf("symbol = %q, want XAUUSD", body.Symbol)
	}
	if body.Timeframe != "H1" {
		t.Fatalf("timeframe = %q, want H1", body.Timeframe)
	}
	if body.ServerTime == "" {
		t.Fatal("server_time is empty")
	}
	if !body.AI.HasResult {
		t.Fatal("ai.has_result = false, want true")
	}
	if body.AI.Bias != "bullish" {
		t.Fatalf("ai.bias = %q, want bullish", body.AI.Bias)
	}
	if body.AI.Confidence != 82 {
		t.Fatalf("ai.confidence = %v, want 82", body.AI.Confidence)
	}
	if body.AI.DecisionID != "tpv1_abc123" {
		t.Fatalf("ai.decision_id = %q, want tpv1_abc123", body.AI.DecisionID)
	}
	if body.Count != 1 {
		t.Fatalf("count = %d, want 1", body.Count)
	}
	if len(body.Alerts) != 1 {
		t.Fatalf("len(alerts) = %d, want 1", len(body.Alerts))
	}
	if body.Alerts[0].ID != "xau-alert" {
		t.Fatalf("alerts[0].id = %q, want xau-alert", body.Alerts[0].ID)
	}
	if body.Alerts[0].Symbol != "XAUUSD" {
		t.Fatalf("alerts[0].symbol = %q, want XAUUSD", body.Alerts[0].Symbol)
	}
}

func TestVisualPollRejectsUnsupportedMethod(t *testing.T) {
	handler := mustBuildVisualMux(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/visual/poll", nil)
	req.Header.Set("X-API-Token", "test-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /visual/poll status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestVisualPollRequiresAccountAndSymbol(t *testing.T) {
	handler := mustBuildVisualMux(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/visual/poll", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "test-token")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /visual/poll status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

type visualTestTokenStore struct {
	validTokens map[string]bool
	accounts    map[string][]string
	adminTokens map[string]bool
}

func (s visualTestTokenStore) Validate(_ context.Context, token string) (bool, error) {
	return s.validTokens[token], nil
}

func (s visualTestTokenStore) IsAdmin(_ context.Context, token string) (bool, error) {
	return s.adminTokens[token], nil
}

func (s visualTestTokenStore) AccountsForToken(_ context.Context, token string) ([]string, error) {
	return s.accounts[token], nil
}

func (s visualTestTokenStore) PutToken(_ context.Context, token, name string, isAdmin bool, createdAt time.Time) error {
	return nil
}

func (s visualTestTokenStore) BindAccount(_ context.Context, token, accountID string) error {
	return nil
}

func (s visualTestTokenStore) List(_ context.Context) ([]domain.TokenRecord, error) {
	return nil, nil
}

func (s visualTestTokenStore) FindByPrefix(_ context.Context, prefix string) (string, error) {
	return "", nil
}

func (s visualTestTokenStore) Delete(_ context.Context, token string) error {
	return nil
}

type visualTestCommandStore struct{}

func (visualTestCommandStore) Enqueue(_ context.Context, command domain.Command) error {
	return nil
}

func (visualTestCommandStore) FindPendingAI(_ context.Context, accountID, symbol, side string) (bool, error) {
	return false, nil
}

func mustBuildVisualMux(t *testing.T) http.Handler {
	t.Helper()

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: store.NewMemoryAccountStore(),
		Tokens: visualTestTokenStore{
			validTokens: map[string]bool{"test-token": true},
			accounts:    map[string][]string{"test-token": {"account_A"}},
		},
		Commands: visualTestCommandStore{},
		Releases: ea.NewLocalReleaseSource("."),
	})
	return mux
}

func postVisualAlert(t *testing.T, handler http.Handler, token string, payload map[string]any) {
	t.Helper()

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal alert payload returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/indicator_alert/store", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", token)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /indicator_alert/store status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}
