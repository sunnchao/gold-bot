package legacy

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"gold-bot/internal/domain"
)

type OrderResultHandler struct {
	tokens   TokenStore
	commands CommandStore
	now      func() time.Time
}

type OrderResultRequest struct {
	AccountID string `json:"account_id"`
	CommandID string `json:"command_id"`
	Result    string `json:"result"`
	Ticket    int64  `json:"ticket"`
	Error     string `json:"error"`
}

func (h *OrderResultHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req OrderResultRequest
	if err := decodeJSONBody(r, &req); err != nil {
		log.Printf("[ORDER_RESULT] ❌ 解析请求失败: %v", err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		writeBadRequest(w, err.Error())
		return
	}
	if strings.TrimSpace(req.CommandID) == "" {
		writeBadRequest(w, "missing command_id")
		return
	}
	if strings.TrimSpace(req.Result) == "" {
		writeBadRequest(w, "missing result")
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
	if h.commands == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": "command history unavailable",
		})
		return
	}

	ts := h.now().UTC()
	log.Printf("[ORDER_RESULT] 📝 account=%s | cmd=%s | result=%s ticket=%d error=%s", req.AccountID, req.CommandID, req.Result, req.Ticket, req.Error)
	if err := h.commands.ApplyResult(r.Context(), domain.CommandResult{
		CommandID: req.CommandID,
		AccountID: accountID,
		Result:    req.Result,
		Ticket:    req.Ticket,
		ErrorText: req.Error,
		CreatedAt: ts,
	}); err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	log.Printf("[ORDER_RESULT] ✅ cmd=%s | 已处理", req.CommandID)
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK"})
}
