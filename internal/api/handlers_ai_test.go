package api_test

import (
	"bytes"
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

func TestAIResultDecisionTimelineRecordsAIResultAndRiskGate(t *testing.T) {
	ts, decisions := newAIDecisionTimelineServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_api_timeline",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"approve",
			"side":"buy",
			"confidence":82,
			"entry_zone":{"min":3335.55,"max":3335.75},
			"stop_loss":3328.0,
			"take_profit":[3350.0],
			"max_lots":3.77,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.approve","side.buy"],
			"conflicts":[],
			"narrative":"valid plan for timeline persistence"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response struct {
		RiskGate struct {
			Status      string   `json:"status"`
			ReasonCodes []string `json:"reason_codes"`
		} `json:"risk_gate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if response.RiskGate.Status != "clamped" {
		t.Fatalf("risk_gate.status = %q, want clamped", response.RiskGate.Status)
	}
	if !containsString(response.RiskGate.ReasonCodes, "lots.clamped") {
		t.Fatalf("risk_gate.reason_codes = %v, want lots.clamped", response.RiskGate.ReasonCodes)
	}

	events, err := decisions.List(context.Background(), domain.DecisionEventFilter{
		AccountID: "90011087",
		Symbol:    "XAUUSD",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("List decisions returned error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("len(events) = %d, want 2: %+v", len(events), events)
	}

	assertDecisionEvent(t, events[1], domain.DecisionStageAIResult, domain.DecisionStatusAccepted, []string{"mode.approve", "side.buy"})
	if got := events[1].DecisionID; got != "tpv1_api_timeline" {
		t.Fatalf("ai_result decision_id = %q, want tpv1_api_timeline", got)
	}
	if got := events[1].AccountID; got != "90011087" {
		t.Fatalf("ai_result account_id = %q, want 90011087", got)
	}
	if got := events[1].Symbol; got != "XAUUSD" {
		t.Fatalf("ai_result symbol = %q, want XAUUSD", got)
	}
	if got := events[1].Summary["decision_id"]; got != "tpv1_api_timeline" {
		t.Fatalf("ai_result summary.decision_id = %v, want tpv1_api_timeline", got)
	}
	if got := events[1].Summary["mode"]; got != "approve" {
		t.Fatalf("ai_result summary.mode = %v, want approve", got)
	}

	assertDecisionEvent(t, events[0], domain.DecisionStageRiskGate, domain.DecisionStatusClamped, []string{"lots.clamped"})
	if got := events[0].DecisionID; got != "tpv1_api_timeline" {
		t.Fatalf("risk_gate decision_id = %q, want tpv1_api_timeline", got)
	}
	if got := events[0].Summary["status"]; got != "clamped" {
		t.Fatalf("risk_gate summary.status = %v, want clamped", got)
	}
}

func TestAIResultMalformedTradePlanStoresRawResultWithoutTimeline(t *testing.T) {
	ts, decisions := newAIDecisionTimelineServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"approve",
			"side":"buy",
			"confidence":82,
			"entry_zone":{"min":3335.55,"max":3335.75},
			"stop_loss":3328.0,
			"take_profit":[3350.0],
			"max_lots":0.02,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.approve"],
			"conflicts":[],
			"narrative":"invalid because decision id is empty"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response struct {
		Status              string         `json:"status"`
		TradePlanValidation map[string]any `json:"trade_plan_validation"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if response.Status != "OK" {
		t.Fatalf("status = %q, want OK", response.Status)
	}
	if got := response.TradePlanValidation["valid"]; got != false {
		t.Fatalf("trade_plan_validation.valid = %v, want false", got)
	}
	if got := response.TradePlanValidation["error"]; got == nil || got == "" {
		t.Fatalf("trade_plan_validation.error = %v, want clear validation error", got)
	}

	events, err := decisions.List(context.Background(), domain.DecisionEventFilter{
		AccountID: "90011087",
		Symbol:    "XAUUSD",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("List decisions returned error: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("len(events) = %d, want 0 for malformed trade_plan: %+v", len(events), events)
	}
}

func newAIDecisionTimelineServer(t *testing.T) (http.Handler, *sqlitestore.DecisionRepository) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "api-ai-decisions.sqlite")
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

	ctx := context.Background()
	now := time.Now().UTC()
	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	decisions := sqlitestore.NewDecisionRepository(db)
	commands := sqlitestore.NewCommandRepositoryWithDecisions(db, decisions)

	if err := tokens.PutToken(ctx, "user-token", "user", false, now); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	if err := tokens.BindAccount(ctx, "user-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	if err := accounts.UpsertAccount(ctx, domain.Account{
		AccountID: "90011087",
		Leverage:  500,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(ctx, domain.AccountRuntime{
		AccountID:       "90011087",
		Equity:          1100.25,
		FreeMargin:      1000.25,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
	if err := accounts.SaveTick(ctx, "90011087", now); err != nil {
		t.Fatalf("SaveTick returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(ctx, "90011087", "XAUUSD", domain.TickSnapshot{
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
		Accounts:  accounts,
		Tokens:    tokens,
		Commands:  commands,
		Decisions: decisions,
		Releases:  ea.NewLocalReleaseSource("."),
	})
	return mux, decisions
}

func assertDecisionEvent(t *testing.T, got domain.DecisionEvent, stage domain.DecisionStage, status domain.DecisionStatus, reasonCodes []string) {
	t.Helper()

	if got.Stage != stage {
		t.Fatalf("stage = %q, want %q", got.Stage, stage)
	}
	if got.Status != status {
		t.Fatalf("status = %q, want %q", got.Status, status)
	}
	for _, code := range reasonCodes {
		if !containsString(got.ReasonCodes, code) {
			t.Fatalf("reason_codes = %v, want %q", got.ReasonCodes, code)
		}
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
