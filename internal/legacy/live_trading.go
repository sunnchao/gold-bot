package legacy

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"gold-bot/internal/domain"
	strategyengine "gold-bot/internal/strategy/engine"
	strategyindicator "gold-bot/internal/strategy/indicator"
)

type liveSignalAnalyzer interface {
	Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog)
}

type liveEngineAnalyzer struct {
	engine strategyengine.Engine
}

func (a liveEngineAnalyzer) Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog) {
	return a.engine.Analyze(snapshot)
}

type LiveTradingExecutor struct {
	accounts        AccountStore
	commands        CommandStore
	analyzerFactory func(symbol string) liveSignalAnalyzer
	now             func() time.Time
}

func NewLiveTradingExecutor(accounts AccountStore, commands CommandStore) *LiveTradingExecutor {
	return &LiveTradingExecutor{
		accounts: accounts,
		commands: commands,
		analyzerFactory: func(symbol string) liveSignalAnalyzer {
			return liveEngineAnalyzer{engine: strategyengine.NewForSymbol(symbol)}
		},
		now: time.Now,
	}
}

func (e *LiveTradingExecutor) OnBars(ctx context.Context, accountID, symbol, timeframe string) error {
	if e == nil || e.accounts == nil || e.commands == nil {
		return nil
	}
	if !isLiveStrategyTimeframe(timeframe) {
		return nil
	}
	return e.analyzeAndQueue(ctx, accountID, symbol, timeframe)
}

func (e *LiveTradingExecutor) OnPositions(ctx context.Context, accountID, symbol string) error {
	if e == nil || e.accounts == nil || e.commands == nil {
		return nil
	}
	return e.analyzeAndQueue(ctx, accountID, symbol, "positions")
}

func (e *LiveTradingExecutor) analyzeAndQueue(ctx context.Context, accountID, symbol, timeframe string) error {
	runtime, err := e.accounts.GetRuntime(ctx, accountID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get runtime for live trading %s: %w", accountID, err)
	}
	if !runtime.MarketOpen || !runtime.IsTradeAllowed {
		log.Printf("[STRATEGY] ⏭️ 跳过 live analysis account=%s symbol=%s tf=%s | market_open=%t trade_allowed=%t",
			accountID, symbol, timeframe, runtime.MarketOpen, runtime.IsTradeAllowed)
		return nil
	}

	state, err := e.accounts.GetStateSymbol(ctx, accountID, symbol)
	if err != nil {
		return fmt.Errorf("get account state for live trading %s/%s: %w", accountID, symbol, err)
	}

	snapshot := domain.AnalysisSnapshot{
		AccountID:    accountID,
		Symbol:       symbol,
		CurrentPrice: resolveLiveCurrentPrice(state),
		Bars:         enrichLiveBars(state.Bars),
		Positions:    filterPositionsForSymbol(symbol, state.Positions),
	}

	// 计算 ATR 用于止损调整判断
	atr := 0.0
	if h1Bars := snapshot.Bars["H1"]; len(h1Bars) > 0 {
		atr = h1Bars[len(h1Bars)-1].ATR
	}

	// Parse AI result for stop-loss override
	if len(state.AIResultJSON) > 2 && state.AIResultJSON[0] == '{' {
		var aiResult domain.AIResult
		if err := json.Unmarshal(state.AIResultJSON, &aiResult); err == nil {
			snapshot.AIResult = &aiResult
			if aiResult.SuggestedSL > 0 {
				log.Printf("[STRATEGY] 🤖 AI 止损可用: %.2f | account=%s/%s", aiResult.SuggestedSL, accountID, symbol)
			}
		} else {
			log.Printf("[STRATEGY] ⚠️ AI 结果解析失败: %v | account=%s/%s", err, accountID, symbol)
		}
	}

	analyzer := e.analyzerFactory
	if analyzer == nil {
		return nil
	}
	signal, logs := analyzer(symbol).Analyze(snapshot)
	for _, l := range logs {
		if l.Strategy == "动量剥头皮" || l.Strategy == "H4过滤" {
			log.Printf("[STRATEGY-SCALP] account=%s symbol=%s level=%s | %s", accountID, symbol, l.Level, l.Message)
		}
	}
	if signal == nil {
		// 没有新信号时，检查是否需要用 AI 止损调整现有持仓
		if snapshot.AIResult != nil && snapshot.AIResult.SuggestedSL > 0 && len(snapshot.Positions) > 0 {
			return e.checkAIStopLossAdjust(ctx, accountID, symbol, &snapshot, atr)
		}
		return nil
	}

	analysisMode := "bars"
	if strings.EqualFold(timeframe, "positions") {
		analysisMode = "positions"
	}
	command := e.buildSignalCommand(accountID, symbol, *signal, snapshot.Bars, analysisMode)
	if _, err := e.commands.Get(ctx, command.CommandID); err == nil {
		log.Printf("[STRATEGY] 🔁 duplicate live signal skipped account=%s symbol=%s strategy=%s command_id=%s",
			accountID, symbol, signal.Strategy, command.CommandID)
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check existing live command %s: %w", command.CommandID, err)
	}

	if err := e.commands.Enqueue(ctx, command); err != nil {
		if isDuplicateCommandErr(err) {
			return nil
		}
		return fmt.Errorf("enqueue live signal %s: %w", command.CommandID, err)
	}

	log.Printf("[STRATEGY] 🚀 queued live signal account=%s symbol=%s tf=%s strategy=%s side=%s score=%d command_id=%s",
		accountID, symbol, timeframe, signal.Strategy, signal.Side, signal.Score, command.CommandID)
	return nil
}

func (e *LiveTradingExecutor) buildSignalCommand(accountID, symbol string, signal domain.Signal, bars map[string][]domain.Bar, analysisMode string) domain.Command {
	createdAt := time.Now().UTC()
	if e.now != nil {
		createdAt = e.now().UTC()
	}
	if strings.TrimSpace(analysisMode) == "" {
		analysisMode = "bars"
	}
	decisionKey := liveDecisionKey(signal.Strategy, bars)
	commandID := buildStrategyCommandID(accountID, symbol, signal, decisionKey)
	return domain.Command{
		CommandID: commandID,
		AccountID: accountID,
		Action:    domain.CommandActionSignal,
		CreatedAt: createdAt,
		Payload: map[string]any{
			"symbol":       symbol,
			"type":         signal.Side,
			"entry":        signal.Entry,
			"sl":           signal.StopLoss,
			"tp1":          signal.TP1,
			"tp2":          signal.TP2,
			"score":        signal.Score,
			"strategy":     signal.Strategy,
			"atr":          signal.ATR,
			"trigger_key":  decisionKey,
			"source":       "live_strategy",
			"analysis_mode": analysisMode,
		},
	}
}

func buildStrategyCommandID(accountID, symbol string, signal domain.Signal, decisionKey string) string {
	seed := strings.Join([]string{
		accountID,
		strings.ToUpper(symbol),
		signal.Strategy,
		signal.Side,
		decisionKey,
	}, "|")
	sum := sha1.Sum([]byte(seed))
	return "live_" + hex.EncodeToString(sum[:8])
}

func isLiveStrategyTimeframe(timeframe string) bool {
	switch strings.ToUpper(timeframe) {
	case "H4", "H1", "M30", "M15", "M5", "M1":
		return true
	default:
		return false
	}
}

func resolveLiveCurrentPrice(state domain.AccountState) float64 {
	if state.Tick.Bid > 0 && state.Tick.Ask > 0 {
		return (state.Tick.Bid + state.Tick.Ask) / 2
	}
	if state.Tick.Ask > 0 {
		return state.Tick.Ask
	}
	if state.Tick.Bid > 0 {
		return state.Tick.Bid
	}
	for _, tf := range []string{"H1", "M15", "M5", "M1", "M30", "H4"} {
		bars := state.Bars[tf]
		if len(bars) == 0 {
			continue
		}
		return bars[len(bars)-1].Close
	}
	return 0
}

func enrichLiveBars(raw map[string][]domain.Bar) map[string][]domain.Bar {
	enriched := make(map[string][]domain.Bar, len(raw))
	for timeframe, bars := range raw {
		enriched[timeframe] = strategyindicator.EnrichBars(bars)
	}
	return enriched
}

func filterPositionsForSymbol(symbol string, positions []domain.Position) []domain.Position {
	if len(positions) == 0 {
		return nil
	}
	baseSymbol := domain.BaseSymbol(symbol)
	filtered := make([]domain.Position, 0, len(positions))
	for _, position := range positions {
		if position.Symbol == "" || domain.BaseSymbol(position.Symbol) == baseSymbol {
			filtered = append(filtered, position)
		}
	}
	return filtered
}

func liveDecisionKey(strategy string, bars map[string][]domain.Bar) string {
	switch strategy {
	case "momentum_scalp":
		return lastLiveBarRef(bars, "M1", "M5", "M15", "H1")
	default:
		return lastLiveBarRef(bars, "H1", "M15", "M5", "M30", "H4", "M1")
	}
}

func lastLiveBarRef(bars map[string][]domain.Bar, order ...string) string {
	for _, timeframe := range order {
		series := bars[timeframe]
		if len(series) == 0 {
			continue
		}
		last := series[len(series)-1]
		if strings.TrimSpace(last.Time) == "" {
			continue
		}
		return timeframe + ":" + last.Time
	}
	return "no-bars"
}

func isDuplicateCommandErr(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "unique") || strings.Contains(text, "duplicate") || strings.Contains(text, "primary key")
}

// checkAIStopLossAdjust 检查是否需要用 AI 止损调整现有持仓
func (e *LiveTradingExecutor) checkAIStopLossAdjust(ctx context.Context, accountID, symbol string, snapshot *domain.AnalysisSnapshot, atr float64) error {
	if atr <= 0 {
		log.Printf("[STRATEGY] ⚠️ ATR 无效，跳过止损调整 | account=%s/%s", accountID, symbol)
		return nil
	}

	aiSL := snapshot.AIResult.SuggestedSL
	positions := snapshot.Positions
	if len(positions) == 0 {
		return nil
	}

	// 只处理第一个持仓（通常只有一个）
	pos := positions[0]
	currentSL := pos.SL

	// 计算 AI 止损与当前止损的差距
	distance := math.Abs(aiSL - currentSL)
	threshold := 0.3 * atr // 差距超过 0.3 ATR 才调整

	if distance < threshold {
		log.Printf("[STRATEGY] 📊 AI 止损差距不足 (%.2f < %.2f ATR)，不调整 | account=%s/%s current=%.2f ai=%.2f",
			distance, threshold, accountID, symbol, currentSL, aiSL)
		return nil
	}

	// 生成 MODIFY 命令
	command := e.buildModifyCommand(accountID, symbol, pos, aiSL, distance, atr)
	if _, err := e.commands.Get(ctx, command.CommandID); err == nil {
		log.Printf("[STRATEGY] 🔁 重复 MODIFY 命令跳过 | account=%s/%s command_id=%s",
			accountID, symbol, command.CommandID)
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check existing modify command %s: %w", command.CommandID, err)
	}

	if err := e.commands.Enqueue(ctx, command); err != nil {
		if isDuplicateCommandErr(err) {
			return nil
		}
		return fmt.Errorf("enqueue modify command %s: %w", command.CommandID, err)
	}

	log.Printf("[STRATEGY] ✅ AI 止损调整已发送 | account=%s/%s ticket=%d current=%.2f -> ai=%.2f (%.2f 点)",
		accountID, symbol, pos.Ticket, currentSL, aiSL, distance)
	return nil
}

func (e *LiveTradingExecutor) buildModifyCommand(accountID, symbol string, pos domain.Position, newSL, distance, atr float64) domain.Command {
	createdAt := time.Now().UTC()
	if e.now != nil {
		createdAt = e.now().UTC()
	}
	// 唯一 ID 基于账户、品种、ticket 和时间戳（每分钟一个命令）
	seed := fmt.Sprintf("%s|%s|%d|%s", accountID, strings.ToUpper(symbol), pos.Ticket, createdAt.Format("200601021504"))
	sum := sha1.Sum([]byte(seed))
	commandID := "mod_" + hex.EncodeToString(sum[:8])

	return domain.Command{
		CommandID: commandID,
		AccountID: accountID,
		Action:    domain.CommandActionModify,
		CreatedAt: createdAt,
		Payload: map[string]any{
			"symbol":       symbol,
			"ticket":       pos.Ticket,
			"new_sl":       newSL,
			"sl":           newSL, // 兼容 EA 旧字段名
			"tp":           pos.TP, // 保持原 TP
			"old_sl":       pos.SL,
			"distance":     distance,
			"atr":          atr,
			"source":       "ai_stop_loss",
			"trigger_time": createdAt.Format(time.RFC3339),
		},
	}
}
