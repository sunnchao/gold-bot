package legacy

import (
	"log"
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
		log.Printf("[TICK] ❌ 解析请求失败: %v", err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	log.Printf("[TICK] 📊 account=%s | symbol=%s bid=%.5f ask=%.5f spread=%.3f time=%s",
		req.AccountID, req.Symbol, req.Bid, req.Ask, req.Spread, req.Time)

	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		log.Printf("[TICK] ❌ %v", err)
		writeBadRequest(w, err.Error())
		return
	}
	allowed, err := authorizeAccountWrite(r, h.tokens, accountID)
	if err != nil {
		log.Printf("[TICK] ❌ account=%s | 授权错误: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if !allowed {
		log.Printf("[TICK] 🔒 account=%s | token 无权限", accountID)
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
