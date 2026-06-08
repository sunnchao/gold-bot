package domain

import "time"

type DecisionStage string

const (
	DecisionStageCandidateSignal  DecisionStage = "candidate_signal"
	DecisionStageAIResult         DecisionStage = "ai_result"
	DecisionStageRiskGate         DecisionStage = "risk_gate"
	DecisionStageCommandEnqueued  DecisionStage = "command_enqueued"
	DecisionStageCommandDelivered DecisionStage = "command_delivered"
	DecisionStageOrderResult      DecisionStage = "order_result"
)

type DecisionStatus string

const (
	DecisionStatusPending   DecisionStatus = "pending"
	DecisionStatusAccepted  DecisionStatus = "accepted"
	DecisionStatusRejected  DecisionStatus = "rejected"
	DecisionStatusClamped   DecisionStatus = "clamped"
	DecisionStatusDelivered DecisionStatus = "delivered"
	DecisionStatusAcked     DecisionStatus = "acked"
	DecisionStatusFailed    DecisionStatus = "failed"
)

type DecisionEvent struct {
	ID               int64          `json:"id"`
	DecisionID       string         `json:"decision_id"`
	AccountID        string         `json:"account_id"`
	Symbol           string         `json:"symbol"`
	Stage            DecisionStage  `json:"stage"`
	Status           DecisionStatus `json:"status"`
	ReasonCodes      []string       `json:"reason_codes"`
	Summary          map[string]any `json:"summary"`
	RelatedCommandID string         `json:"related_command_id"`
	CreatedAt        time.Time      `json:"created_at"`
}

type DecisionEventFilter struct {
	AccountID string
	Symbol    string
	Status    DecisionStatus
	Limit     int
}
