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
	ts, _, decisions, _ := newAIDecisionTimelineServer(t)

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
	if len(events) != 3 {
		t.Fatalf("len(events) = %d, want 3: %+v", len(events), events)
	}

	if got := events[0].DecisionID; got != "tpv1_api_timeline" {
		t.Fatalf("command decision_id = %q, want tpv1_api_timeline", got)
	}
	if got := events[0].Stage; got != domain.DecisionStageCommandEnqueued {
		t.Fatalf("command stage = %q, want %q", got, domain.DecisionStageCommandEnqueued)
	}
	if got := events[0].Status; got != domain.DecisionStatusPending {
		t.Fatalf("command status = %q, want %q", got, domain.DecisionStatusPending)
	}
	if got := events[0].RelatedCommandID; got == "" {
		t.Fatal("command related_command_id is empty, want command id")
	}
	assertDecisionEvent(t, events[2], domain.DecisionStageAIResult, domain.DecisionStatusAccepted, []string{"mode.approve", "side.buy"})
	if got := events[2].DecisionID; got != "tpv1_api_timeline" {
		t.Fatalf("ai_result decision_id = %q, want tpv1_api_timeline", got)
	}
	if got := events[2].AccountID; got != "90011087" {
		t.Fatalf("ai_result account_id = %q, want 90011087", got)
	}
	if got := events[2].Symbol; got != "XAUUSD" {
		t.Fatalf("ai_result symbol = %q, want XAUUSD", got)
	}
	if got := events[2].Summary["decision_id"]; got != "tpv1_api_timeline" {
		t.Fatalf("ai_result summary.decision_id = %v, want tpv1_api_timeline", got)
	}
	if got := events[2].Summary["mode"]; got != "approve" {
		t.Fatalf("ai_result summary.mode = %v, want approve", got)
	}

	assertDecisionEvent(t, events[1], domain.DecisionStageRiskGate, domain.DecisionStatusClamped, []string{"lots.clamped"})
	if got := events[1].DecisionID; got != "tpv1_api_timeline" {
		t.Fatalf("risk_gate decision_id = %q, want tpv1_api_timeline", got)
	}
	if got := events[1].Summary["status"]; got != "clamped" {
		t.Fatalf("risk_gate summary.status = %v, want clamped", got)
	}
}

func TestAIResultMalformedTradePlanStoresRawResultWithoutTimeline(t *testing.T) {
	ts, _, decisions, _ := newAIDecisionTimelineServer(t)

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

func TestAIApproveEnqueuesPendingCommand(t *testing.T) {
	ts, _, _, commands := newAIDecisionTimelineServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_ai_pending",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"approve",
			"side":"buy",
			"confidence":82,
			"entry_zone":{"min":3335.10,"max":3335.30},
			"stop_loss":3328.126,
			"take_profit":[3350.789],
			"max_lots":3.77,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.approve","side.buy"],
			"conflicts":[],
			"narrative":"queue pending command"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	pending, err := commands.TakePending(context.Background(), "90011087", time.Date(2026, 6, 15, 9, 1, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("TakePending returned error: %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("len(pending) = %d, want 1", len(pending))
	}

	command := pending[0]
	if command.Action != domain.CommandActionSignal {
		t.Fatalf("action = %q, want %q", command.Action, domain.CommandActionSignal)
	}
	if got := command.Payload["source"]; got != "ai_approve" {
		t.Fatalf("payload.source = %v, want ai_approve", got)
	}
	if got := command.Payload["strategy"]; got != "ai_signal" {
		t.Fatalf("payload.strategy = %v, want ai_signal", got)
	}
	if got := command.Payload["type"]; got != "BUY" {
		t.Fatalf("payload.type = %v, want BUY", got)
	}
	if got := command.Payload["order_type"]; got != "market" {
		t.Fatalf("payload.order_type = %v, want market", got)
	}
	if got := command.Payload["entry"]; got != 3335.2 {
		t.Fatalf("payload.entry = %v, want 3335.2", got)
	}
	if got := command.Payload["sl"]; got != 3328.13 {
		t.Fatalf("payload.sl = %v, want 3328.13", got)
	}
	if got := command.Payload["tp"]; got != 3350.79 {
		t.Fatalf("payload.tp = %v, want 3350.79", got)
	}
	if got := command.Payload["lots"]; got != 0.01 {
		t.Fatalf("payload.lots = %v, want 0.01", got)
	}
	if got := command.Payload["confidence"]; got != float64(82) {
		t.Fatalf("payload.confidence = %v, want 82", got)
	}
	if got := command.Payload["decision_id"]; got != "tpv1_ai_pending" {
		t.Fatalf("payload.decision_id = %v, want tpv1_ai_pending", got)
	}
	wantExpiration := float64(command.CreatedAt.Add(4 * time.Hour).Unix())
	if got := command.Payload["expiration"]; got != wantExpiration {
		t.Fatalf("payload.expiration = %v, want %v", got, wantExpiration)
	}
}

func TestAIApproveSkipsWhenSameSidePositionAlreadyOpen(t *testing.T) {
	ts, accounts, _, commands := newAIDecisionTimelineServer(t)
	now := time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC)
	if err := accounts.SavePositions(context.Background(), "90011087", "XAUUSD", []domain.Position{
		{Ticket: 1001, Symbol: "XAUUSD", Type: "BUY", Lots: 0.10, OpenPrice: 3335.10},
	}, now); err != nil {
		t.Fatalf("SavePositions returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_ai_open_position_skip",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"approve",
			"side":"buy",
			"confidence":82,
			"entry_zone":{"min":3335.10,"max":3335.30},
			"stop_loss":3328.126,
			"take_profit":[3350.789],
			"max_lots":3.77,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.approve","side.buy"],
			"conflicts":[],
			"narrative":"skip duplicate when same-side position exists"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	pending, err := commands.TakePending(context.Background(), "90011087", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("TakePending returned error: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("len(pending) = %d, want 0", len(pending))
	}
}

func TestAIApproveSkipsWithinThirtyMinuteCooldown(t *testing.T) {
	ts, _, _, commands := newAIDecisionTimelineServer(t)
	firstRequest := func(decisionID string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
			"bias":"bullish",
			"confidence":82,
			"exit_suggestion":"hold",
			"risk_alert":false,
			"trade_plan":{
				"schema_version":"trade_plan.v1",
				"decision_id":"`+decisionID+`",
				"account_id":"90011087",
				"symbol":"XAUUSD",
				"mode":"approve",
				"side":"buy",
				"confidence":82,
				"entry_zone":{"min":3335.10,"max":3335.30},
				"stop_loss":3328.126,
				"take_profit":[3350.789],
				"max_lots":3.77,
				"expires_at":"2099-06-06T09:15:00Z",
				"reason_codes":["mode.approve","side.buy"],
				"conflicts":[],
				"narrative":"cooldown duplicate prevention"
			}
		}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Token", "user-token")
		ts.ServeHTTP(rec, req)
		return rec
	}

	rec := firstRequest("tpv1_ai_cooldown_1")
	if rec.Code != http.StatusOK {
		t.Fatalf("first POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	deliveredAt := time.Date(2026, 6, 15, 9, 1, 0, 0, time.UTC)
	firstPending, err := commands.TakePending(context.Background(), "90011087", deliveredAt)
	if err != nil {
		t.Fatalf("first TakePending returned error: %v", err)
	}
	if len(firstPending) != 1 {
		t.Fatalf("len(firstPending) = %d, want 1", len(firstPending))
	}

	rec = firstRequest("tpv1_ai_cooldown_2")
	if rec.Code != http.StatusOK {
		t.Fatalf("second POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	secondPending, err := commands.TakePending(context.Background(), "90011087", deliveredAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("second TakePending returned error: %v", err)
	}
	if len(secondPending) != 0 {
		t.Fatalf("len(secondPending) = %d, want 0", len(secondPending))
	}
}

func newAIDecisionTimelineServer(t *testing.T) (http.Handler, *sqlitestore.AccountRepository, *sqlitestore.DecisionRepository, *sqlitestore.CommandRepository) {
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
	return mux, accounts, decisions, commands
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
