package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseTradePlanDefaultsAddOnToFalseWhenAbsent(t *testing.T) {
	raw := json.RawMessage(`{
		"schema_version":"trade_plan.v1",
		"decision_id":"tpv1_default_add_on",
		"account_id":"90011087",
		"symbol":"XAUUSD",
		"mode":"approve",
		"side":"buy",
		"confidence":80,
		"entry_zone":{"min":3335.5,"max":3335.7},
		"stop_loss":3328.0,
		"take_profit":[3350.0],
		"max_lots":0.1,
		"expires_at":"2026-06-18T10:00:00Z",
		"reason_codes":["mode.approve","side.buy"],
		"conflicts":[],
		"narrative":"default add_on should be false"
	}`)

	plan, err := ParseTradePlan(raw, "90011087", "XAUUSD")
	if err != nil {
		t.Fatalf("ParseTradePlan returned error: %v", err)
	}
	if plan.AddOn {
		t.Fatal("AddOn = true, want false when field is absent")
	}
}

func TestTradePlanValidateAllowsExplicitAddOn(t *testing.T) {
	plan := TradePlan{
		SchemaVersion: TradePlanSchemaVersion,
		DecisionID:    "tpv1_add_on_true",
		AccountID:     "90011087",
		Symbol:        "XAUUSD",
		Mode:          "approve",
		Side:          "buy",
		Confidence:    75,
		EntryZone:     TradePlanEntryZone{Min: 3335.5, Max: 3335.7},
		StopLoss:      3328.0,
		TakeProfit:    []float64{3350.0},
		MaxLots:       0.1,
		ExpiresAt:     time.Date(2026, time.June, 18, 10, 0, 0, 0, time.UTC),
		ReasonCodes:   []string{"mode.approve", "side.buy"},
		Conflicts:     []string{},
		Narrative:     "explicit add_on should be accepted",
		AddOn:         true,
	}

	if err := plan.Validate("90011087", "XAUUSD"); err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
}
