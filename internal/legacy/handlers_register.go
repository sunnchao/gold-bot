package legacy

import (
	"log"
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
	AccountID       string            `json:"account_id"`
	Broker          string            `json:"broker"`
	ServerName      string            `json:"server_name"`
	AccountName     string            `json:"account_name"`
	AccountType     string            `json:"account_type"`
	Currency        string            `json:"currency"`
	Leverage        int               `json:"leverage"`
	StrategyMapping map[string]string `json:"strategy_mapping"`
}

func (h *RegisterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := decodeJSONBody(r, &req); err != nil {
		log.Printf("[REGISTER] ❌ account=%s | 解析请求失败: %v", req.AccountID, err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	log.Printf("[REGISTER] 📥 account=%s | broker=%s server=%s leverage=%d currency=%s",
		req.AccountID, req.Broker, req.ServerName, req.Leverage, req.Currency)

	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		log.Printf("[REGISTER] ❌ %v", err)
		writeBadRequest(w, err.Error())
		return
	}
	allowed, err := authorizeAccountWrite(r, h.tokens, accountID)
	if err != nil {
		log.Printf("[REGISTER] ❌ account=%s | 授权错误: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if !allowed {
		log.Printf("[REGISTER] 🔒 account=%s | token 无权限", accountID)
		writeJSON(w, http.StatusForbidden, map[string]any{
			"status":  "ERROR",
			"message": "token not authorized for account",
		})
		return
	}
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
		log.Printf("[REGISTER] ❌ account=%s | UpsertAccount 失败: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if len(req.StrategyMapping) > 0 {
		if err := h.accounts.SaveStrategyMapping(r.Context(), accountID, "XAUUSD", req.StrategyMapping, now); err != nil {
			log.Printf("[REGISTER] ❌ account=%s | SaveStrategyMapping 失败: %v", accountID, err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"status":  "ERROR",
				"message": err.Error(),
			})
			return
		}
	}

	log.Printf("[REGISTER] ✅ account=%s | 注册成功", accountID)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "OK",
		"message": "registered",
	})
}
