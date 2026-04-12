package legacy

import (
	"encoding/json"
	"net/http"
	"time"
)

type BarsHandler struct {
	accounts AccountStore
	now      func() time.Time
}

type BarsRequest struct {
	AccountID string            `json:"account_id"`
	Timeframe string            `json:"timeframe"`
	Bars      []json.RawMessage `json:"bars"`
}

func (h *BarsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req BarsRequest
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
	if err := h.accounts.EnsureAccount(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if err := h.accounts.TouchRuntime(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "OK",
		"received": len(req.Bars),
	})
}
