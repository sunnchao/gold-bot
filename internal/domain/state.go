package domain

import "encoding/json"

type TickSnapshot struct {
	Symbol string  `json:"symbol"`
	Bid    float64 `json:"bid"`
	Ask    float64 `json:"ask"`
	Spread float64 `json:"spread"`
	Time   string  `json:"time"`
}

type AccountState struct {
	AccountID       string            `json:"account_id"`
	Tick            TickSnapshot      `json:"tick"`
	Bars            map[string][]Bar  `json:"bars"`
	Positions       []Position        `json:"positions"`
	StrategyMapping map[string]string `json:"strategy_mapping"`
	AIResultJSON    json.RawMessage   `json:"ai_result_json"`
}

type TokenRecord struct {
	Token    string   `json:"token"`
	Name     string   `json:"name"`
	Accounts []string `json:"accounts"`
	IsAdmin  bool     `json:"is_admin"`
}
