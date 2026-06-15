# TASKS: Phase 3 — AI Signal Pending Order

**Status:** Pending
**Dependencies:** None
**Branch naming convention:** `feat/ai-signal-pending`

---

## Task 3.1: Export orderTypeForSignal() from live_trading.go

**Files:**
- Modify: `internal/legacy/live_trading.go:163-184`

**Step 1** — Rename `orderTypeForSignal` to `OrderTypeForSignal` (exported):

```go
// OrderTypeForSignal determines whether to use market or pending order based on price distance.
// Returns "market" for close prices, or a specific pending type for far prices.
func OrderTypeForSignal(price, entry, atr float64, side string) string {
	if atr <= 0 {
		return "market"
	}
	dist := math.Abs(price - entry)
	if dist > atr*0.3 {
		if side == "BUY" {
			if entry <= price {
				return "BUY_LIMIT"
			}
			return "BUY_STOP"
		} else {
			if entry >= price {
				return "SELL_LIMIT"
			}
			return "SELL_STOP"
		}
	}
	return "market"
}
```

**Step 2** — Update all callers of `orderTypeForSignal` in `live_trading.go`:

```go
// Line 218: orderType := orderTypeForSignal(currentPrice, signal.Entry, atr, signal.Side)
// → orderType := OrderTypeForSignal(currentPrice, signal.Entry, atr, signal.Side)
```

**Step 3** — Verify compilation:

```bash
cd /root/gold-bot && go build ./internal/legacy/...
```

---

## Task 3.2: Add AI approve → PENDING command logic

**File:**
- Modify: `internal/api/handlers_ai.go`

**Step 1** — Add import for `legacy` package:

```go
import (
	// ... existing imports
	"gold-bot/internal/legacy"
)
```

**Step 2** — Add helper functions after `shouldQueueRiskCommand()` (around line 427):

```go
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
	return lots
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

// pickTakeProfit returns the first reasonable TP target from take_profit array.
func pickTakeProfit(tp []float64) float64 {
	if len(tp) == 0 {
		return 0
	}
	for _, v := range tp {
		if v > 0 {
			return v
		}
	}
	return 0
}

// hasExistingAIPendingOrder checks if there's already an active AI pending order
// for the same symbol and direction.
func (h aiHandler) hasExistingAIPendingOrder(ctx context.Context, accountID, symbol, side string) bool {
	if h.deps.Commands == nil {
		return false
	}
	// Check for existing pending commands with source=ai_approve, same symbol, same direction
	pending, err := h.deps.Commands.FindPendingAI(ctx, accountID, symbol, side)
	if err != nil {
		log.Printf("[AI] ⚠️ account=%s/%s | 检查AI挂单失败: %v", accountID, symbol, err)
		return false
	}
	return pending
}
```

**Step 3** — Add AI approve block in `handleAIResult()` after line 228 (after risk command handling):

```go
	// === AI approve → PENDING 挂单 ===
	if shouldQueueAIPending(tradePlan, riskGateResult) {
		currentPrice := resolveAICurrentPrice(accountID, symbol, r.Context(), h)
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
				} else if h.hasExistingAIPendingOrder(r.Context(), accountID, symbol, tradePlan.Side) {
					log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: 已有活跃AI挂单 side=%s",
						accountID, symbol, tradePlan.Side)
				} else {
					// 价格合理性校验: entry 偏离市价超过 3×ATR 则拒绝
					h1Bars := h.getH1Bars(r.Context(), accountID, symbol)
					atr := 0.0
					if len(h1Bars) > 0 {
						atr = h1Bars[len(h1Bars)-1].ATR
					}
					if atr > 0 {
						dist := math.Abs(currentPrice - entry)
						if dist > atr*3.0 {
							log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: entry 偏离市价 %.1f > 3×ATR(%.1f)",
								accountID, symbol, dist, atr*3.0)
							goto skipAIPending
						}
					}

					side := strings.ToUpper(tradePlan.Side)
					orderType := legacy.OrderTypeForSignal(currentPrice, entry, atr, side)
					now := h.now().UTC()
					commandID := fmt.Sprintf("ai_pending_%s_%s_%d", accountID, symbol, now.UnixNano())
					expiration := now.Add(4 * time.Hour)

					commandPayload := map[string]any{
						"command_id":  commandID,
						"action":      string(domain.CommandActionSignal),
						"symbol":      symbol,
						"type":        side,
						"entry":       entry,
						"entry_min":   tradePlan.EntryZone.Min,
						"entry_max":   tradePlan.EntryZone.Max,
						"sl":          tradePlan.StopLoss,
						"tp":          pickTakeProfit(tradePlan.TakeProfit),
						"lots":        lots,
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
					log.Printf("[AI] 📌 account=%s/%s | AI approve 挂单已发送 | side=%s lots=%.2f entry=%.2f order_type=%s confidence=%d expires=%s",
						accountID, symbol, side, lots, entry, orderType, tradePlan.Confidence, expiration.Format(time.RFC3339))
				}
			skipAIPending:
			}
		}
	}
```

**Step 4** — Add the `resolveAICurrentPrice` and `getH1Bars` helper methods:

```go
// resolveAICurrentPrice gets the current price from account state.
func resolveAICurrentPrice(accountID, symbol string, ctx context.Context, h *aiHandler) float64 {
	state, err := h.deps.Accounts.GetStateSymbol(ctx, accountID, symbol)
	if err != nil {
		return 0
	}
	if state.Tick.Bid > 0 && state.Tick.Ask > 0 {
		return (state.Tick.Bid + state.Tick.Ask) / 2
	}
	if state.Tick.Ask > 0 {
		return state.Tick.Ask
	}
	if state.Tick.Bid > 0 {
		return state.Tick.Bid
	}
	return 0
}

func (h aiHandler) getH1Bars(ctx context.Context, accountID, symbol string) []domain.Bar {
	state, err := h.deps.Accounts.GetStateSymbol(ctx, accountID, symbol)
	if err != nil {
		return nil
	}
	return state.Bars["H1"]
}
```

**Step 5** — Verify compilation:

```bash
cd /root/gold-bot && go build ./...
```

---

## Task 3.3: Add CommandStore FindPendingAI method

**File:**
- Modify: `internal/legacy/store.go` (or wherever CommandStore interface is defined)

**Step 1** — Add `FindPendingAI` to `CommandStore` interface:

```go
type CommandStore interface {
	// ... existing methods
	FindPendingAI(ctx context.Context, accountID, symbol, side string) (bool, error)
}
```

**Step 2** — Implement for SQLite store. Add to the appropriate implementation file:

```go
func (s *store) FindPendingAI(ctx context.Context, accountID, symbol, side string) (bool, error) {
	query := `SELECT COUNT(*) FROM commands WHERE account_id=? AND status='pending' AND 
	          JSON_EXTRACT(payload, '$.source')='ai_approve' AND 
	          JSON_EXTRACT(payload, '$.symbol')=? AND
	          JSON_EXTRACT(payload, '$.type')=? AND
	          (JSON_EXTRACT(payload, '$.expiration') IS NULL OR JSON_EXTRACT(payload, '$.expiration') > ?)`
	
	var count int
	err := s.db.GetContext(ctx, &count, query, accountID, symbol, side, time.Now().Unix())
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
```

**Step 3** — Verify compilation:

```bash
cd /root/gold-bot && go build ./...
```

---

## Task 3.4: Run tests and verify

**Step 1** — Run full test suite:

```bash
cd /root/gold-bot && go test ./internal/... -count=1 2>&1 | tail -30
```

**Step 2** — Run specific related tests:

```bash
cd /root/gold-bot && go test ./internal/api/... -v -count=1 2>&1
```

**Step 3** — Build production binary:

```bash
cd /root/gold-bot && go build -o /dev/null ./...
```

---

## Task 3.5: Update gold-analysis-agent analysis cycle

**File:**
- Modify: `gold-analysis-agent/src/agents/sr-analyst.ts`
- Modify: `gold-analysis-agent/src/agents/risk-manager.ts`

**Step 1** — In `sr-analyst.ts`, replace M5 cycle references with M15 or remove M5:

Find any code that specifies analysis cycles like `["M5", "M15", "H1", "H4"]` and change to `["M15", "H1", "H4"]`.

**Step 2** — In `risk-manager.ts`, same treatment for any M5 cycle references.

**Step 3** — Rebuild:

```bash
cd /root/gold-analysis-agent && npm run build
```

---

## Verification Checklist

- [ ] `go build ./...` passes without errors
- [ ] `go test ./internal/... -count=1` all pass
- [ ] Existing handleAIResult() risk command handling unchanged
- [ ] AI approve 命令正确生成 PENDING 命令，手数减半
- [ ] 4h expire time correctly set in payload
- [ ] Confidence < 70 时跳过
- [ ] 同 symbol+同方向已有 AI 挂单时跳过
- [ ] entry 偏离市价 > 3×ATR 时跳过
- [ ] gold-analysis-agent 不再使用 M5 周期

---

*Created: 2026-06-15*
