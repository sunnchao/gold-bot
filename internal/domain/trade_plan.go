package domain

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const TradePlanSchemaVersion = "trade_plan.v1"

type TradePlanEntryZone struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type TradePlan struct {
	SchemaVersion string             `json:"schema_version"`
	DecisionID    string             `json:"decision_id"`
	AccountID     string             `json:"account_id"`
	Symbol        string             `json:"symbol"`
	Mode          string             `json:"mode"`
	Side          string             `json:"side"`
	Confidence    int                `json:"confidence"`
	EntryZone     TradePlanEntryZone `json:"entry_zone"`
	StopLoss      float64            `json:"stop_loss"`
	TakeProfit    []float64          `json:"take_profit"`
	MaxLots       float64            `json:"max_lots"`
	ExpiresAt     time.Time          `json:"expires_at"`
	ReasonCodes   []string           `json:"reason_codes"`
	Conflicts     []string           `json:"conflicts"`
	Narrative     string             `json:"narrative"`
	AddOn         bool               `json:"add_on"`
}

type TradePlanSummary struct {
	DecisionID string `json:"decision_id"`
	Mode       string `json:"mode"`
	Symbol     string `json:"symbol"`
	Confidence int    `json:"confidence"`
}

func ParseTradePlan(data json.RawMessage, expectedAccountID, expectedSymbol string) (*TradePlan, error) {
	if len(data) == 0 || string(data) == "null" {
		return nil, fmt.Errorf("trade_plan is empty")
	}

	var plan TradePlan
	if err := json.Unmarshal(data, &plan); err != nil {
		return nil, fmt.Errorf("decode trade_plan: %w", err)
	}
	if err := plan.Validate(expectedAccountID, expectedSymbol); err != nil {
		return nil, err
	}
	return &plan, nil
}

func (p TradePlan) Validate(expectedAccountID, expectedSymbol string) error {
	if p.SchemaVersion != TradePlanSchemaVersion {
		return fmt.Errorf("trade_plan.schema_version = %q, want %q", p.SchemaVersion, TradePlanSchemaVersion)
	}
	if p.DecisionID == "" {
		return fmt.Errorf("trade_plan.decision_id is required")
	}
	if p.AccountID == "" {
		return fmt.Errorf("trade_plan.account_id is required")
	}
	if expectedAccountID != "" && p.AccountID != expectedAccountID {
		return fmt.Errorf("trade_plan.account_id = %q, want %q", p.AccountID, expectedAccountID)
	}
	if p.Symbol == "" {
		return fmt.Errorf("trade_plan.symbol is required")
	}
	if expectedSymbol != "" && !strings.EqualFold(p.Symbol, expectedSymbol) {
		return fmt.Errorf("trade_plan.symbol = %q, want %q", p.Symbol, expectedSymbol)
	}
	if !validTradePlanMode(p.Mode) {
		return fmt.Errorf("trade_plan.mode = %q is invalid", p.Mode)
	}
	if !validTradePlanSide(p.Side) {
		return fmt.Errorf("trade_plan.side = %q is invalid", p.Side)
	}
	if p.Confidence < 0 || p.Confidence > 100 {
		return fmt.Errorf("trade_plan.confidence = %d, want 0..100", p.Confidence)
	}
	if p.ExpiresAt.IsZero() {
		return fmt.Errorf("trade_plan.expires_at is required")
	}
	if len(p.ReasonCodes) == 0 {
		return fmt.Errorf("trade_plan.reason_codes must not be empty")
	}
	for _, code := range p.ReasonCodes {
		if strings.TrimSpace(code) == "" {
			return fmt.Errorf("trade_plan.reason_codes contains an empty code")
		}
	}
	if strings.TrimSpace(p.Narrative) == "" {
		return fmt.Errorf("trade_plan.narrative is required")
	}

	// add_on is optional and intentionally not validated; absent JSON maps to false.
	if p.Mode == "observe" || p.Mode == "veto" {
		return nil
	}
	if p.Side == "none" {
		return fmt.Errorf("active trade_plan.side must be buy or sell")
	}
	if p.EntryZone.Min <= 0 || p.EntryZone.Max <= 0 {
		return fmt.Errorf("active trade_plan.entry_zone must be positive")
	}
	if p.EntryZone.Min > p.EntryZone.Max {
		return fmt.Errorf("trade_plan.entry_zone.min must be <= max")
	}
	if p.StopLoss <= 0 {
		return fmt.Errorf("active trade_plan.stop_loss must be positive")
	}
	if len(p.TakeProfit) == 0 {
		return fmt.Errorf("active trade_plan.take_profit must not be empty")
	}
	for _, target := range p.TakeProfit {
		if target <= 0 {
			return fmt.Errorf("active trade_plan.take_profit must contain only positive values")
		}
	}
	if p.MaxLots <= 0 {
		return fmt.Errorf("active trade_plan.max_lots must be positive")
	}
	return nil
}

func (p TradePlan) Summary() TradePlanSummary {
	return TradePlanSummary{
		DecisionID: p.DecisionID,
		Mode:       p.Mode,
		Symbol:     p.Symbol,
		Confidence: p.Confidence,
	}
}

func validTradePlanMode(mode string) bool {
	switch mode {
	case "observe", "veto", "approve", "modify", "reduce", "close":
		return true
	default:
		return false
	}
}

func validTradePlanSide(side string) bool {
	switch side {
	case "buy", "sell", "none":
		return true
	default:
		return false
	}
}
