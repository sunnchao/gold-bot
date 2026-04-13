package api

import (
	"encoding/json"
	"fmt"
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
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
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
		if strings.EqualFold(asString(payload["exit_suggestion"]), "close_all") {
			action = domain.CommandActionCloseAll
		}
		command := domain.Command{
			CommandID: commandID,
			AccountID: accountID,
			Action:    action,
			Status:    domain.CommandStatusPending,
			CreatedAt: now,
			Payload: map[string]any{
				"command_id": commandID,
				"action":     string(action),
				"reason":     fmt.Sprintf("AI风险警报: %s", asString(payload["alert_reason"])),
				"confidence": payload["confidence"],
			},
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
