package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

// ArbitrationConfig holds configuration for the arbitration system.
type ArbitrationConfig struct {
	// MaxWaitTime is the maximum time to wait for arbitration before timeout
	MaxWaitTime time.Duration
	// TimeoutAutoPassScore is the minimum score required to auto-pass on timeout
	TimeoutAutoPassScore int
	// PollInterval is how often to check for arbitration results
	PollInterval time.Duration
}

// DefaultArbitrationConfig returns the default arbitration configuration.
func DefaultArbitrationConfig() ArbitrationConfig {
	return ArbitrationConfig{
		MaxWaitTime:          30 * time.Second,
		TimeoutAutoPassScore: 8,
		PollInterval:         1 * time.Second,
	}
}

// ArbitrationResult represents the result of an arbitration check.
type ArbitrationResult struct {
	SignalID int64
	Status   string // "approved", "rejected", "timeout"
	Reason   string
}

// ArbitrationManager manages the arbitration process for trading signals.
type ArbitrationManager struct {
	config ArbitrationConfig
	store  store.PendingSignalStore
	mu     sync.RWMutex
	// pendingSignals tracks signals waiting for arbitration
	pendingSignals map[int64]*pendingSignalInfo
}

type pendingSignalInfo struct {
	signal  *domain.PendingSignal
	result  chan ArbitrationResult
	created time.Time
}

// NewArbitrationManager creates a new arbitration manager.
func NewArbitrationManager(signalStore store.PendingSignalStore, config ...ArbitrationConfig) *ArbitrationManager {
	cfg := DefaultArbitrationConfig()
	if len(config) > 0 {
		cfg = config[0]
	}

	return &ArbitrationManager{
		config:         cfg,
		store:          signalStore,
		pendingSignals: make(map[int64]*pendingSignalInfo),
	}
}

// SubmitSignal submits a signal for arbitration and waits for the result.
// Returns true if the signal should be executed, false otherwise.
func (m *ArbitrationManager) SubmitSignal(ctx context.Context, accountID, symbol string, signal *domain.Signal) (bool, string, error) {
	// Create pending signal
	pendingSignal := &domain.PendingSignal{
		AccountID:  accountID,
		Symbol:     symbol,
		Side:       signal.Side,
		Score:      signal.Score,
		Strategy:   signal.Strategy,
		Status:     "pending",
		CreatedAt:  time.Now().UTC(),
		ExpiresAt:  time.Now().UTC().Add(5 * time.Minute), // 5 minute expiration
		Indicators: buildIndicatorsJSON(signal),
	}

	// Save to database
	if err := m.store.SavePendingSignal(ctx, pendingSignal); err != nil {
		return false, "", fmt.Errorf("save pending signal: %w", err)
	}

	log.Printf("[ARBITRATION] 📝 提交信号: %s/%s %s score=%d (ID=%d)", accountID, symbol, signal.Side, signal.Score, pendingSignal.ID)

	// Wait for arbitration result
	result := m.waitForArbitration(ctx, pendingSignal.ID, signal.Score)

	switch result.Status {
	case "approved":
		log.Printf("[ARBITRATION] ✅ 仲裁通过: %s/%s %s (ID=%d)", accountID, symbol, signal.Side, pendingSignal.ID)
		return true, result.Reason, nil
	case "rejected":
		log.Printf("[ARBITRATION] ❌ 仲裁拒绝: %s/%s %s reason=%s (ID=%d)", accountID, symbol, signal.Side, result.Reason, pendingSignal.ID)
		return false, result.Reason, nil
	case "timeout":
		// Timeout fallback: high score signals pass, low score signals are abandoned
		if signal.Score >= m.config.TimeoutAutoPassScore {
			log.Printf("[ARBITRATION] ⏰ 超时保底放行: %s/%s %s score=%d (ID=%d)", accountID, symbol, signal.Side, signal.Score, pendingSignal.ID)
			return true, "timeout_auto_pass", nil
		}
		log.Printf("[ARBITRATION] ⏰ 超时放弃: %s/%s %s score=%d (ID=%d)", accountID, symbol, signal.Side, signal.Score, pendingSignal.ID)
		return false, "timeout_abandoned", nil
	default:
		return false, "unknown", fmt.Errorf("unexpected arbitration status: %s", result.Status)
	}
}

// waitForArbitration polls for arbitration results.
func (m *ArbitrationManager) waitForArbitration(ctx context.Context, signalID int64, score int) ArbitrationResult {
	ticker := time.NewTicker(m.config.PollInterval)
	defer ticker.Stop()

	timeout := time.After(m.config.MaxWaitTime)

	for {
		select {
		case <-ctx.Done():
			return ArbitrationResult{
				SignalID: signalID,
				Status:   "timeout",
				Reason:   "context_cancelled",
			}
		case <-timeout:
			return ArbitrationResult{
				SignalID: signalID,
				Status:   "timeout",
				Reason:   "max_wait_exceeded",
			}
		case <-ticker.C:
			// Check arbitration result from database
			signals, err := m.store.GetPendingSignals(ctx, "", "") // Get all pending signals
			if err != nil {
				log.Printf("[ARBITRATION] ⚠️ 检查仲裁结果失败: %v", err)
				continue
			}

			for _, sig := range signals {
				if sig.ID == signalID {
					switch sig.Status {
					case "approved":
						return ArbitrationResult{
							SignalID: signalID,
							Status:   "approved",
							Reason:   sig.ArbitrationReason,
						}
					case "rejected":
						return ArbitrationResult{
							SignalID: signalID,
							Status:   "rejected",
							Reason:   sig.ArbitrationReason,
						}
					}
				}
			}
		}
	}
}

// UpdateArbitrationResult updates the arbitration result for a signal.
func (m *ArbitrationManager) UpdateArbitrationResult(ctx context.Context, signalID int64, result, reason string) error {
	return m.store.UpdateArbitration(ctx, signalID, result, reason)
}

// ExpireStaleSignals marks expired signals as timeout.
func (m *ArbitrationManager) ExpireStaleSignals(ctx context.Context) error {
	return m.store.ExpireStaleSignals(ctx)
}

// GetPendingSignals returns pending signals for a specific account and symbol.
func (m *ArbitrationManager) GetPendingSignals(ctx context.Context, accountID, symbol string) ([]domain.PendingSignal, error) {
	return m.store.GetPendingSignals(ctx, accountID, symbol)
}

// buildIndicatorsJSON creates a JSON string from signal indicators.
func buildIndicatorsJSON(signal *domain.Signal) string {
	data := map[string]interface{}{
		"side":      signal.Side,
		"entry":     signal.Entry,
		"stop_loss": signal.StopLoss,
		"tp1":       signal.TP1,
		"tp2":       signal.TP2,
		"score":     signal.Score,
		"strategy":  signal.Strategy,
		"atr":       signal.ATR,
	}

	if len(signal.AllStrategies) > 0 {
		data["all_strategies"] = signal.AllStrategies
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return "{}"
	}
	return string(jsonData)
}
