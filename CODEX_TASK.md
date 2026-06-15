# CODEX TASK: AI Signal Pending Order (Phase 3)

## Mission

Add AI approve → PENDING command execution path to gold-bot. When gold-analysis-agent sends a trade_plan with mode="approve" via /api/v2/ai_result, generate a PENDING order command instead of just saving it to DB.

## Architecture Context

**Two existing order paths:**
1. **Strategy Engine (passive)**: EA pushes /bars → Analyze() → SIGNAL command → EA poll → ExecuteSignal()
2. **AI Risk (active)**: AI POST /api/v2/ai_result → only handles close_partial/close_all/close_short

**New path (this task):** AI approve → direct PENDING command → EA poll → ExecutePending()

**Key files:**
- `internal/api/router.go` — CommandStore interface (add FindPendingAI)
- `internal/api/handlers_ai.go` — handleAIResult() function (MAIN CHANGE)
- `internal/store/sqlite/commands.go` — CommandRepository implementation
- `internal/store/sqlite/dialect.go` — ph() / pgText() helpers
- `internal/domain/trade_plan.go` — TradePlan struct with EntryZone, MaxLots, Confidence etc.
- `internal/domain/command.go` — Command types (CommandActionSignal etc.)
- `internal/strategy/riskgate/gate.go` — RiskGate Evaluate() function

## Requirements

1. **Export OrderTypeForSignal** in internal/legacy package (currently unexported in live_trading.go)
2. **Add FindPendingAI** to api.CommandStore interface + sqlite implementation
3. **In handleAIResult()**, after risk command handling (line 228), add AI approve → PENDING logic
4. **Hands-off protection**: 
   - RiskGate must pass (not rejected)
   - Confidence >= 70
   - Check no existing AI pending order for same symbol+direction
   - Entry price deviation > 3×ATR → reject
   - Lots < 0.01 → reject
5. **Hands-off formula**: lots = Ceil(maxLots * 0.5 / 0.01) * 0.01
6. **Entry price**: (entry_zone.min + entry_zone.max) / 2
7. **Order type**: reuse existing OrderTypeForSignal(entry, currentPrice, atr, side)
8. **Expiration**: 4 hours from now
9. **Source tag**: payload.source = "ai_approve"

## IMPORTANT NOTES

- DO NOT modify the strategy engine (engine.go, config.go, live_trading.go analysis logic)
- DO NOT modify the EA (MQL4) code
- The existing risk command handling (close_partial/close_all/close_short) must remain unchanged
- All values in the command payload must be populated correctly for EA ExecutePending() to work
- Use the `ph()` and `pgText()` helpers from dialect.go for SQL queries (PostgreSQL compatibility)
- Use `math.Ceil()` for the lots formula
- ALL PRICE FLOATS should be rounded to 2 decimal places with math.Round(price*100)/100

## Task Steps

### Step 1: Export OrderTypeForSignal

In `internal/legacy/live_trading.go`, rename `orderTypeForSignal` to `OrderTypeForSignal` (capitalized).
Add a comment explaining this is used by both live trading and AI approve paths.
Update the internal caller (line 218) to use the new name.

### Step 2: Add FindPendingAI to CommandStore interface

In `internal/api/router.go`, add to the CommandStore interface:

```go
type CommandStore interface {
    Enqueue(ctx context.Context, command domain.Command) error
    FindPendingAI(ctx context.Context, accountID, symbol, side string) (bool, error)
}
```

### Step 3: Implement FindPendingAI in sqlite

In `internal/store/sqlite/commands.go`, add:

```go
func (r *CommandRepository) FindPendingAI(ctx context.Context, accountID, symbol, side string) (bool, error) {
    // SQL: SELECT COUNT(*) FROM commands 
    // WHERE account_id=? AND status='pending'
    // AND json_extract(payload_json, '$.source')='ai_approve'
    // AND json_extract(payload_json, '$.symbol')=?
    // AND json_extract(payload_json, '$.type')=?
    // AND (json_extract(payload_json, '$.expiration') IS NULL OR json_extract(payload_json, '$.expiration') > ?)
    // Use ph() for parameter placeholders
    var count int
    query := `SELECT COUNT(*) FROM commands WHERE account_id=` + ph(1) + pgText() + ` AND status=` + ph(2) + pgText() + ` AND json_extract(payload_json, '$.source')='ai_approve' AND json_extract(payload_json, '$.symbol')=` + ph(3) + pgText() + ` AND json_extract(payload_json, '$.type')=` + ph(4) + pgText() + ` AND (json_extract(payload_json, '$.expiration') IS NULL OR json_extract(payload_json, '$.expiration') > ` + ph(5) + `)`
    err := r.db.QueryRowContext(ctx, query, accountID, string(domain.CommandStatusPending), symbol, strings.ToUpper(side), time.Now().Unix()).Scan(&count)
    if err != nil {
        return false, err
    }
    return count > 0, nil
}
```

Add required imports: "strings" and "time" if not already imported.

### Step 4: Add AI approve logic to handlers_ai.go

In `internal/api/handlers_ai.go`:

1. Add import for "math" and "gold-bot/internal/legacy"

2. After the `shouldQueueRiskCommand` function (around line 427), add these helper functions:

```go
// shouldQueueAIPending checks whether to generate a PENDING order from AI trade_plan.
func shouldQueueAIPending(plan *domain.TradePlan, gate riskgate.Result) bool {
    if plan == nil { return false }
    if plan.Mode != "approve" { return false }
    if plan.Side != "buy" && plan.Side != "sell" { return false }
    if gate.Status == riskgate.StatusRejected { return false }
    if plan.Confidence < 70 { return false }
    return true
}

// calcAILots reduces trade plan max lots by half, rounded up to 0.01 step.
func calcAILots(maxLots float64) float64 {
    if maxLots <= 0 { return 0 }
    half := maxLots * 0.5
    lots := math.Ceil(half/0.01) * 0.01
    if lots < 0.01 { return 0 }
    return lots
}

// pickEntryPrice returns the midpoint of an entry zone.
func pickEntryPrice(zone domain.TradePlanEntryZone) float64 {
    if zone.Min <= 0 || zone.Max <= 0 { return 0 }
    if zone.Min == zone.Max { return zone.Min }
    return (zone.Min + zone.Max) / 2
}

// pickTakeProfit returns the first positive TP target.
func pickTakeProfit(tp []float64) float64 {
    for _, v := range tp {
        if v > 0 { return v }
    }
    return 0
}
```

3. Add the AI approve command generation block at the end of `handleAIResult()`, AFTER line 228 (after the existing risk command handling block's closing brace `}`):

Find the exact line where the existing risk command block ends (around line 227-228, it's the closing `}` of the `if shouldQueueRiskCommand...` block that starts at line 164). Insert AFTER this closing brace but BEFORE the response building (line 230 that starts with `response := map[string]any{...}`).

The logic should be:

```go
// === AI approve → PENDING 挂单 ===
if shouldQueueAIPending(tradePlan, riskGateResult) {
    // Get current price
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
            } else if hasExisting, err := h.deps.Commands.FindPendingAI(r.Context(), accountID, symbol, tradePlan.Side); err == nil && hasExisting {
                log.Printf("[AI] ⏭️ account=%s/%s | AI approve 跳过: 已有活跃AI挂单 side=%s",
                    accountID, symbol, tradePlan.Side)
            } else if err != nil {
                log.Printf("[AI] ⚠️ account=%s/%s | 检查AI挂单失败: %v", accountID, symbol, err)
            } else {
                // Price reasonability: reject if entry deviates > 3×ATR
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
                    "entry_min":   tradePlan.EntryZone.Min,
                    "entry_max":   tradePlan.EntryZone.Max,
                    "sl":          math.Round(tradePlan.StopLoss*100) / 100,
                    "tp":          math.Round(tp*100) / 100,
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
        }
    }
}
afterAIPending:
```

### Step 5: Add goto label

Since Go doesn't have a clean "skip" in nested ifs, use a simple label `afterAIPending:` at the end of the AI approve block (as shown above). Place it right before the `}` of the `else` chain.

### Step 6: Verify compilation

```bash
cd /root/gold-bot && go build ./...
```

### Step 7: Run tests

```bash
cd /root/gold-bot && go test ./internal/api/... -v -count=1 2>&1 | head -30
cd /root/gold-bot && go test ./internal/store/sqlite/... -v -count=1 2>&1 | head -30
cd /root/gold-bot && go test ./internal/... -count=1 2>&1 | tail -20
```

## DANGER ZONES / Pitfalls

1. **The `goto` label** must be valid Go syntax. It must be at the same block level. If you restructure the logic differently (e.g., using early returns), make sure you don't skip the response writing at the end of handleAIResult().

2. **The `ph()` and `pgText()` helpers** are from `internal/store/sqlite/dialect.go` and are used in the sqlite CommandRepository. Make sure the FindPendingAI SQL uses them correctly.

3. **JSON path extraction in SQLite** uses `json_extract(payload_json, '$.source')`. For PostgreSQL compatibility this should be `payload_json->>'source'`, but since this is the sqlite store, use the sqlite syntax. The db.go handles dialect switching.

4. **The `attachTradePlanCommandMetadata` function** is defined in handlers_ai.go and attaches decision_id/trade_plan_mode/risk_gate to the payload. Call it after building the payload.

5. **The existing risk command block** starts at line 164 with `if shouldQueueRiskCommand(payload) && riskGateAllowsCommand(tradePlan, riskGateResult) {` and ends around line 228. Make sure your addition goes AFTER the `}` of this block but BEFORE `response := map[string]any{...}` on line 230.

## Success Criteria

- [ ] `go build ./...` passes
- [ ] `go test ./internal/... -count=1` all pass (including existing tests)
- [ ] When AI sends trade_plan with mode=approve, confidence>=70, a PENDING command is enqueued
- [ ] Lots are halved per the formula
- [ ] Expiration is set to 4 hours
- [ ] source=ai_approve tag is present in payload
- [ ] Existing risk command handling (close_partial/close_all/close_short) still works identically
