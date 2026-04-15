package scheduler

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/engine"
	"gold-bot/internal/strategy/indicator"
	"gold-bot/internal/strategy/positionmgr"
)

type ReplaySnapshot struct {
	AccountID      string                  `json:"account_id"`
	Symbol         string                  `json:"symbol,omitempty"`
	AnalysisTime   time.Time               `json:"analysis_time"`
	CurrentPrice   float64                 `json:"current_price"`
	Bars           map[string][]domain.Bar `json:"bars"`
	Positions      []domain.Position       `json:"positions"`
	PositionStates []domain.PositionState  `json:"position_states"`
}

type ReplayResult struct {
	Signal           *domain.Signal           `json:"signal"`
	Logs             []domain.AnalysisLog     `json:"logs"`
	PositionCommands []domain.PositionCommand `json:"position_commands"`
}

func RunReplayFromFile(path string) (ReplayResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ReplayResult{}, fmt.Errorf("read replay snapshot %s: %w", path, err)
	}

	var snapshot ReplaySnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return ReplayResult{}, fmt.Errorf("decode replay snapshot %s: %w", path, err)
	}

	return RunReplay(snapshot)
}

func RunReplay(snapshot ReplaySnapshot) (ReplayResult, error) {
	enriched := make(map[string][]domain.Bar, len(snapshot.Bars))
	for timeframe, bars := range snapshot.Bars {
		enriched[timeframe] = indicator.EnrichBars(bars)
	}

	currentPrice := snapshot.CurrentPrice
	if currentPrice == 0 {
		if h1 := enriched["H1"]; len(h1) > 0 {
			currentPrice = h1[len(h1)-1].Close
		}
	}

	analyzer := engine.New()
	signal, logs := analyzer.Analyze(domain.AnalysisSnapshot{
		AccountID:    snapshot.AccountID,
		CurrentPrice: currentPrice,
		Bars:         enriched,
		Positions:    snapshot.Positions,
	})

	now := snapshot.AnalysisTime
	if now.IsZero() {
		now = time.Now().UTC()
	}
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	for _, state := range snapshot.PositionStates {
		manager.SeedState(state)
	}

	h1 := enriched["H1"]
	currentATR := 0.0
	avgATR := 0.0
	if len(h1) > 0 && !math.IsNaN(h1[len(h1)-1].ATR) {
		currentATR = h1[len(h1)-1].ATR
	}

	if len(h1) >= 25 {
		atrSum := 0.0
		atrCount := 0
		for _, bar := range h1[len(h1)-20:] {
			if !math.IsNaN(bar.ATR) && bar.ATR > 0 {
				atrSum += bar.ATR
				atrCount++
			}
		}
		if atrCount > 0 {
			avgATR = atrSum / float64(atrCount)
		}
	}

	positionCommands := manager.Analyze(domain.PositionSnapshot{
		AccountID:    snapshot.AccountID,
		Symbol:       snapshot.Symbol,
		CurrentPrice: currentPrice,
		CurrentATR:   currentATR,
		AvgATR:       avgATR,
		H1Bars:       h1,
		Positions:    snapshot.Positions,
	})

	return ReplayResult{
		Signal:           signal,
		Logs:             logs,
		PositionCommands: positionCommands,
	}, nil
}
