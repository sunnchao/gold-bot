package aurex

import (
	"math"
	"strconv"
	"strings"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/engine"
	"gold-bot/internal/strategy/indicator"
	"gold-bot/internal/strategy/marketfilter"
)

type AnalysisPayload struct {
	Status          string                    `json:"status"`
	Timestamp       string                    `json:"timestamp"`
	Account         AccountSummary            `json:"account"`
	Market          domain.TickSnapshot       `json:"market"`
	Positions       []PositionSummary         `json:"positions"`
	Indicators      map[string]*IndicatorPack `json:"indicators"`
	Bars            map[string][]domain.Bar   `json:"bars"`
	MarketStatus    MarketStatus              `json:"market_status"`
	MarketFilters   marketfilter.Result       `json:"market_filters"`
	StrategyMapping map[string]string         `json:"strategy_mapping"`
	TrendContext    *TrendContextPayload      `json:"trend_context,omitempty"`
}

type AccountSummary struct {
	AccountID  string  `json:"account_id"`
	Equity     float64 `json:"equity"`
	Balance    float64 `json:"balance"`
	Margin     float64 `json:"margin"`
	FreeMargin float64 `json:"free_margin"`
	Currency   string  `json:"currency"`
	Leverage   int     `json:"leverage"`
	Broker     string  `json:"broker"`
	ServerName string  `json:"server_name"`
	Connected  bool    `json:"connected"`
}

type PositionSummary struct {
	Ticket       int64   `json:"ticket"`
	Strategy     string  `json:"strategy"`
	Magic        int     `json:"magic"`
	Direction    string  `json:"direction"`
	EntryPrice   float64 `json:"entry_price"`
	CurrentPrice float64 `json:"current_price"`
	Lots         float64 `json:"lots"`
	Profit       float64 `json:"profit"`
	PnLPercent   float64 `json:"pnl_percent"`
	SL           float64 `json:"sl"`
	TP           float64 `json:"tp"`
	HoldSeconds  int64   `json:"hold_seconds"`
	HoldHours    float64 `json:"hold_hours"`
	Comment      string  `json:"comment"`
}

type IndicatorPack struct {
	Close      float64 `json:"close"`
	Open       float64 `json:"open"`
	High       float64 `json:"high"`
	Low        float64 `json:"low"`
	EMA20      float64 `json:"ema20"`
	EMA50      float64 `json:"ema50"`
	EMA200     float64 `json:"ema200"`
	RSI        float64 `json:"rsi"`
	ADX        float64 `json:"adx"`
	ATR        float64 `json:"atr"`
	MACDLine   float64 `json:"macd"`
	MACDSignal float64 `json:"macd_signal"`
	MACDHist   float64 `json:"macd_hist"`
	BBUpper    float64 `json:"bb_upper"`
	BBMiddle   float64 `json:"bb_middle"`
	BBLower    float64 `json:"bb_lower"`
	StochK     float64 `json:"stoch_k"`
	StochD     float64 `json:"stoch_d"`
	VolSMA     float64 `json:"vol_sma"`
	Fib236     float64 `json:"fib_236"`
	Fib382     float64 `json:"fib_382"`
	Fib500     float64 `json:"fib_500"`
	Fib618     float64 `json:"fib_618"`
	Fib786     float64 `json:"fib_786"`
	Fib1272    float64 `json:"fib_1272"`
	Fib1618    float64 `json:"fib_1618"`
	Fib2618    float64 `json:"fib_2618"`
	PP         float64 `json:"pp"`
	R1         float64 `json:"r1"`
	S1         float64 `json:"s1"`
	BarsCount  int     `json:"bars_count"`
}

type MarketStatus struct {
	MarketOpen     bool   `json:"market_open"`
	IsTradeAllowed bool   `json:"is_trade_allowed"`
	MT4ServerTime  string `json:"mt4_server_time"`
	Tradeable      bool   `json:"tradeable"`
}

// TrendContextPayload is the JSON-serializable trend context for LLM consumption.
type TrendContextPayload struct {
	D1Direction        string  `json:"d1_direction"`
	H4Direction        string  `json:"h4_direction"`
	H1Direction        string  `json:"h1_direction"`
	M30Direction       string  `json:"m30_direction"`
	ConsensusDirection string  `json:"consensus_direction"`
	ConsensusStrength  float64 `json:"consensus_strength"`
}

var defaultStrategyMapping = map[string]string{
	"20250231": "pullback",
	"20250232": "breakout_retest",
	"20250233": "divergence",
	"20250234": "breakout_pyramid",
	"20250235": "counter_pullback",
	"20250236": "range",
}

const staleTickTradeableWindow = 10 * time.Minute
const analysisPayloadBarsLimit = 1000

func BuildAnalysisPayload(account domain.Account, runtime domain.AccountRuntime, state domain.AccountState, now time.Time) AnalysisPayload {
	mapping := state.StrategyMapping
	if len(mapping) == 0 {
		mapping = defaultStrategyMapping
	}

	indicators := map[string]*IndicatorPack{}
	payloadBars := map[string][]domain.Bar{}
	for _, timeframe := range []string{"M15", "M30", "H1", "H4"} {
		bars := state.Bars[timeframe]
		enriched := indicator.EnrichBars(bars)
		payloadBars[timeframe] = recentSafeBars(enriched, analysisPayloadBarsLimit)
		if len(bars) < 20 {
			indicators[timeframe] = nil
			continue
		}
		last := enriched[len(enriched)-1]
		indicators[timeframe] = &IndicatorPack{
			Close:      safeFloat(last.Close),
			Open:       safeFloat(last.Open),
			High:       safeFloat(last.High),
			Low:        safeFloat(last.Low),
			EMA20:      safeFloat(last.EMA20),
			EMA50:      safeFloat(last.EMA50),
			EMA200:     safeFloat(last.EMA200),
			RSI:        safeFloat(last.RSI),
			ADX:        safeFloat(last.ADX),
			ATR:        safeFloat(last.ATR),
			MACDLine:   safeFloat(last.MACD),
			MACDSignal: safeFloat(last.MACDSignal),
			MACDHist:   safeFloat(last.MACDHist),
			BBUpper:    safeFloat(last.BBUpper),
			BBMiddle:   safeFloat(last.BBMid),
			BBLower:    safeFloat(last.BBLower),
			StochK:     safeFloat(last.StochK),
			StochD:     safeFloat(last.StochD),
			VolSMA:     safeFloat(last.VolSMA),
			Fib236:     safeFloat(last.Fib236),
			Fib382:     safeFloat(last.Fib382),
			Fib500:     safeFloat(last.Fib500),
			Fib618:     safeFloat(last.Fib618),
			Fib786:     safeFloat(last.Fib786),
			Fib1272:    safeFloat(last.Fib1272),
			Fib1618:    safeFloat(last.Fib1618),
			Fib2618:    safeFloat(last.Fib2618),
			PP:         safeFloat(last.PP),
			R1:         safeFloat(last.R1),
			S1:         safeFloat(last.S1),
			BarsCount:  len(enriched),
		}
	}

	positions := make([]PositionSummary, 0, len(state.Positions))
	for _, position := range state.Positions {
		holdSeconds := int64(0)
		if position.OpenTime > 0 {
			holdSeconds = now.Unix() - position.OpenTime
		}
		pnlPercent := 0.0
		if position.OpenPrice > 0 && position.Lots > 0 {
			pnlPercent = (position.Profit / (position.OpenPrice * position.Lots)) * 100
		}

		positions = append(positions, PositionSummary{
			Ticket:       position.Ticket,
			Strategy:     resolveStrategy(mapping, position.Magic),
			Magic:        position.Magic,
			Direction:    strings.ToUpper(position.Type),
			EntryPrice:   safeFloat(position.OpenPrice),
			CurrentPrice: safeFloat(state.Tick.Ask),
			Lots:         safeFloat(position.Lots),
			Profit:       safeFloat(position.Profit),
			PnLPercent:   round4(pnlPercent),
			SL:           safeFloat(position.SL),
			TP:           safeFloat(position.TP),
			HoldSeconds:  holdSeconds,
			HoldHours:    round2(float64(holdSeconds) / 3600),
			Comment:      position.Comment,
		})
	}

	market := state.Tick
	if market.Symbol == "" {
		market.Symbol = "XAUUSD"
	}

	marketOpen := runtime.MarketOpen
	isTradeAllowed := runtime.IsTradeAllowed
	if runtime.LastTickAt.IsZero() {
		marketOpen = false
		isTradeAllowed = false
	} else {
		tickAge := now.UTC().Sub(runtime.LastTickAt)
		if tickAge > staleTickTradeableWindow {
			marketOpen = false
			isTradeAllowed = false
		}
	}
	tradeable := marketOpen && isTradeAllowed

	shanghai := time.FixedZone("CST", 8*3600)
	filterState := state
	filterState.Bars = payloadBars
	filters := marketfilter.Evaluate(marketfilter.Input{
		Now:     now,
		Runtime: runtime,
		State:   filterState,
	})

	return AnalysisPayload{
		Status:    "OK",
		Timestamp: now.In(shanghai).Format("2006-01-02T15:04:05+08:00"),
		Account: AccountSummary{
			AccountID:  account.AccountID,
			Equity:     safeFloat(runtime.Equity),
			Balance:    safeFloat(runtime.Balance),
			Margin:     safeFloat(runtime.Margin),
			FreeMargin: safeFloat(runtime.FreeMargin),
			Currency:   account.Currency,
			Leverage:   account.Leverage,
			Broker:     account.Broker,
			ServerName: account.ServerName,
			Connected:  runtime.Connected,
		},
		Market:     market,
		Positions:  positions,
		Indicators: indicators,
		Bars:       payloadBars,
		MarketStatus: MarketStatus{
			MarketOpen:     marketOpen,
			IsTradeAllowed: isTradeAllowed,
			MT4ServerTime:  runtime.MT4ServerTime,
			Tradeable:      tradeable,
		},
		MarketFilters:   filters,
		StrategyMapping: mapping,
		TrendContext:    buildTrendContextPayload(state),
	}
}

// buildTrendContextPayload builds a TrendContextPayload from account state bars.
func buildTrendContextPayload(state domain.AccountState) *TrendContextPayload {
	tc := engine.BuildTrendContext(
		state.Bars["D1"], state.Bars["H4"], state.Bars["H1"],
		state.Bars["M30"], state.Bars["M15"],
		engine.DefaultTrendConfig(),
	)
	return &TrendContextPayload{
		D1Direction:        tc.D1Direction,
		H4Direction:        tc.H4Direction,
		H1Direction:        tc.H1Direction,
		M30Direction:       tc.M30Direction,
		ConsensusDirection: tc.ConsensusDirection,
		ConsensusStrength:  tc.ConsensusStrength,
	}
}

func recentSafeBars(bars []domain.Bar, limit int) []domain.Bar {
	if len(bars) == 0 {
		return []domain.Bar{}
	}

	recent := bars
	if limit <= 0 || len(bars) <= limit {
		return safeBars(recent)
	}
	recent = bars[len(bars)-limit:]
	return safeBars(recent)
}

func safeBars(bars []domain.Bar) []domain.Bar {
	out := make([]domain.Bar, len(bars))
	for i, bar := range bars {
		out[i] = safeBar(bar)
	}
	return out
}

func safeBar(bar domain.Bar) domain.Bar {
	bar.Open = safeFloat(bar.Open)
	bar.High = safeFloat(bar.High)
	bar.Low = safeFloat(bar.Low)
	bar.Close = safeFloat(bar.Close)
	bar.EMA20 = safeFloat(bar.EMA20)
	bar.EMA50 = safeFloat(bar.EMA50)
	bar.EMA200 = safeFloat(bar.EMA200)
	bar.ATR = safeFloat(bar.ATR)
	bar.RSI = safeFloat(bar.RSI)
	bar.MACD = safeFloat(bar.MACD)
	bar.MACDSignal = safeFloat(bar.MACDSignal)
	bar.MACDHist = safeFloat(bar.MACDHist)
	bar.ADX = safeFloat(bar.ADX)
	bar.BBUpper = safeFloat(bar.BBUpper)
	bar.BBLower = safeFloat(bar.BBLower)
	bar.BBMid = safeFloat(bar.BBMid)
	bar.StochK = safeFloat(bar.StochK)
	bar.StochD = safeFloat(bar.StochD)
	bar.VolSMA = safeFloat(bar.VolSMA)
	bar.Fib236 = safeFloat(bar.Fib236)
	bar.Fib382 = safeFloat(bar.Fib382)
	bar.Fib500 = safeFloat(bar.Fib500)
	bar.Fib618 = safeFloat(bar.Fib618)
	bar.Fib786 = safeFloat(bar.Fib786)
	bar.Fib1272 = safeFloat(bar.Fib1272)
	bar.Fib1618 = safeFloat(bar.Fib1618)
	bar.Fib2618 = safeFloat(bar.Fib2618)
	bar.PP = safeFloat(bar.PP)
	bar.R1 = safeFloat(bar.R1)
	bar.R2 = safeFloat(bar.R2)
	bar.S1 = safeFloat(bar.S1)
	bar.S2 = safeFloat(bar.S2)
	return bar
}

func resolveStrategy(mapping map[string]string, magic int) string {
	if strategy, ok := mapping[strconv.Itoa(magic)]; ok {
		return strategy
	}
	return "unknown"
}

func round2(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}

func round4(value float64) float64 {
	return math.RoundToEven(value*10000) / 10000
}

func safeFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}
