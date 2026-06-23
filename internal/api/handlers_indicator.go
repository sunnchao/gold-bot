package api

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// IndicatorAlert represents a divergence/harmonic alert to be displayed on EA chart
type IndicatorAlert struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`        // "divergence" | "harmonic"
	Indicator   string  `json:"indicator"`   // "macd" | "rsi" | "butterfly" | ...
	Direction   string  `json:"direction"`   // "bullish" | "bearish"
	Symbol      string  `json:"symbol"`
	Timeframe   string  `json:"timeframe"`
	Time        string  `json:"time"`
	Price       float64 `json:"price"`
	Strength    string  `json:"strength"`    // "strong" | "moderate" | "weak"
	Confidence  float64 `json:"confidence"`  // 0.0 ~ 1.0
	Description string  `json:"description"`
	// For divergence indicators
	MACDDivergence string `json:"macd_divergence,omitempty"` // "bullish" | "bearish"
	RSIDivergence  string `json:"rsi_divergence,omitempty"`  // "bullish" | "bearish"
}

// AlertCache manages indicator alerts with deduplication
type AlertCache struct {
	alerts map[string]*AlertEntry // key: symbol+indicator+direction
	mu     sync.RWMutex
}

type AlertEntry struct {
	Alert      IndicatorAlert
	CreatedAt  time.Time
	LastSentAt time.Time
	Count      int
}

// NewAlertCache creates a new alert cache
func NewAlertCache() *AlertCache {
	return &AlertCache{
		alerts: make(map[string]*AlertEntry),
	}
}

// Add adds or updates an alert. Returns true if the alert should be sent (new or 4h+ old).
func (c *AlertCache) Add(alert IndicatorAlert) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := alert.Symbol + "_" + alert.Indicator + "_" + alert.Direction
	now := time.Now()

	if entry, exists := c.alerts[key]; exists {
		// Same alert exists, check if 4 hours have passed
		if now.Sub(entry.LastSentAt) >= 4*time.Hour {
			c.alerts[key] = &AlertEntry{
				Alert:      alert,
				CreatedAt:  entry.CreatedAt,
				LastSentAt: now,
				Count:      entry.Count + 1,
			}
			return true
		}
		return false
	}

	// New alert
	c.alerts[key] = &AlertEntry{
		Alert:      alert,
		CreatedAt:  now,
		LastSentAt: now,
		Count:      1,
	}
	return true
}

// GetRecent returns all recent alerts (within last 4 hours)
func (c *AlertCache) GetRecent() []IndicatorAlert {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var recent []IndicatorAlert
	cutoff := time.Now().Add(-4 * time.Hour)
	for _, entry := range c.alerts {
		if entry.LastSentAt.After(cutoff) {
			recent = append(recent, entry.Alert)
		}
	}
	return recent
}

// IndicatorAlertHandler handles indicator alert endpoints
type IndicatorAlertHandler struct {
	cache *AlertCache
}

func newIndicatorAlertHandler() *IndicatorAlertHandler {
	return &IndicatorAlertHandler{
		cache: NewAlertCache(),
	}
}

// PublishAlert publishes an alert to be sent to EAs
func (h *IndicatorAlertHandler) PublishAlert(alert IndicatorAlert) bool {
	return h.cache.Add(alert)
}

// pollHandler handles the /indicator_alert/poll endpoint for EA polling
func (h *IndicatorAlertHandler) pollHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": "ERROR", "message": "method not allowed"})
		return
	}

	var req struct {
		AccountID string `json:"account_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid json"})
		return
	}

	alerts := h.cache.GetRecent()
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"count":  len(alerts),
		"alerts": alerts,
	})
}

// alertStoreHandler handles the /indicator_alert/store endpoint for internal publishing
func (h *IndicatorAlertHandler) alertStoreHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"status": "ERROR", "message": "method not allowed"})
		return
	}

	var alert IndicatorAlert
	if err := json.NewDecoder(r.Body).Decode(&alert); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid json"})
		return
	}

	shouldSend := h.cache.Add(alert)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"should_send": shouldSend,
	})
}
