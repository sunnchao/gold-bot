package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/integration/aurex"
	"gold-bot/internal/legacy"
	"gold-bot/internal/strategy/riskgate"
)

type aiHandler struct {
	deps            Dependencies
	now             func() time.Time
	approveCooldown *aiApproveCooldown
}

type aiApproveCooldown struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newAIApproveCooldown() *aiApproveCooldown {
	return &aiApproveCooldown{last: make(map[string]time.Time)}
}

func (c *aiApproveCooldown) active(symbol string, now time.Time, cooldown time.Duration) bool {
	if c == nil {
		return false
	}

	key := strings.ToUpper(strings.TrimSpace(symbol))
	c.mu.Lock()
	defer c.mu.Unlock()

	last, ok := c.last[key]
	return ok && now.Sub(last) < cooldown
}

func (c *aiApproveCooldown) mark(symbol string, now time.Time) {
	if c == nil {
		return
	}

	key := strings.ToUpper(strings.TrimSpace(symbol))
	c.mu.Lock()
	c.last[key] = now
	c.mu.Unlock()
}

// analysisPayload handles legacy endpoint /api/analysis_payload/{account_id}
// Default symbol is XAUUSD for backward compatibility.
func (h aiHandler) analysisPayload(w http.ResponseWriter, r *http.Request) {
	accountID, ok := accountIDFromPath(r.URL.Path, "/api/analysis_payload/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	h.handleAnalysisPayload(w, r, accountID, "XAUUSD")
}

// analysisPayloadSymbol handles new endpoint /api/v2/analysis_payload/{account_id}/{symbol}
func (h aiHandler) analysisPayloadSymbol(w http.ResponseWriter, r *http.Request) {
	accountID, symbol, ok := accountIDAndSymbolFromPath(r.URL.Path, "/api/v2/analysis_payload/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	h.handleAnalysisPayload(w, r, accountID, symbol)
}

func (h aiHandler) handleAnalysisPayload(w http.ResponseWriter, r *http.Request, accountID, symbol string) {
	log.Printf("[AI] 📊 analysis_payload 请求 | account=%s/%s", accountID, symbol)

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
	state, err := h.deps.Accounts.GetStateSymbol(r.Context(), accountID, symbol)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, aurex.BuildAnalysisPayload(account, runtime, state, h.now().UTC()))
}

// aiResult handles legacy endpoint /api/ai_result/{account_id}
func (h aiHandler) aiResult(w http.ResponseWriter, r *http.Request) {
	accountID, ok := accountIDFromPath(r.URL.Path, "/api/ai_result/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	h.handleAIResult(w, r, accountID, "XAUUSD")
}

// aiResultSymbol handles new endpoint /api/v2/ai_result/{account_id}/{symbol}
func (h aiHandler) aiResultSymbol(w http.ResponseWriter, r *http.Request) {
	accountID, symbol, ok := accountIDAndSymbolFromPath(r.URL.Path, "/api/v2/ai_result/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	h.handleAIResult(w, r, accountID, symbol)
}

func (h aiHandler) handleAIResult(w http.ResponseWriter, r *http.Request, accountID, symbol string) {
	log.Printf("[AI] 🤖 ai_result 请求 | account=%s/%s", accountID, symbol)

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
	tradePlan, tradePlanValidation := parseTradePlanPayload(payload, accountID, symbol)
	riskGateResult, err := h.evaluateRiskGate(r.Context(), accountID, symbol, tradePlan, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if err := h.deps.Accounts.SaveAIResult(r.Context(), accountID, symbol, raw, now); err != nil {
		log.Printf("[AI] ❌ account=%s/%s | SaveAIResult 失败: %v", accountID, symbol, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if err := h.recordAIDecisionTimeline(r.Context(), accountID, symbol, tradePlan, riskGateResult, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	log.Printf("[AI] ✅ account=%s/%s | AI 分析结果已保存 | payload_size=%d bytes", accountID, symbol, len(raw))

	// Log AI analysis summary if available
	if bias, ok := payload["bias"].(string); ok {
		confidence := payload["confidence"]
		exitSug := payload["exit_suggestion"]
		log.Printf("[AI] 📈 account=%s/%s | bias=%s confidence=%v exit_suggestion=%v", accountID, symbol, bias, confidence, exitSug)
	}
	if riskAlert, ok := payload["risk_alert"].(bool); ok && riskAlert {
		log.Printf("[AI] 🚨 account=%s/%s | 风险警报触发! reason=%s exit=%s",
			accountID, symbol, asString(payload["alert_reason"]), asString(payload["exit_suggestion"]))
	}

	if h.deps.Events != nil {
		eventPayload := raw
		if tradePlan != nil {
			eventPayload = aiResultEventPayload(payload, tradePlan.Summary(), riskGateResult)
		}
		h.deps.Events.Publish(domain.Event{
			EventID:   fmt.Sprintf("evt_ai_%d", now.UnixNano()),
			EventType: "ai_result",
			AccountID: accountID,
			Source:    "api.ai_result",
			Timestamp: now,
			Payload:   eventPayload,
		})
	}

	if shouldQueueRiskCommand(payload) && riskGateAllowsCommand(tradePlan, riskGateResult) {
		exitSuggestion := strings.ToLower(asString(payload["exit_suggestion"]))
		if exitSuggestion == "close_short" {
			state, err := h.deps.Accounts.GetStateSymbol(r.Context(), accountID, symbol)
			if err != nil {
				log.Printf("[AI] ❌ account=%s/%s | 获取持仓状态失败: %v", accountID, symbol, err)
				writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
				return
			}

			commands := buildCloseShortCommands(accountID, symbol, payload, state.Positions, now, tradePlan, riskGateResult)
			if len(commands) == 0 {
				log.Printf("[AI] ⚠️ account=%s/%s | 风险警报要求平空，但当前无可执行 SELL 持仓，跳过下发", accountID, symbol)
			} else {
				tickets := make([]string, 0, len(commands))
				for _, command := range commands {
					tickets = append(tickets, fmt.Sprintf("%v", command.Payload["ticket"]))
					if err := h.deps.Commands.Enqueue(r.Context(), command); err != nil {
						writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
						return
					}
				}
				log.Printf("[AI] 📈 account=%s/%s | 自动平空 | tickets=%s | reason=%s", accountID, symbol, strings.Join(tickets, ","), asString(payload["alert_reason"]))
			}
		} else {
			commandID := fmt.Sprintf("ai_close_%d", now.Unix())
			action := domain.CommandActionClosePartial
			if exitSuggestion == "close_all" {
				action = domain.CommandActionCloseAll
			}
			log.Printf("[AI] 🚨 account=%s/%s | 触发风控指令: %s | reason=%s", accountID, symbol, action, asString(payload["alert_reason"]))

			commandPayload := map[string]any{
				"command_id": commandID,
				"action":     string(action),
				"reason":     fmt.Sprintf("AI风险警报: %s", asString(payload["alert_reason"])),
				"confidence": payload["confidence"],
				"source":     "ai_risk_alert",
			}
			attachTradePlanCommandMetadata(commandPayload, tradePlan, riskGateResult)

			// P3-14: Auto-execution with specific lot reduction for close_partial
			if exitSuggestion == "close_partial" {
				commandPayload["lots_pct"] = 0.5
				commandPayload["reason"] = fmt.Sprintf("AI风险警报(减仓50%%): %s", asString(payload["alert_reason"]))
				log.Printf("[AI] 📉 account=%s/%s | 自动减仓50%% | reason=%s", accountID, symbol, asString(payload["alert_reason"]))
			} else if exitSuggestion == "close_all" {
				commandPayload["reason"] = fmt.Sprintf("AI风险警报(全平): %s", asString(payload["alert_reason"]))
				log.Printf("[AI] 🔴 account=%s/%s | 自动全平 | reason=%s", accountID, symbol, asString(payload["alert_reason"]))
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
	}

	// === AI approve → PENDING 挂单 ===
	if shouldQueueAIPending(tradePlan, riskGateResult) {
		var currentPrice float64
		state, err := h.deps.Accounts.GetStateSymbol(r.Context(), accountID, symbol)
		if err == nil {
			if state.Tick.Bid > 0 && state.Tick.Ask > 0 {
				currentPrice = (state.Tick.Bid + state.Tick.Ask) / 2
			} else if state.Tick.Ask > 0 {
				currentPrice = state.Tick.Ask
			} else if state.Tick.Bid > 0 {
				currentPrice = state.Tick.Bid
			}
		}

		if currentPrice <= 0 {
			log.Printf("[AI] ⚠️ account=%s/%s | AI approve 跳过: 无法获取当前价格", accountID, symbol)
		} else {
			entry := pickEntryPrice(tradePlan.EntryZone)
			if entry <= 0 {
				log.Printf("[AI] ⚠️ account=%s/%s | AI approve 跳过: entry_zone 无效 min=%v max=%v",
					accountID, symbol, tradePlan.EntryZone.Min, tradePlan.EntryZone.Max)
			} else {
				lots := calcAILots(tradePlan.MaxLots)
				if lots <= 0 {
					log.Printf("[AI] ⚠️ account=%s/%s | AI approve 跳过: 手数过小 maxLots=%v",
						accountID, symbol, tradePlan.MaxLots)
				} else if hasOpenPositionOnSide(state.Positions, symbol, tradePlan.Side) {
					log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: 已有同向持仓 side=%s",
						accountID, symbol, tradePlan.Side)
				} else if hasExisting, err := h.deps.Commands.FindPendingAI(r.Context(), accountID, symbol, tradePlan.Side); err == nil && hasExisting {
					log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: 已有活跃AI挂单 side=%s",
						accountID, symbol, tradePlan.Side)
				} else if err != nil {
					log.Printf("[AI] ⚠️ account=%s/%s | 检查AI挂单失败: %v", accountID, symbol, err)
				} else if h.approveCooldown.active(symbol, now, 30*time.Minute) {
					log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: 30分钟冷却中",
						accountID, symbol)
				} else {
					h1Bars := state.Bars["H1"]
					atr := 0.0
					if len(h1Bars) > 0 {
						atr = h1Bars[len(h1Bars)-1].ATR
					}
					if atr > 0 {
						dist := math.Abs(currentPrice - entry)
						if dist > atr*3.0 {
							log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: entry 偏离市价 %.1f > 3×ATR(%.1f)",
								accountID, symbol, dist, atr*3.0)
							goto afterAIPending
						}
					}

					side := strings.ToUpper(tradePlan.Side)
					orderType := legacy.OrderTypeForSignal(currentPrice, entry, atr, side)
					now := h.now().UTC()
					commandID := fmt.Sprintf("ai_pending_%s_%s_%d", accountID, symbol, now.UnixNano())
					expiration := now.Add(4 * time.Hour)
					tp := pickTakeProfit(tradePlan.TakeProfit)

					commandPayload := map[string]any{
						"command_id":  commandID,
						"action":      string(domain.CommandActionSignal),
						"symbol":      symbol,
						"type":        side,
						"entry":       math.Round(entry*100) / 100,
						"entry_min":   math.Round(tradePlan.EntryZone.Min*100) / 100,
						"entry_max":   math.Round(tradePlan.EntryZone.Max*100) / 100,
						"sl":          math.Round(tradePlan.StopLoss*100) / 100,
						"tp":          math.Round(tp*100) / 100,
						"lots":        math.Round(lots*100) / 100,
						"order_type":  orderType,
						"expiration":  expiration.Unix(),
						"score":       tradePlan.Confidence,
						"strategy":    "ai_signal",
						"source":      "ai_approve",
						"confidence":  tradePlan.Confidence,
						"decision_id": tradePlan.DecisionID,
						"reason":      tradePlan.Narrative,
					}
					attachTradePlanCommandMetadata(commandPayload, tradePlan, riskGateResult)

					command := domain.Command{
						CommandID: commandID,
						AccountID: accountID,
						Action:    domain.CommandActionSignal,
						Status:    domain.CommandStatusPending,
						CreatedAt: now,
						Payload:   commandPayload,
					}
					if err := h.deps.Commands.Enqueue(r.Context(), command); err != nil {
						log.Printf("[AI] ❌ account=%s/%s | AI approve 入列失败: %v", accountID, symbol, err)
						writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
						return
					}
					h.approveCooldown.mark(symbol, now)
					log.Printf("[AI] 📌 account=%s/%s | AI approve 挂单已发送 | side=%s lots=%.2f entry=%.2f order_type=%s confidence=%d expires=%s",
						accountID, symbol, side, lots, entry, orderType, tradePlan.Confidence, expiration.Format(time.RFC3339))
				}
			}
		}
	}
afterAIPending:

	response := map[string]any{"status": "OK", "received": true}
	if tradePlanValidation != nil {
		response["trade_plan_validation"] = tradePlanValidation
	}
	if tradePlan != nil {
		response["decision"] = tradePlan.Summary()
		response["risk_gate"] = riskGateResult
	}
	writeJSON(w, http.StatusOK, response)
}

func (h aiHandler) evaluateRiskGate(ctx context.Context, accountID, symbol string, tradePlan *domain.TradePlan, now time.Time) (riskgate.Result, error) {
	if tradePlan == nil {
		return riskgate.Result{}, nil
	}

	account, err := h.deps.Accounts.GetAccount(ctx, accountID)
	if err != nil {
		return riskgate.Result{}, err
	}
	runtime, err := h.deps.Accounts.GetRuntime(ctx, accountID)
	if err != nil {
		return riskgate.Result{}, err
	}
	state, err := h.deps.Accounts.GetStateSymbol(ctx, accountID, symbol)
	if err != nil {
		return riskgate.Result{}, err
	}

	return riskgate.Evaluate(riskgate.Input{
		Now:     now,
		Account: account,
		Runtime: runtime,
		State:   state,
		Plan:    tradePlan,
	}), nil
}

func (h aiHandler) recordAIDecisionTimeline(ctx context.Context, accountID, symbol string, tradePlan *domain.TradePlan, gate riskgate.Result, now time.Time) error {
	if h.deps.Decisions == nil || tradePlan == nil {
		return nil
	}

	if err := h.deps.Decisions.Record(ctx, domain.DecisionEvent{
		DecisionID:  tradePlan.DecisionID,
		AccountID:   accountID,
		Symbol:      symbol,
		Stage:       domain.DecisionStageAIResult,
		Status:      domain.DecisionStatusAccepted,
		ReasonCodes: tradePlan.ReasonCodes,
		Summary:     tradePlanDecisionSummary(tradePlan),
		CreatedAt:   now,
	}); err != nil {
		return err
	}

	return h.deps.Decisions.Record(ctx, domain.DecisionEvent{
		DecisionID:  tradePlan.DecisionID,
		AccountID:   accountID,
		Symbol:      symbol,
		Stage:       domain.DecisionStageRiskGate,
		Status:      riskGateDecisionStatus(gate.Status),
		ReasonCodes: gate.ReasonCodes,
		Summary:     riskGateDecisionSummary(gate),
		CreatedAt:   now,
	})
}

func parseTradePlanPayload(payload map[string]any, accountID, symbol string) (*domain.TradePlan, map[string]any) {
	value, ok := payload["trade_plan"]
	if !ok {
		return nil, nil
	}

	raw, err := json.Marshal(value)
	if err != nil {
		return nil, map[string]any{"valid": false, "error": fmt.Sprintf("marshal trade_plan: %v", err)}
	}
	plan, err := domain.ParseTradePlan(raw, accountID, symbol)
	if err != nil {
		return nil, map[string]any{"valid": false, "error": err.Error()}
	}
	return plan, map[string]any{"valid": true}
}

func tradePlanDecisionSummary(plan *domain.TradePlan) map[string]any {
	return map[string]any{
		"decision_id": plan.DecisionID,
		"mode":        plan.Mode,
		"symbol":      plan.Symbol,
		"confidence":  plan.Confidence,
	}
}

func riskGateDecisionSummary(gate riskgate.Result) map[string]any {
	return map[string]any{
		"decision_id":     gate.DecisionID,
		"mode":            gate.Mode,
		"symbol":          gate.Symbol,
		"status":          string(gate.Status),
		"audit_only":      gate.AuditOnly,
		"requested_lots":  gate.RequestedLots,
		"allowed_lots":    gate.AllowedLots,
		"max_risk_lots":   gate.MaxRiskLots,
		"max_margin_lots": gate.MaxMarginLots,
	}
}

func riskGateDecisionStatus(status riskgate.Status) domain.DecisionStatus {
	switch status {
	case riskgate.StatusAccepted:
		return domain.DecisionStatusAccepted
	case riskgate.StatusRejected:
		return domain.DecisionStatusRejected
	case riskgate.StatusClamped:
		return domain.DecisionStatusClamped
	default:
		return domain.DecisionStatusPending
	}
}

func aiResultEventPayload(payload map[string]any, summary domain.TradePlanSummary, gate riskgate.Result) json.RawMessage {
	eventPayload := make(map[string]any, len(payload)+2)
	for key, value := range payload {
		eventPayload[key] = value
	}
	eventPayload["trade_plan_summary"] = summary
	eventPayload["risk_gate"] = gate
	data, err := json.Marshal(eventPayload)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return data
}

func buildCloseShortCommands(accountID, symbol string, payload map[string]any, positions []domain.Position, now time.Time, tradePlan *domain.TradePlan, gate riskgate.Result) []domain.Command {
	reason := fmt.Sprintf("AI风险警报(平空): %s", asString(payload["alert_reason"]))
	commands := make([]domain.Command, 0, len(positions))
	for _, position := range positions {
		if position.Ticket <= 0 {
			continue
		}
		if position.Symbol != "" && !strings.EqualFold(position.Symbol, symbol) {
			continue
		}
		if !strings.EqualFold(position.Type, "SELL") {
			continue
		}

		commandID := fmt.Sprintf("ai_close_%d_%d", now.UnixNano(), position.Ticket)
		commandPayload := map[string]any{
			"command_id": commandID,
			"action":     string(domain.CommandActionClose),
			"ticket":     position.Ticket,
			"symbol":     symbol,
			"reason":     reason,
			"confidence": payload["confidence"],
			"source":     "ai_risk_alert",
		}
		attachTradePlanCommandMetadata(commandPayload, tradePlan, gate)

		commands = append(commands, domain.Command{
			CommandID: commandID,
			AccountID: accountID,
			Action:    domain.CommandActionClose,
			Status:    domain.CommandStatusPending,
			CreatedAt: now,
			Payload:   commandPayload,
		})
	}
	return commands
}

func riskGateAllowsCommand(tradePlan *domain.TradePlan, gate riskgate.Result) bool {
	if tradePlan == nil {
		return true
	}
	return gate.Status == riskgate.StatusAccepted || gate.Status == riskgate.StatusClamped
}

func attachTradePlanCommandMetadata(payload map[string]any, tradePlan *domain.TradePlan, gate riskgate.Result) {
	if tradePlan == nil {
		return
	}
	payload["decision_id"] = tradePlan.DecisionID
	payload["trade_plan_mode"] = tradePlan.Mode
	payload["risk_gate"] = gate
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
	return exitSuggestion == "close_partial" || exitSuggestion == "close_all" || exitSuggestion == "close_short"
}

// shouldQueueAIPending checks whether to generate a PENDING order from AI trade_plan.
func shouldQueueAIPending(plan *domain.TradePlan, gate riskgate.Result) bool {
	if plan == nil {
		return false
	}
	if plan.Mode != "approve" {
		return false
	}
	if plan.Side != "buy" && plan.Side != "sell" {
		return false
	}
	if gate.Status == riskgate.StatusRejected {
		return false
	}
	if plan.Confidence < 70 {
		return false
	}
	return true
}

// calcAILots reduces trade plan max lots by half, rounded up to 0.01 step.
func calcAILots(maxLots float64) float64 {
	if maxLots <= 0 {
		return 0
	}
	half := maxLots * 0.5
	lots := math.Ceil(half/0.01) * 0.01
	if lots < 0.01 {
		return 0
	}
	if lots > 0.01 {
		return 0.01
	}
	return lots
}

func hasOpenPositionOnSide(positions []domain.Position, symbol, side string) bool {
	wantSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	wantSide := strings.ToUpper(strings.TrimSpace(side))
	if wantSide == "BUY" {
		wantSide = "BUY"
	} else if wantSide == "SELL" {
		wantSide = "SELL"
	}

	for _, position := range positions {
		if wantSymbol != "" && position.Symbol != "" && !strings.EqualFold(position.Symbol, wantSymbol) {
			continue
		}
		if strings.EqualFold(position.Type, wantSide) {
			return true
		}
	}
	return false
}

// pickEntryPrice returns the midpoint of an entry zone.
func pickEntryPrice(zone domain.TradePlanEntryZone) float64 {
	if zone.Min <= 0 || zone.Max <= 0 {
		return 0
	}
	if zone.Min == zone.Max {
		return zone.Min
	}
	return (zone.Min + zone.Max) / 2
}

// pickTakeProfit returns the first positive TP target.
func pickTakeProfit(tp []float64) float64 {
	for _, v := range tp {
		if v > 0 {
			return v
		}
	}
	return 0
}

func asString(value any) string {
	text, _ := value.(string)
	return text
}
