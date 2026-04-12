package legacy

import (
	"net/http"
	"time"
)

type PollHandler struct {
	tokens   TokenStore
	commands CommandStore
	now      func() time.Time
}

type PollRequest struct {
	AccountID string `json:"account_id"`
}

func (h *PollHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req PollRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeBadRequest(w, "invalid JSON")
		return
	}

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
	if h.commands == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": "command store unavailable",
		})
		return
	}

	commands, err := h.commands.TakePending(r.Context(), accountID, h.now().UTC())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	payloads := make([]map[string]any, 0, len(commands))
	for _, command := range commands {
		payloads = append(payloads, command.PayloadForPoll())
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "OK",
		"commands": payloads,
		"count":    len(payloads),
	})
}
