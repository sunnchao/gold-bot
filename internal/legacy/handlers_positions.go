package legacy

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"gold-bot/internal/domain"
)

type PositionsHandler struct {
	accounts    AccountStore
	tokens      TokenStore
	liveTrading LiveTrading
	now         func() time.Time
}

type PositionsRequest struct {
	AccountID string            `json:"account_id"`
	Symbol    string            `json:"symbol,omitempty"`
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

	// 从 AccountState 获取 StrategyMapping，解析每个持仓的策略
	state, _ := h.accounts.GetStateSymbol(r.Context(), req.AccountID, req.Symbol)
	mapping := state.StrategyMapping
	if len(mapping) == 0 {
		mapping = map[string]string{
			"20250231": "pullback",
			"20250232": "breakout_retest",
			"20250233": "divergence",
			"20250234": "breakout_pyramid",
			"20250235": "counter_pullback",
			"20250236": "range",
		}
	}
	for i := range req.Positions {
		if req.Positions[i].Strategy == "" && req.Positions[i].Magic > 0 {
			if strategy, ok := mapping[strconv.Itoa(req.Positions[i].Magic)]; ok {
				req.Positions[i].Strategy = strategy
			}
		}
	}

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
	// Use symbol from request, default to XAUUSD for backward compatibility
	symbol := req.Symbol
	if symbol == "" {
		symbol = "XAUUSD"
	}

	if err := h.accounts.SavePositions(r.Context(), accountID, symbol, req.Positions, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  "ERROR",
			"message": err.Error(),
		})
		return
	}
	if h.liveTrading != nil {
		if err := h.liveTrading.OnPositions(r.Context(), accountID, symbol); err != nil {
			log.Printf("[POSITIONS] ⚠️ account=%s/%s | live trading 降级跳过: %v", accountID, symbol, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "OK",
		"count":  len(req.Positions),
	})
}
