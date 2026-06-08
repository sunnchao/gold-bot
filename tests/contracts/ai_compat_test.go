package contracts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/domain"
	"gold-bot/internal/ea"
	"gold-bot/internal/legacy"
	"gold-bot/internal/realtime"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestAnalysisPayloadIncludesIndicatorsAndPositions(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/analysis_payload/90011087", nil)
	req.Header.Set("X-API-Token", "admin-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/analysis_payload status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status          string                    `json:"status"`
		Account         map[string]any            `json:"account"`
		Market          map[string]any            `json:"market"`
		Positions       []map[string]any          `json:"positions"`
		Indicators      map[string]map[string]any `json:"indicators"`
		Bars            map[string][]domain.Bar   `json:"bars"`
		MarketStatus    map[string]any            `json:"market_status"`
		StrategyMapping map[string]string         `json:"strategy_mapping"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal analysis payload returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want %q", body.Status, "OK")
	}
	if got := body.Account["account_id"]; got != "90011087" {
		t.Fatalf("account_id = %v, want 90011087", got)
	}
	if got := body.Market["symbol"]; got != "XAUUSD" {
		t.Fatalf("market.symbol = %v, want XAUUSD", got)
	}
	if len(body.Positions) != 1 {
		t.Fatalf("len(positions) = %d, want 1", len(body.Positions))
	}
	if got := body.Positions[0]["strategy"]; got != "pullback" {
		t.Fatalf("positions[0].strategy = %v, want pullback", got)
	}
	if body.Indicators["H1"] == nil {
		t.Fatal("indicators.H1 = nil, want indicator pack")
	}
	if got := body.Indicators["H1"]["bars_count"]; got != float64(65) {
		t.Fatalf("indicators.H1.bars_count = %v, want 65", got)
	}
	if got := len(body.Bars["H1"]); got != 65 {
		t.Fatalf("len(bars.H1) = %d, want 65", got)
	}
	if got := body.Bars["H1"][len(body.Bars["H1"])-1].Close; got == 0 {
		t.Fatalf("bars.H1 latest close = %v, want non-zero close", got)
	}
	if got := body.Bars["H1"][len(body.Bars["H1"])-1].ATR; got == 0 {
		t.Fatalf("bars.H1 latest ATR = %v, want enriched ATR", got)
	}
	if got := body.MarketStatus["tradeable"]; got != true {
		t.Fatalf("market_status.tradeable = %v, want true", got)
	}
	if got := body.StrategyMapping["20250231"]; got != "pullback" {
		t.Fatalf("strategy_mapping[20250231] = %q, want %q", got, "pullback")
	}
}

func TestAIResultQueuesRiskCommandForEA(t *testing.T) {
	ts, db := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai_result/90011087", bytes.NewBufferString(`{
		"combined_bias":"bearish",
		"confidence":87,
		"reasoning":"risk regime changed",
		"exit_suggestion":"close_all",
		"risk_alert":true,
		"alert_reason":"volatility spike"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/ai_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resultBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resultBody); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if resultBody["status"] != "OK" {
		t.Fatalf("status = %v, want OK", resultBody["status"])
	}
	if resultBody["received"] != true {
		t.Fatalf("received = %v, want true", resultBody["received"])
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(pollRec, pollReq)

	if pollRec.Code != http.StatusOK {
		t.Fatalf("POST /poll status = %d, want %d", pollRec.Code, http.StatusOK)
	}

	var pollBody struct {
		Status   string                   `json:"status"`
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}

	if pollBody.Count != 1 {
		t.Fatalf("count = %d, want 1", pollBody.Count)
	}
	if got := pollBody.Commands[0]["action"]; got != "CLOSE_ALL" {
		t.Fatalf("commands[0].action = %v, want CLOSE_ALL", got)
	}
	if got := pollBody.Commands[0]["reason"]; got != "AI风险警报(全平): volatility spike" {
		t.Fatalf("commands[0].reason = %v, want %q", got, "AI风险警报(全平): volatility spike")
	}

	if count := commandResultCount(t, db, ""); count != 0 {
		t.Fatalf("unexpected command_results count = %d", count)
	}
}

func TestAIResultQueuesTicketedCloseCommandsForShortPositions(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	positionsBody := `{
		"account_id":"90011087",
		"positions":[
			{
				"ticket":111001,
				"symbol":"XAUUSD",
				"type":"BUY",
				"lots":0.10,
				"open_price":3330.00,
				"profit":12.50
			},
			{
				"ticket":222002,
				"symbol":"XAUUSD",
				"type":"SELL",
				"lots":0.10,
				"open_price":3340.00,
				"profit":-8.00
			},
			{
				"ticket":333003,
				"symbol":"XAUUSD",
				"type":"SELL",
				"lots":0.20,
				"open_price":3345.00,
				"profit":-15.00
			}
		]
	}`
	postJSON(t, ts, "user-token", "/positions", positionsBody)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai_result/90011087", bytes.NewBufferString(`{
		"combined_bias":"bullish",
		"confidence":84,
		"reasoning":"short exposure invalidated",
		"exit_suggestion":"close_short",
		"risk_alert":true,
		"alert_reason":"多周期强bullish共振"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/ai_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(pollRec, pollReq)

	if pollRec.Code != http.StatusOK {
		t.Fatalf("POST /poll status = %d, want %d", pollRec.Code, http.StatusOK)
	}

	var pollBody struct {
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Count != 2 {
		t.Fatalf("count = %d, want 2", pollBody.Count)
	}

	gotTickets := map[int]bool{}
	for i, command := range pollBody.Commands {
		if got := command["action"]; got != "CLOSE" {
			t.Fatalf("commands[%d].action = %v, want CLOSE", i, got)
		}
		if got := command["reason"]; got != "AI风险警报(平空): 多周期强bullish共振" {
			t.Fatalf("commands[%d].reason = %v, want %q", i, got, "AI风险警报(平空): 多周期强bullish共振")
		}
		ticket, ok := command["ticket"].(float64)
		if !ok {
			t.Fatalf("commands[%d].ticket type = %T, want float64 JSON number", i, command["ticket"])
		}
		if ticket == 0 {
			t.Fatalf("commands[%d].ticket = 0, want real position ticket", i)
		}
		gotTickets[int(ticket)] = true
	}

	if !gotTickets[222002] || !gotTickets[333003] {
		t.Fatalf("queued tickets = %v, want tickets 222002 and 333003", gotTickets)
	}
	if gotTickets[111001] {
		t.Fatalf("queued tickets unexpectedly contained BUY ticket 111001: %v", gotTickets)
	}
}

func TestAIResultSkipsCloseShortWhenNoShortPositions(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai_result/90011087", bytes.NewBufferString(`{
		"combined_bias":"bullish",
		"confidence":84,
		"reasoning":"short exposure invalidated",
		"exit_suggestion":"close_short",
		"risk_alert":true,
		"alert_reason":"多周期强bullish共振"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/ai_result status = %d, want %d", rec.Code, http.StatusOK)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(pollRec, pollReq)

	if pollRec.Code != http.StatusOK {
		t.Fatalf("POST /poll status = %d, want %d", pollRec.Code, http.StatusOK)
	}

	var pollBody struct {
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Count != 0 {
		t.Fatalf("count = %d, want 0 when no short positions exist", pollBody.Count)
	}
	if len(pollBody.Commands) != 0 {
		t.Fatalf("len(commands) = %d, want 0", len(pollBody.Commands))
	}
}

func TestAIResultAcceptsTradePlanAndPublishesDecisionSummary(t *testing.T) {
	ts, db, hub := newAdminServerWithEvents(t)
	seedAnalysisFixture(t, ts, "user-token")

	events := hub.Subscribe()
	defer hub.Unsubscribe(events)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_abc123",
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
			"reason_codes":["mode.approve","side.buy"],
			"conflicts":[],
			"narrative":"多周期看多，等待 Go 风控确认"
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
		Decision            map[string]any `json:"decision"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if response.Status != "OK" {
		t.Fatalf("status = %q, want OK", response.Status)
	}
	if got := response.TradePlanValidation["valid"]; got != true {
		t.Fatalf("trade_plan_validation.valid = %v, want true", got)
	}
	if got := response.Decision["decision_id"]; got != "tpv1_abc123" {
		t.Fatalf("decision.decision_id = %v, want tpv1_abc123", got)
	}
	if got := response.Decision["mode"]; got != "approve" {
		t.Fatalf("decision.mode = %v, want approve", got)
	}
	if got := response.Decision["symbol"]; got != "XAUUSD" {
		t.Fatalf("decision.symbol = %v, want XAUUSD", got)
	}
	if got := response.Decision["confidence"]; got != float64(82) {
		t.Fatalf("decision.confidence = %v, want 82", got)
	}

	event := readEvent(t, events)
	if event.EventType != "ai_result" {
		t.Fatalf("event_type = %q, want ai_result", event.EventType)
	}
	var eventPayload struct {
		TradePlanSummary map[string]any `json:"trade_plan_summary"`
	}
	if err := json.Unmarshal(event.Payload, &eventPayload); err != nil {
		t.Fatalf("Unmarshal SSE payload returned error: %v", err)
	}
	if got := eventPayload.TradePlanSummary["decision_id"]; got != "tpv1_abc123" {
		t.Fatalf("event.trade_plan_summary.decision_id = %v, want tpv1_abc123", got)
	}
	if got := eventPayload.TradePlanSummary["mode"]; got != "approve" {
		t.Fatalf("event.trade_plan_summary.mode = %v, want approve", got)
	}

	state := fetchState(t, db, "90011087", "XAUUSD")
	if got := state["trade_plan"].(map[string]any)["decision_id"]; got != "tpv1_abc123" {
		t.Fatalf("stored ai_result.trade_plan.decision_id = %v, want tpv1_abc123", got)
	}
}

func TestAIResultApproveTradePlanReturnsAuditOnlyRiskGate(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")
	postJSON(t, ts, "user-token", "/positions", `{
		"account_id":"90011087",
		"positions":[]
	}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bullish",
		"confidence":82,
		"exit_suggestion":"hold",
		"risk_alert":false,
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_audit_only",
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
			"reason_codes":["mode.approve","side.buy"],
			"conflicts":[],
			"narrative":"多周期看多，等待 Go 风控确认"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response struct {
		RiskGate map[string]any `json:"risk_gate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if got := response.RiskGate["status"]; got != "accepted" {
		t.Fatalf("risk_gate.status = %v, want accepted", got)
	}
	if got := response.RiskGate["audit_only"]; got != true {
		t.Fatalf("risk_gate.audit_only = %v, want true", got)
	}
	if got := response.RiskGate["decision_id"]; got != "tpv1_audit_only" {
		t.Fatalf("risk_gate.decision_id = %v, want tpv1_audit_only", got)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(pollRec, pollReq)

	var pollBody struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Count != 0 {
		t.Fatalf("poll count = %d, want 0 for audit-only approve", pollBody.Count)
	}
}

func TestAIResultRiskCommandIncludesTradePlanDecisionID(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bearish",
		"confidence":87,
		"reasoning":"risk regime changed",
		"exit_suggestion":"close_all",
		"risk_alert":true,
		"alert_reason":"volatility spike",
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_close_all",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"close",
			"side":"buy",
			"confidence":87,
			"entry_zone":{"min":3335.55,"max":3335.75},
			"stop_loss":3328.0,
			"take_profit":[3350.0],
			"max_lots":0.1,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.close","risk.high"],
			"conflicts":[],
			"narrative":"AI requests full close after risk spike"
		}
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", "user-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/v2/ai_result status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response struct {
		RiskGate map[string]any `json:"risk_gate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal AI result response returned error: %v", err)
	}
	if got := response.RiskGate["status"]; got != "accepted" {
		t.Fatalf("risk_gate.status = %v, want accepted", got)
	}
	if got := response.RiskGate["audit_only"]; got != false {
		t.Fatalf("risk_gate.audit_only = %v, want false for close command", got)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(pollRec, pollReq)

	var pollBody struct {
		Count    int                      `json:"count"`
		Commands []map[string]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Count != 1 {
		t.Fatalf("poll count = %d, want 1", pollBody.Count)
	}
	command := pollBody.Commands[0]
	if got := command["action"]; got != "CLOSE_ALL" {
		t.Fatalf("command.action = %v, want CLOSE_ALL", got)
	}
	if got := command["decision_id"]; got != "tpv1_close_all" {
		t.Fatalf("command.decision_id = %v, want tpv1_close_all", got)
	}
	riskGate, ok := command["risk_gate"].(map[string]any)
	if !ok {
		t.Fatalf("command.risk_gate type = %T, want object", command["risk_gate"])
	}
	if got := riskGate["status"]; got != "accepted" {
		t.Fatalf("command.risk_gate.status = %v, want accepted", got)
	}
}

func TestAIResultRiskGateRejectsExecutableCommandBeforeEnqueue(t *testing.T) {
	ts, _ := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")
	postJSON(t, ts, "user-token", "/tick", `{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"bid":3335.55,
		"ask":3335.75,
		"spread":8.1,
		"time":"08:01:00"
	}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/ai_result/90011087/XAUUSD", bytes.NewBufferString(`{
		"bias":"bearish",
		"confidence":87,
		"reasoning":"risk regime changed",
		"exit_suggestion":"close_all",
		"risk_alert":true,
		"alert_reason":"volatility spike",
		"trade_plan":{
			"schema_version":"trade_plan.v1",
			"decision_id":"tpv1_rejected_spread",
			"account_id":"90011087",
			"symbol":"XAUUSD",
			"mode":"close",
			"side":"buy",
			"confidence":87,
			"entry_zone":{"min":3335.55,"max":3335.75},
			"stop_loss":3328.0,
			"take_profit":[3350.0],
			"max_lots":0.1,
			"expires_at":"2099-06-06T09:15:00Z",
			"reason_codes":["mode.close","risk.high"],
			"conflicts":[],
			"narrative":"AI requests full close after risk spike"
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
	if response.RiskGate.Status != "rejected" {
		t.Fatalf("risk_gate.status = %q, want rejected", response.RiskGate.Status)
	}
	if !containsString(response.RiskGate.ReasonCodes, "spread.too_wide") {
		t.Fatalf("risk_gate.reason_codes = %v, want spread.too_wide", response.RiskGate.ReasonCodes)
	}

	pollRec := httptest.NewRecorder()
	pollReq := httptest.NewRequest(http.MethodPost, "/poll", bytes.NewBufferString(`{"account_id":"90011087"}`))
	pollReq.Header.Set("Content-Type", "application/json")
	pollReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(pollRec, pollReq)

	var pollBody struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollBody); err != nil {
		t.Fatalf("Unmarshal poll response returned error: %v", err)
	}
	if pollBody.Count != 0 {
		t.Fatalf("poll count = %d, want 0 after risk gate rejection", pollBody.Count)
	}
}

func TestAIResultStoresMalformedTradePlanAndReturnsValidationResult(t *testing.T) {
	ts, db := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

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
			"entry_zone":{"min":0,"max":0},
			"stop_loss":0,
			"take_profit":[],
			"max_lots":0,
			"expires_at":"not-a-time",
			"reason_codes":[],
			"conflicts":[],
			"narrative":"invalid"
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
	if got := response.TradePlanValidation["error"]; got == "" || got == nil {
		t.Fatalf("trade_plan_validation.error = %v, want clear validation message", got)
	}

	state := fetchState(t, db, "90011087", "XAUUSD")
	tradePlan := state["trade_plan"].(map[string]any)
	if got := tradePlan["schema_version"]; got != "trade_plan.v1" {
		t.Fatalf("stored raw trade_plan.schema_version = %v, want trade_plan.v1", got)
	}
	if got := tradePlan["decision_id"]; got != "" {
		t.Fatalf("stored raw trade_plan.decision_id = %v, want empty raw value", got)
	}
}

func newAdminServer(t *testing.T) (http.Handler, *sql.DB) {
	ts, db, _ := newAdminServerInternal(t, nil)
	return ts, db
}

func newAdminServerWithEvents(t *testing.T) (http.Handler, *sql.DB, *realtime.Hub) {
	hub := realtime.NewHub()
	return newAdminServerInternal(t, hub)
}

func newAdminServerInternal(t *testing.T, events *realtime.Hub) (http.Handler, *sql.DB, *realtime.Hub) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "contracts-admin.sqlite")
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
	now := time.Now().UTC()
	if err := tokens.PutToken(context.Background(), "admin-token", "admin", true, now); err != nil {
		t.Fatalf("PutToken(admin) returned error: %v", err)
	}
	if err := tokens.PutToken(context.Background(), "user-token", "user", false, now); err != nil {
		t.Fatalf("PutToken(user) returned error: %v", err)
	}

	mux := http.NewServeMux()
	legacy.RegisterRoutes(mux, legacy.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
	})
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
		Events:   events,
	})
	return mux, db, events
}

func seedAnalysisFixture(t *testing.T, ts http.Handler, token string) {
	t.Helper()

	snapshot := loadReplaySnapshotFixture(t)

	registerBody := `{
		"account_id":"90011087",
		"broker":"Demo Broker",
		"server_name":"Demo-1",
		"account_name":"Primary",
		"account_type":"demo",
		"currency":"USD",
		"leverage":500,
		"strategy_mapping":{"20250231":"pullback","20250232":"breakout_retest"}
	}`
	postJSON(t, ts, token, "/register", registerBody)

	heartbeatBody := `{
		"account_id":"90011087",
		"balance":1000.5,
		"equity":1100.25,
		"margin":100,
		"free_margin":1000.25,
		"server_time":"2026.04.13 08:00",
		"market_open":true,
		"is_trade_allowed":true
	}`
	postJSON(t, ts, token, "/heartbeat", heartbeatBody)

	tickBody := `{
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"bid":3335.55,
		"ask":3335.75,
		"spread":0.2,
		"time":"08:00:00"
	}`
	postJSON(t, ts, token, "/tick", tickBody)

	for _, timeframe := range []string{"H1", "H4", "M30", "M15"} {
		bodyBytes, err := json.Marshal(map[string]any{
			"account_id": "90011087",
			"timeframe":  timeframe,
			"bars":       snapshot.Bars[timeframe],
		})
		if err != nil {
			t.Fatalf("Marshal bars(%s) returned error: %v", timeframe, err)
		}
		postJSON(t, ts, token, "/bars", string(bodyBytes))
	}

	positionsBody := `{
		"account_id":"90011087",
		"positions":[{
			"ticket":123456,
			"symbol":"XAUUSD",
			"type":"BUY",
			"lots":0.10,
			"open_price":3330.00,
			"sl":3320.00,
			"tp":3355.00,
			"profit":57.50,
			"open_time":1712900000,
			"comment":"GB_pullback_S7",
			"magic":20250231
		}]
	}`
	postJSON(t, ts, token, "/positions", positionsBody)
}

func loadReplaySnapshotFixture(t *testing.T) schedulerSnapshotFixture {
	t.Helper()

	path := filepath.Join("..", "replay", "testdata", "account_90011087_snapshot.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) returned error: %v", path, err)
	}

	var snapshot schedulerSnapshotFixture
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("Unmarshal(%s) returned error: %v", path, err)
	}
	return snapshot
}

type schedulerSnapshotFixture struct {
	Bars map[string][]domain.Bar `json:"bars"`
}

func postJSON(t *testing.T, ts http.Handler, token, path, body string) {
	t.Helper()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", token)
	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST %s status = %d, want %d body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
	}
}

func readEvent(t *testing.T, events <-chan domain.Event) domain.Event {
	t.Helper()

	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for realtime event")
		return domain.Event{}
	}
}

func fetchState(t *testing.T, db *sql.DB, accountID, symbol string) map[string]any {
	t.Helper()

	repo := sqlitestore.NewAccountRepository(db)
	state, err := repo.GetStateSymbol(context.Background(), accountID, symbol)
	if err != nil {
		t.Fatalf("GetStateSymbol returned error: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(state.AIResultJSON, &body); err != nil {
		t.Fatalf("Unmarshal stored AIResultJSON returned error: %v", err)
	}
	return body
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
