package legacy

import (
	"log"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type BarsHandler struct {
	accounts AccountStore
	tokens   TokenStore
	now      func() time.Time
}

type BarsRequest struct {
	AccountID string       `json:"account_id"`
	Timeframe string       `json:"timeframe"`
	Bars      []domain.Bar `json:"bars"`
}

func (h *BarsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req BarsRequest
	if err := decodeJSONBody(r, &req); err != nil {
		log.Printf("[BARS] ❌ 解析请求失败: %v", err)
		writeBadRequest(w, "invalid JSON")
		return
	}

	log.Printf("[BARS] 📈 account=%s | tf=%s | bars_count=%d",
		req.AccountID, req.Timeframe, len(req.Bars))
	if len(req.Bars) > 0 {
		last := req.Bars[len(req.Bars)-1]
		log.Printf("[BARS] 📈 account=%s | tf=%s | latest_bar: time=%s O=%.5f H=%.5f L=%.5f C=%.5f",
			req.AccountID, req.Timeframe, last.Time, last.Open, last.High, last.Low, last.Close)
	}

	now := h.now().UTC()
	accountID, err := requireAccountID(req.AccountID)
	if err != nil {
		log.Printf("[BARS] ❌ %v", err)
		writeBadRequest(w, err.Error())
		return
	}
	allowed, err := authorizeAccountWrite(r, h.tokens, accountID)
	if err != nil {
		log.Printf("[BARS] ❌ account=%s | 授权错误: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if !allowed {
		log.Printf("[BARS] 🔒 account=%s | token 无权限", accountID)
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
	if err := h.accounts.SaveBars(r.Context(), accountID, req.Timeframe, req.Bars, now); err != nil {
		log.Printf("[BARS] ❌ account=%s | tf=%s | SaveBars 失败: %v", accountID, req.Timeframe, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}

	log.Printf("[BARS] ✅ account=%s | tf=%s | 已保存 %d 根K线", accountID, req.Timeframe, len(req.Bars))
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "OK",
		"received": len(req.Bars),
	})
}
