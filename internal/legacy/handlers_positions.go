package legacy

import (
	"encoding/json"
	"net/http"
	"time"
)

type PositionsHandler struct {
	accounts AccountStore
	now      func() time.Time
}

type PositionsRequest struct {
	AccountID string            `json:"account_id"`
	Positions []json.RawMessage `json:"positions"`
}

func (h *PositionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req PositionsRequest
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
		"status": "OK",
		"count":  len(req.Positions),
	})
}
