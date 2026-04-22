package legacy

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
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
