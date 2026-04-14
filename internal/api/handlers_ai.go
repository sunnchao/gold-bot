package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/integration/aurex"
)

type aiHandler struct {
	deps Dependencies
	now  func() time.Time
}

func (h aiHandler) analysisPayload(w http.ResponseWriter, r *http.Request) {
	accountID, ok := accountIDFromPath(r.URL.Path, "/api/analysis_payload/")
	if !ok {
		http.NotFound(w, r)
		return
	}

	log.Printf("[AI] 📊 analysis_payload 请求 | account=%s", accountID)

	allowed, err := authorizeAccount(r.Context(), h.deps.Tokens, tokenFromContext(r.Context()), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "forbidden"})
		return
	}

	account, err := h.deps.Accounts.GetAccount(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	runtime, err := h.deps.Accounts.GetRuntime(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	state, err := h.deps.Accounts.GetState(r.Context(), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, aurex.BuildAnalysisPayload(account, runtime, state, h.now().UTC()))
}

func (h aiHandler) aiResult(w http.ResponseWriter, r *http.Request) {
	accountID, ok := accountIDFromPath(r.URL.Path, "/api/ai_result/")
	if !ok {
		http.NotFound(w, r)
		return
	}

	log.Printf("[AI] 🤖 ai_result 请求 | account=%s", accountID)

	allowed, err := authorizeAccount(r.Context(), h.deps.Tokens, tokenFromContext(r.Context()), accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "forbidden"})
		return
	}

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid JSON"})
		return
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	now := h.now().UTC()
	if err := h.deps.Accounts.SaveAIResult(r.Context(), accountID, raw, now); err != nil {
		log.Printf("[AI] ❌ account=%s | SaveAIResult 失败: %v", accountID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	log.Printf("[AI] ✅ account=%s | AI 分析结果已保存 | payload_size=%d bytes", accountID, len(raw))

	// Log AI analysis summary if available
	if bias, ok := payload["bias"].(string); ok {
		confidence := payload["confidence"]
		exitSug := payload["exit_suggestion"]
		log.Printf("[AI] 📈 account=%s | bias=%s confidence=%v exit_suggestion=%v", accountID, bias, confidence, exitSug)
	}
	if riskAlert, ok := payload["risk_alert"].(bool); ok && riskAlert {
		log.Printf("[AI] 🚨 account=%s | 风险警报触发! reason=%s exit=%s",
			accountID, asString(payload["alert_reason"]), asString(payload["exit_suggestion"]))
	}

	if h.deps.Events != nil {
		h.deps.Events.Publish(domain.Event{
			EventID:   fmt.Sprintf("evt_ai_%d", now.UnixNano()),
			EventType: "ai_result",
			AccountID: accountID,
			Source:    "api.ai_result",
			Timestamp: now,
			Payload:   raw,
		})
	}

	if shouldQueueRiskCommand(payload) {
		commandID := fmt.Sprintf("ai_close_%d", now.Unix())
		action := domain.CommandActionClosePartial
		exitSuggestion := strings.ToLower(asString(payload["exit_suggestion"]))
		if exitSuggestion == "close_all" {
			action = domain.CommandActionCloseAll
		}
		log.Printf("[AI] 🚨 account=%s | 触发风控指令: %s | reason=%s", accountID, action, asString(payload["alert_reason"]))

		commandPayload := map[string]any{
			"command_id": commandID,
			"action":     string(action),
			"reason":     fmt.Sprintf("AI风险警报: %s", asString(payload["alert_reason"])),
			"confidence": payload["confidence"],
			"source":     "ai_risk_alert",
		}

		// P3-14: Auto-execution with specific lot reduction for close_partial
		if exitSuggestion == "close_partial" {
			commandPayload["lots_pct"] = 0.5
			commandPayload["reason"] = fmt.Sprintf("AI风险警报(减仓50%%): %s", asString(payload["alert_reason"]))
			log.Printf("[AI] 📉 account=%s | 自动减仓50%% | reason=%s", accountID, asString(payload["alert_reason"]))
		} else if exitSuggestion == "close_all" {
			commandPayload["reason"] = fmt.Sprintf("AI风险警报(全平): %s", asString(payload["alert_reason"]))
			log.Printf("[AI] 🔴 account=%s | 自动全平 | reason=%s", accountID, asString(payload["alert_reason"]))
		}

		command := domain.Command{
			CommandID: commandID,
			AccountID: accountID,
			Action:    action,
			Status:    domain.CommandStatusPending,
			CreatedAt: now,
			Payload:   commandPayload,
		}
		if err := h.deps.Commands.Enqueue(r.Context(), command); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "received": true})
}

func (h aiHandler) triggerAI(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "OK",
		"message":    "AI analysis is now handled by Gateway Cron tasks. This endpoint is deprecated.",
		"deprecated": true,
	})
}

func shouldQueueRiskCommand(payload map[string]any) bool {
	if alert, ok := payload["risk_alert"].(bool); !ok || !alert {
		return false
	}
	exitSuggestion := strings.ToLower(asString(payload["exit_suggestion"]))
	return exitSuggestion == "close_partial" || exitSuggestion == "close_all"
}

func asString(value any) string {
	text, _ := value.(string)
	return text
}
