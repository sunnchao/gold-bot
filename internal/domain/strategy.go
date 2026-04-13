package domain

import "time"

type Bar struct {
	Time   string  `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume int64   `json:"volume,omitempty"`

	EMA20  float64 `json:"ema20,omitempty"`
	EMA50  float64 `json:"ema50,omitempty"`
	EMA200 float64 `json:"ema200,omitempty"`

	ATR        float64 `json:"atr,omitempty"`
	RSI        float64 `json:"rsi,omitempty"`
	MACD       float64 `json:"macd,omitempty"`
	MACDSignal float64 `json:"macd_signal,omitempty"`
	MACDHist   float64 `json:"macd_hist,omitempty"`
	ADX        float64 `json:"adx,omitempty"`

	BBUpper float64 `json:"bb_upper,omitempty"`
	BBLower float64 `json:"bb_lower,omitempty"`
	BBMid   float64 `json:"bb_mid,omitempty"`

	StochK float64 `json:"stoch_k,omitempty"`
	StochD float64 `json:"stoch_d,omitempty"`
}

type Position struct {
	Ticket    int64   `json:"ticket"`
	Type      string  `json:"type"`
	OpenPrice float64 `json:"open_price"`
	Lots      float64 `json:"lots"`
	Profit    float64 `json:"profit,omitempty"`
	Magic     int     `json:"magic,omitempty"`
}

type AnalysisSnapshot struct {
	AccountID    string           `json:"account_id"`
	CurrentPrice float64          `json:"current_price"`
	Bars         map[string][]Bar `json:"bars"`
	Positions    []Position       `json:"positions"`
}

type AnalysisLog struct {
	Level    string `json:"level"`
	Strategy string `json:"strategy"`
	Message  string `json:"msg"`
}

type StrategyScore struct {
	Strategy string  `json:"strategy"`
	Side     string  `json:"side"`
	Score    int     `json:"score"`
	Entry    float64 `json:"entry"`
	StopLoss float64 `json:"stop_loss"`
}

type Signal struct {
	Side          string          `json:"side"`
	Entry         float64         `json:"entry"`
	StopLoss      float64         `json:"stop_loss"`
	TP1           float64         `json:"tp1"`
	TP2           float64         `json:"tp2"`
	Score         int             `json:"score"`
	Strategy      string          `json:"strategy"`
	ATR           float64         `json:"atr,omitempty"`
	ATRMult       float64         `json:"atr_mult,omitempty"`
	AllStrategies []StrategyScore `json:"all_strategies,omitempty"`
}

type PositionAction string

const (
	PositionActionModify PositionAction = "MODIFY"
	PositionActionClose  PositionAction = "CLOSE"
)

type PositionCommand struct {
	Action PositionAction `json:"action"`
	Ticket int64          `json:"ticket"`
	Lots   float64        `json:"lots,omitempty"`
	NewSL  float64        `json:"new_sl,omitempty"`
	Reason string         `json:"reason"`
}

type PositionState struct {
	Ticket         int64     `json:"ticket"`
	TP1Hit         bool      `json:"tp1_hit"`
	TP2Hit         bool      `json:"tp2_hit"`
	MaxProfitATR   float64   `json:"max_profit_atr"`
	OpenTime       time.Time `json:"open_time"`
	LastModifyTime time.Time `json:"last_modify_time"`
	BEMoved        bool      `json:"be_moved"`
	BETriggerATR   float64   `json:"be_trigger_atr"`
}

type PositionSnapshot struct {
	CurrentPrice float64    `json:"current_price"`
	CurrentATR   float64    `json:"current_atr"`
	H1Bars       []Bar      `json:"h1_bars"`
	Positions    []Position `json:"positions"`
}
