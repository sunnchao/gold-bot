package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"gold-bot/internal/domain"
)

type arbitrationHandler struct {
	deps Dependencies
	now  func() time.Time
}

// getPendingSignals handles GET /api/pending_signal/{account_id}/{symbol}
func (h *arbitrationHandler) getPendingSignals(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	accountID, symbol, ok := accountIDAndSymbolFromPath(r.URL.Path, "/api/pending_signal/")
	if !ok {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Verify token authorization
	token := tokenFromContext(r.Context())
	allowed, err := authorizeAccount(r.Context(), h.deps.Tokens, token, accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "forbidden"})
		return
	}

	// Get pending signals from store
	if h.deps.Arbitration == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}

	signals, err := h.deps.Arbitration.GetPendingSignals(r.Context(), accountID, symbol)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	if signals == nil {
		signals = []domain.PendingSignal{}
	}

	writeJSON(w, http.StatusOK, signals)
}

// postArbitrationResult handles POST /api/arbitration/{signal_id}
func (h *arbitrationHandler) postArbitrationResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse signal ID from path
	signalIDStr, ok := stringFromPath(r.URL.Path, "/api/arbitration/")
	if !ok {
		http.Error(w, "invalid signal_id", http.StatusBadRequest)
		return
	}

	signalID, err := strconv.ParseInt(signalIDStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid signal_id", http.StatusBadRequest)
		return
	}

	// Parse request body
	var req struct {
		Result string `json:"result"` // "approved" or "rejected"
		Reason string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid JSON"})
		return
	}

	if req.Result != "approved" && req.Result != "rejected" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "result must be 'approved' or 'rejected'"})
		return
	}

	// Verify token is admin
	token := tokenFromContext(r.Context())
	isAdmin, err := h.deps.Tokens.IsAdmin(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !isAdmin {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "admin only"})
		return
	}

	// Update arbitration result
	if h.deps.Arbitration == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": "arbitration store not configured"})
		return
	}

	if err := h.deps.Arbitration.UpdateArbitration(r.Context(), signalID, req.Result, req.Reason); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "OK",
		"signal_id": signalID,
		"result":    req.Result,
	})
}

// expireStaleSignals handles POST /api/arbitration/expire
func (h *arbitrationHandler) expireStaleSignals(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify token is admin
	token := tokenFromContext(r.Context())
	isAdmin, err := h.deps.Tokens.IsAdmin(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !isAdmin {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "admin only"})
		return
	}

	// Expire stale signals
	if h.deps.Arbitration == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "expired": 0})
		return
	}

	count, err := h.deps.Arbitration.ExpireStaleSignals(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "expired": count})
}

// stringFromPath extracts a string value from a URL path.
func stringFromPath(path, prefix string) (string, bool) {
	if len(path) <= len(prefix) {
		return "", false
	}
	value := path[len(prefix):]
	if value == "" {
		return "", false
	}
	return value, true
}
