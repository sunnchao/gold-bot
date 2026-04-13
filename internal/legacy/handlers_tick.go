package legacy

import (
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type TickHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type TickRequest struct {
	AccountID string  `json:"account_id"`
	Symbol    string  `json:"symbol"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	Spread    float64 `json:"spread"`
	Time      string  `json:"time"`
}

func (h *TickHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req TickRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeBadRequest(w, "invalid JSON")
		return
	}

	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	allowed, err := authorizeAccountWrite(r, h.tokens, accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"status":  "ERROR",
			"message": "token not authorized for account",
		})
		return
	}
	if err := h.accounts.EnsureAccount(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if err := h.accounts.SaveTick(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if err := h.accounts.SaveTickSnapshot(r.Context(), accountID, domain.TickSnapshot{
		Symbol: req.Symbol,
		Bid:    req.Bid,
		Ask:    req.Ask,
		Spread: req.Spread,
		Time:   req.Time,
	}, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "OK"})
}
