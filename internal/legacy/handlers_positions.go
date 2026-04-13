package legacy

import (
	"log"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type PositionsHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type PositionsRequest struct {
	AccountID string            `json:"account_id"`
	Positions []domain.Position `json:"positions"`
}

func (h *PositionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req PositionsRequest
	if err := decodeJSONBody(r, &req); err != nil {
		log.Printf("[POSITIONS] ❌ 解析请求失败: %v", err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	log.Printf("[POSITIONS] 📋 account=%s | positions_count=%d", req.AccountID, len(req.Positions))
	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		log.Printf("[POSITIONS] ❌ %v", err)
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
	if err := h.accounts.TouchRuntime(r.Context(), accountID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if err := h.accounts.SavePositions(r.Context(), accountID, req.Positions, now); err != nil {
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
