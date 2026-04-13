package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gold-bot/internal/integration/aurex"
	"gold-bot/internal/scheduler"
)

type accountsHandler struct {
	deps Dependencies
	now  func() time.Time
}

type overviewCard struct {
	Title  string `json:"title"`
	Value  string `json:"value"`
	Detail string `json:"detail"`
	Tone   string `json:"tone"`
}

type overviewAccount struct {
	AccountID      string  `json:"account_id"`
	Broker         string  `json:"broker"`
	ServerName     string  `json:"server_name"`
	Connected      bool    `json:"connected"`
	Balance        float64 `json:"balance"`
	Equity         float64 `json:"equity"`
	Positions      int     `json:"positions"`
	MarketOpen     bool    `json:"market_open"`
	IsTradeAllowed bool    `json:"is_trade_allowed"`
}

func (h accountsHandler) overview(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.collectAccounts(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	cutoverCard, err := h.buildCutoverCard(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	connected := 0
	tradeable := 0
	for _, account := range accounts {
		if account.Connected {
			connected++
		}
		if account.MarketOpen && account.IsTradeAllowed {
			tradeable++
		}
	}

	cards := []overviewCard{
		{Title: "System Health", Value: "Healthy", Detail: "SQLite + Go API online", Tone: "green"},
		{Title: "Connected Accounts", Value: itoa(connected), Detail: "active terminals reporting", Tone: "amber"},
		{Title: "Tradeable Accounts", Value: itoa(tradeable), Detail: "market open and trading allowed", Tone: "blue"},
		cutoverCard,
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "OK",
		"generated_at": h.now().UTC().Format(time.RFC3339),
		"cards":        cards,
		"accounts":     accounts,
	})
}

func (h accountsHandler) buildCutoverCard(r *http.Request) (overviewCard, error) {
	defaultCard := overviewCard{
		Title:  "Cutover Health",
		Value:  "Baseline Only",
		Detail: "Replay validated, shadow diff pending",
		Tone:   "orange",
	}
	if h.deps.Cutover == nil {
		return defaultCard, nil
	}

	report, err := h.deps.Cutover.BuildReport(r.Context())
	if err != nil {
		return overviewCard{}, err
	}
	return cutoverOverviewCard(report), nil
}

func (h accountsHandler) list(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.collectAccounts(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "accounts": accounts})
}

func (h accountsHandler) detail(w http.ResponseWriter, r *http.Request) {
	accountID, ok := accountIDFromPath(r.URL.Path, "/api/v1/accounts/")
	if !ok {
		http.NotFound(w, r)
		return
	}

	account, err := h.deps.Accounts.GetAccount(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	runtime, err := h.deps.Accounts.GetRuntime(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	state, err := h.deps.Accounts.GetState(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	payload := aurex.BuildAnalysisPayload(account, runtime, state, h.now().UTC())
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "OK",
		"account":    payload.Account,
		"market":     payload.Market,
		"positions":  payload.Positions,
		"indicators": payload.Indicators,
		"ai_result":  jsonRaw(state.AIResultJSON),
	})
}

func (h accountsHandler) collectAccounts(r *http.Request) ([]overviewAccount, error) {
	records, err := h.deps.Accounts.ListAccounts(r.Context())
	if err != nil {
		return nil, err
	}

	items := make([]overviewAccount, 0, len(records))
	for _, account := range records {
		runtime, err := h.deps.Accounts.GetRuntime(r.Context(), account.AccountID)
		if err != nil && !isNotFound(err) {
			return nil, err
		}
		state, err := h.deps.Accounts.GetState(r.Context(), account.AccountID)
		if err != nil {
			return nil, err
		}
		items = append(items, overviewAccount{
			AccountID:      account.AccountID,
			Broker:         account.Broker,
			ServerName:     account.ServerName,
			Connected:      runtime.Connected,
			Balance:        runtime.Balance,
			Equity:         runtime.Equity,
			Positions:      len(state.Positions),
			MarketOpen:     runtime.MarketOpen,
			IsTradeAllowed: runtime.IsTradeAllowed,
		})
	}
	return items, nil
}

func itoa(value int) string {
	return fmt.Sprintf("%d", value)
}

func cutoverOverviewCard(report scheduler.CutoverReport) overviewCard {
	card := overviewCard{
		Title:  "Cutover Health",
		Value:  "Pending",
		Detail: "Readiness checks waiting for more evidence",
		Tone:   "amber",
	}
	if report.Ready {
		card.Value = "Ready"
		card.Detail = fmt.Sprintf("Protocol %s | signal %s | command %s", formatRatePercent(report.ProtocolErrorRate), formatRatePercent(report.SignalDriftRate), formatRatePercent(report.CommandDriftRate))
		card.Tone = "green"
		return card
	}
	if report.LastShadowEventAt.IsZero() && report.ProtocolErrorRate == 0 && report.SignalDriftRate == 0 && report.CommandDriftRate == 0 {
		card.Value = "Baseline Only"
		card.Detail = "Replay validated, shadow diff pending"
		card.Tone = "orange"
		return card
	}
	if report.ProtocolErrorRate > 0 || report.SignalDriftRate > 0.02 || report.CommandDriftRate > 0.02 {
		card.Value = "Blocked"
		card.Detail = fmt.Sprintf("Protocol %s | signal %s | command %s", formatRatePercent(report.ProtocolErrorRate), formatRatePercent(report.SignalDriftRate), formatRatePercent(report.CommandDriftRate))
		card.Tone = "red"
		return card
	}
	if len(report.MissingCapabilities) > 0 {
		card.Detail = "Missing: " + strings.Join(report.MissingCapabilities, ", ")
	}
	return card
}

func jsonRaw(value []byte) any {
	if len(value) == 0 {
		return map[string]any{}
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return map[string]any{}
	}
	return decoded
}

func formatRatePercent(rate float64) string {
	return fmt.Sprintf("%.2f%%", rate*100)
}
