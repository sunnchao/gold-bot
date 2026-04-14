package domain

import "time"

// PendingSignal represents a signal awaiting arbitration before execution.
type PendingSignal struct {
	ID                 int64     `json:"id"`
	AccountID          string    `json:"account_id"`
	Symbol             string    `json:"symbol"`
	Side               string    `json:"side"`
	Score              int       `json:"score"`
	Strategy           string    `json:"strategy"`
	Indicators         string    `json:"indicators"`
	Status             string    `json:"status"` // pending, approved, rejected, timeout
	CreatedAt          time.Time `json:"created_at"`
	ExpiresAt          time.Time `json:"expires_at"`
	ArbitrationResult  string    `json:"arbitration_result"`
	ArbitrationReason  string    `json:"arbitration_reason"`
}
