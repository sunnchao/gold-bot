package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type visualHandler struct {
	accounts AccountStore
	tokens   TokenStore
	alerts   *AlertCache
	now      func() time.Time
}

type visualPollRequest struct {
	AccountID string `json:"account_id"`
	Symbol    string `json:"symbol"`
	Timeframe string `json:"timeframe"`
	Client    string `json:"client"`
}

type visualPollResponse struct {
	Status     string            `json:"status"`
	AccountID  string            `json:"account_id"`
	Symbol     string            `json:"symbol"`
	Timeframe  string            `json:"timeframe"`
	ServerTime string            `json:"server_time"`
	Tick       visualTickSummary `json:"tick"`
	AI         visualAISummary   `json:"ai"`
	Alerts     []IndicatorAlert  `json:"alerts"`
	Count      int               `json:"count"`
}

type visualTickSummary struct {
	Symbol string  `json:"symbol"`
	Bid    float64 `json:"bid"`
	Ask    float64 `json:"ask"`
	Spread float64 `json:"spread"`
	Time   string  `json:"time"`
}

type visualAISummary struct {
	HasResult      bool    `json:"has_result"`
	Bias           string  `json:"bias"`
	Confidence     float64 `json:"confidence"`
	ExitSuggestion string  `json:"exit_suggestion"`
	RiskAlert      bool    `json:"risk_alert"`
	AlertReason    string  `json:"alert_reason"`
	DecisionID     string  `json:"decision_id"`
	TradePlanMode  string  `json:"trade_plan_mode"`
	Side           string  `json:"side"`
	EntryMin       float64 `json:"entry_min"`
	EntryMax       float64 `json:"entry_max"`
	StopLoss       float64 `json:"stop_loss"`
	TakeProfit     float64 `json:"take_profit"`
	RiskGateStatus string  `json:"risk_gate_status"`
	Narrative      string  `json:"narrative"`
}

func newVisualHandler(accounts AccountStore, tokens TokenStore, alerts *AlertCache) visualHandler {
	return visualHandler{
		accounts: accounts,
		tokens:   tokens,
		alerts:   alerts,
		now:      time.Now,
	}
}

func (h visualHandler) poll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": "ERROR", "message": "method not allowed"})
		return
	}

	var req visualPollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid json"})
		return
	}

	req.AccountID = strings.TrimSpace(req.AccountID)
	req.Symbol = strings.TrimSpace(req.Symbol)
	req.Timeframe = strings.TrimSpace(req.Timeframe)
	if req.AccountID == "" || req.Symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "account_id and symbol are required"})
		return
	}

	allowed, err := authorizeAccount(r.Context(), h.tokens, tokenFromContext(r.Context()), req.AccountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "forbidden"})
		return
	}

	state, err := h.accounts.GetStateSymbol(r.Context(), req.AccountID, req.Symbol)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	alerts := filterVisualAlerts(h.alerts.GetRecent(), req.Symbol, req.Timeframe)
	ai := parseVisualAISummary(state.AIResultJSON)
	tickSymbol := state.Tick.Symbol
	if strings.TrimSpace(tickSymbol) == "" {
		tickSymbol = req.Symbol
	}

	writeJSON(w, http.StatusOK, visualPollResponse{
		Status:     "ok",
		AccountID:  req.AccountID,
		Symbol:     req.Symbol,
		Timeframe:  req.Timeframe,
		ServerTime: h.now().UTC().Format(time.RFC3339),
		Tick: visualTickSummary{
			Symbol: tickSymbol,
			Bid:    state.Tick.Bid,
			Ask:    state.Tick.Ask,
			Spread: state.Tick.Spread,
			Time:   state.Tick.Time,
		},
		AI:     ai,
		Alerts: alerts,
		Count:  len(alerts),
	})
}

func filterVisualAlerts(alerts []IndicatorAlert, symbol, timeframe string) []IndicatorAlert {
	filtered := make([]IndicatorAlert, 0, len(alerts))
	for _, alert := range alerts {
		if !visualAlertMatches(alert.Symbol, symbol) {
			continue
		}
		if !visualAlertMatches(alert.Timeframe, timeframe) {
			continue
		}
		filtered = append(filtered, alert)
	}
	return filtered
}

func visualAlertMatches(alertValue, requestValue string) bool {
	if strings.TrimSpace(alertValue) == "" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(alertValue), strings.TrimSpace(requestValue))
}

func parseVisualAISummary(raw json.RawMessage) visualAISummary {
	if len(raw) == 0 {
		return visualAISummary{}
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil || len(payload) == 0 {
		return visualAISummary{}
	}

	var summary visualAISummary
	summary.Bias = visualAsString(payload["bias"])
	summary.Confidence = visualAsFloat64(payload["confidence"])
	summary.ExitSuggestion = visualAsString(payload["exit_suggestion"])
	summary.RiskAlert = visualAsBool(payload["risk_alert"])
	summary.AlertReason = visualAsString(payload["alert_reason"])
	summary.Narrative = visualAsString(payload["narrative"])

	if tradePlan := visualAsMap(payload["trade_plan"]); len(tradePlan) > 0 {
		summary.DecisionID = visualAsString(tradePlan["decision_id"])
		summary.TradePlanMode = visualAsString(tradePlan["mode"])
		summary.Side = visualAsString(tradePlan["side"])
		if entryZone := visualAsMap(tradePlan["entry_zone"]); len(entryZone) > 0 {
			summary.EntryMin = visualAsFloat64(entryZone["min"])
			summary.EntryMax = visualAsFloat64(entryZone["max"])
		}
		summary.StopLoss = visualAsFloat64(tradePlan["stop_loss"])
		summary.TakeProfit = visualFirstPositiveFloat(visualAsSlice(tradePlan["take_profit"]))
		if narrative := visualAsString(tradePlan["narrative"]); narrative != "" {
			summary.Narrative = narrative
		}
	}

	if riskGate := visualAsMap(payload["risk_gate"]); len(riskGate) > 0 {
		summary.RiskGateStatus = visualAsString(riskGate["status"])
	}

	summary.HasResult = visualSummaryHasResult(summary)
	return summary
}

func visualSummaryHasResult(summary visualAISummary) bool {
	return summary.Bias != "" ||
		summary.Confidence > 0 ||
		summary.ExitSuggestion != "" ||
		summary.RiskAlert ||
		summary.AlertReason != "" ||
		summary.DecisionID != "" ||
		summary.TradePlanMode != "" ||
		summary.Side != "" ||
		summary.EntryMin > 0 ||
		summary.EntryMax > 0 ||
		summary.StopLoss > 0 ||
		summary.TakeProfit > 0 ||
		summary.RiskGateStatus != "" ||
		summary.Narrative != ""
}

func visualAsMap(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func visualAsFloat64(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func visualAsBool(value any) bool {
	result, _ := value.(bool)
	return result
}

func visualAsSlice(value any) []any {
	result, _ := value.([]any)
	return result
}

func visualFirstPositiveFloat(values []any) float64 {
	for _, value := range values {
		if candidate := visualAsFloat64(value); candidate > 0 {
			return candidate
		}
	}
	return 0
}

func visualAsString(value any) string {
	text, _ := value.(string)
	return text
}
