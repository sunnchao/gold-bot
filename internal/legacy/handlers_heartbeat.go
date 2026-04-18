package legacy

import (
	"log"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type HeartbeatHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type HeartbeatRequest struct {
	AccountID      string  `json:"account_id"`
	Balance        float64 `json:"balance"`
	Equity         float64 `json:"equity"`
	Margin         float64 `json:"margin"`
	FreeMargin     float64 `json:"free_margin"`
	ServerTime     string  `json:"server_time"`
	MarketOpen     *bool   `json:"market_open"`
	IsTradeAllowed *bool   `json:"is_trade_allowed"`
}

func (h *HeartbeatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req HeartbeatRequest
	if err := decodeJSONBody(r, &req); err != nil {
		log.Printf("[HEARTBEAT] ❌ 解析请求失败: %v", err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	log.Printf("[HEARTBEAT] 💓 account=%s | balance=%.2f equity=%.2f margin=%.2f free_margin=%.2f",
		req.AccountID, req.Balance, req.Equity, req.Margin, req.FreeMargin)

	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		log.Printf("[HEARTBEAT] ❌ %v", err)
		writeBadRequest(w, err.Error())
		return
	}
	allowed, err := authorizeAccountWrite(r, h.tokens, accountID)
	if err != nil {
		log.Printf("[HEARTBEAT] ❌ account=%s | 授权错误: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if !allowed {
		log.Printf("[HEARTBEAT] 🔒 account=%s | token 无权限", accountID)
		writeJSON(w, http.StatusForbidden, map[string]any{
			"status":  "ERROR",
			"message": "token not authorized for account",
		})
		return
	}
	if err := h.accounts.EnsureAccount(r.Context(), accountID, now); err != nil {
		log.Printf("[HEARTBEAT] ❌ account=%s | EnsureAccount 失败: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	if err := h.accounts.SaveHeartbeat(r.Context(), domain.AccountRuntime{
		AccountID:       accountID,
		Connected:       true,
		Balance:         req.Balance,
		Equity:          req.Equity,
		Margin:          req.Margin,
		FreeMargin:      req.FreeMargin,
		MarketOpen:      boolWithDefault(req.MarketOpen, false),
		IsTradeAllowed:  boolWithDefault(req.IsTradeAllowed, false),
		MT4ServerTime:   req.ServerTime,
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		log.Printf("[HEARTBEAT] ❌ account=%s | SaveHeartbeat 失败: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	log.Printf("[HEARTBEAT] ✅ account=%s | 已更新", accountID)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "OK",
		"server_time": now.Unix(),
	})
}

func boolWithDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}

	return *value
}
