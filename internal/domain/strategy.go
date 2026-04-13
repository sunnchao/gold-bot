package domain

import (
	"bytes"
	"encoding/json"
	"strconv"
	"time"
)

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

func (b *Bar) UnmarshalJSON(data []byte) error {
	type rawBar struct {
		Time   json.RawMessage `json:"time"`
		Open   float64         `json:"open"`
		High   float64         `json:"high"`
		Low    float64         `json:"low"`
		Close  float64         `json:"close"`
		Volume int64           `json:"volume,omitempty"`

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

	var raw rawBar
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	*b = Bar{
		Open:       raw.Open,
		High:       raw.High,
		Low:        raw.Low,
		Close:      raw.Close,
		Volume:     raw.Volume,
		EMA20:      raw.EMA20,
		EMA50:      raw.EMA50,
		EMA200:     raw.EMA200,
		ATR:        raw.ATR,
		RSI:        raw.RSI,
		MACD:       raw.MACD,
		MACDSignal: raw.MACDSignal,
		MACDHist:   raw.MACDHist,
		ADX:        raw.ADX,
		BBUpper:    raw.BBUpper,
		BBLower:    raw.BBLower,
		BBMid:      raw.BBMid,
		StochK:     raw.StochK,
		StochD:     raw.StochD,
	}

	if len(raw.Time) == 0 || bytes.Equal(raw.Time, []byte("null")) {
		return nil
	}

	if raw.Time[0] == '"' {
		return json.Unmarshal(raw.Time, &b.Time)
	}

	var unixSeconds int64
	if err := json.Unmarshal(raw.Time, &unixSeconds); err == nil {
		b.Time = strconv.FormatInt(unixSeconds, 10)
		return nil
	}

	var unixFloat float64
	if err := json.Unmarshal(raw.Time, &unixFloat); err == nil {
		b.Time = strconv.FormatInt(int64(unixFloat), 10)
		return nil
	}

	return json.Unmarshal(raw.Time, &b.Time)
}

type Position struct {
	Ticket    int64   `json:"ticket"`
	Symbol    string  `json:"symbol,omitempty"`
	Type      string  `json:"type"`
	Lots      float64 `json:"lots"`
	OpenPrice float64 `json:"open_price"`
	SL        float64 `json:"sl,omitempty"`
	TP        float64 `json:"tp,omitempty"`
	Profit    float64 `json:"profit,omitempty"`
	OpenTime  int64   `json:"open_time,omitempty"`
	Comment   string  `json:"comment,omitempty"`
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
