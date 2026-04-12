package legacy

import (
	"encoding/json"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type HeartbeatHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type HeartbeatRequest struct {
	AccountID      string  `json:"account_id"`
	Balance        float64 `json:"balance"`
	Equity         float64 `json:"equity"`
	Margin         float64 `json:"margin"`
	FreeMargin     float64 `json:"free_margin"`
	ServerTime     string  `json:"server_time"`
	MarketOpen     *bool   `json:"market_open"`
	IsTradeAllowed *bool   `json:"is_trade_allowed"`
}

func (h *HeartbeatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req HeartbeatRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	now := h.now().UTC()
	accountID := defaultAccountID(req.AccountID)
	if err := h.accounts.EnsureAccount(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if err := h.tokens.BindAccount(r.Context(), tokenFromContext(r.Context()), accountID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	if err := h.accounts.SaveHeartbeat(r.Context(), domain.AccountRuntime{
		AccountID:       accountID,
		Connected:       true,
		Balance:         req.Balance,
		Equity:          req.Equity,
		Margin:          req.Margin,
		FreeMargin:      req.FreeMargin,
		MarketOpen:      boolWithDefault(req.MarketOpen, true),
		IsTradeAllowed:  boolWithDefault(req.IsTradeAllowed, true),
		MT4ServerTime:   req.ServerTime,
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "OK",
		"server_time": now.Unix(),
	})
}

func boolWithDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}

	return *value
}
