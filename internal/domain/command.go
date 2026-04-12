package domain

import (
	"encoding/json"
	"time"
)

type CommandStatus string

const (
	CommandStatusPending   CommandStatus = "pending"
	CommandStatusDelivered CommandStatus = "delivered"
	CommandStatusAcked     CommandStatus = "acked"
	CommandStatusFailed    CommandStatus = "failed"
)

type CommandAction string

const (
	CommandActionSignal       CommandAction = "SIGNAL"
	CommandActionModify       CommandAction = "MODIFY"
	CommandActionClose        CommandAction = "CLOSE"
	CommandActionClosePartial CommandAction = "CLOSE_PARTIAL"
	CommandActionCloseAll     CommandAction = "CLOSE_ALL"
	CommandActionOpen         CommandAction = "OPEN"
	CommandActionAdd          CommandAction = "ADD"
)

type Command struct {
	CommandID   string
	AccountID   string
	Action      CommandAction
	Payload     map[string]any
	Status      CommandStatus
	CreatedAt   time.Time
	DeliveredAt time.Time
	AckedAt     time.Time
	FailedAt    time.Time
}

func (c Command) PayloadForPoll() map[string]any {
	payload := make(map[string]any, len(c.Payload)+2)
	for key, value := range c.Payload {
		payload[key] = value
	}
	payload["command_id"] = c.CommandID
	payload["action"] = string(c.Action)
	return payload
}

func (c Command) PayloadJSON() ([]byte, error) {
	return json.Marshal(c.PayloadForPoll())
}

type CommandResult struct {
	CommandID string
	AccountID string
	Result    string
	Ticket    int64
	ErrorText string
	CreatedAt time.Time
}
