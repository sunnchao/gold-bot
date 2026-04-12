package domain

import "time"

type Account struct {
	AccountID   string
	Broker      string
	ServerName  string
	AccountName string
	AccountType string
	Currency    string
	Leverage    int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type AccountRuntime struct {
	AccountID       string
	Connected       bool
	Balance         float64
	Equity          float64
	Margin          float64
	FreeMargin      float64
	MarketOpen      bool
	IsTradeAllowed  bool
	MT4ServerTime   string
	LastHeartbeatAt time.Time
	LastTickAt      time.Time
	UpdatedAt       time.Time
}
