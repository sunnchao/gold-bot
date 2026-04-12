package legacy

import (
	"encoding/json"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type RegisterHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type RegisterRequest struct {
	AccountID   string `json:"account_id"`
	Broker      string `json:"broker"`
	ServerName  string `json:"server_name"`
	AccountName string `json:"account_name"`
	AccountType string `json:"account_type"`
	Currency    string `json:"currency"`
	Leverage    int    `json:"leverage"`
}

func (h *RegisterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	now := h.now().UTC()
	accountID := defaultAccountID(req.AccountID)
	if err := h.accounts.UpsertAccount(r.Context(), domain.Account{
		AccountID:   accountID,
		Broker:      req.Broker,
		ServerName:  req.ServerName,
		AccountName: req.AccountName,
		AccountType: req.AccountType,
		Currency:    req.Currency,
		Leverage:    req.Leverage,
		UpdatedAt:   now,
	}); err != nil {
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

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "OK",
		"message": "registered",
	})
}
