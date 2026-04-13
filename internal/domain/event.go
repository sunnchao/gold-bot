package domain

import (
	"encoding/json"
	"time"
)

type Event struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	AccountID string          `json:"account_id,omitempty"`
	Source    string          `json:"source"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

func (e Event) JSON() []byte {
	payload, _ := json.Marshal(e)
	return payload
}
