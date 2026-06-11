package marketfilter

import (
	"time"

	"gold-bot/internal/domain"
)

type Severity string

const (
	SeverityBlocking Severity = "blocking"
	SeverityWarning  Severity = "warning"
)

const (
	defaultMaxTickAge      = 2 * time.Minute
	defaultMaxSpread       = 5.0
	jpyCrossMaxSpread      = 6.0 // JPY crosses have wider normal spreads
	atrExpansionRatio      = 2.0
	minATRHistoryForFilter = 10
)

type Input struct {
	Now     time.Time
	Symbol  string // Base symbol (e.g. "GBPJPY", "XAUUSD") for per-symbol limits
	Runtime domain.AccountRuntime
	State   domain.AccountState
}

type Filter struct {
	Code     string   `json:"code"`
	Severity Severity `json:"severity"`
	Message  string   `json:"message,omitempty"`
}

type Result struct {
	Blocked     bool     `json:"blocked"`
	Blocking    []Filter `json:"blocking"`
	Warnings    []Filter `json:"warnings"`
	ReasonCodes []string `json:"reason_codes"`
}

func Evaluate(input Input) Result {
	now := input.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}

	var result Result
	add := func(code string, severity Severity) {
		filter := Filter{Code: code, Severity: severity}
		if severity == SeverityBlocking {
			result.Blocked = true
			result.Blocking = append(result.Blocking, filter)
		} else {
			result.Warnings = append(result.Warnings, filter)
		}
		result.ReasonCodes = append(result.ReasonCodes, code)
	}

	if !input.Runtime.MarketOpen {
		add("market.closed", SeverityBlocking)
	}
	if !input.Runtime.IsTradeAllowed {
		add("market.trade_not_allowed", SeverityBlocking)
	}
	if input.Runtime.LastTickAt.IsZero() {
		add("tick.missing", SeverityBlocking)
	} else if now.Sub(input.Runtime.LastTickAt.UTC()) > defaultMaxTickAge {
		add("tick.stale", SeverityBlocking)
	}
	if input.State.Tick.Spread > maxSpreadForSymbol(input.Symbol) {
		add("spread.too_wide", SeverityBlocking)
	}
	if isFridayCloseWindow(now) {
		add("session.friday_close_window", SeverityBlocking)
	}
	if isRolloverWindow(now) {
		add("session.rollover_window", SeverityWarning)
	}
	if isLowLiquiditySession(now) {
		add("session.low_liquidity", SeverityWarning)
	}
	if hasATRExpansion(input.State.Bars["H1"]) {
		add("volatility.atr_expansion", SeverityWarning)
	}

	return result
}

func BlockingReasonCodes(result Result) []string {
	return filterCodes(result.Blocking)
}

func WarningReasonCodes(result Result) []string {
	return filterCodes(result.Warnings)
}

func filterCodes(filters []Filter) []string {
	codes := make([]string, 0, len(filters))
	for _, filter := range filters {
		codes = append(codes, filter.Code)
	}
	return codes
}

// maxSpreadForSymbol returns the maximum allowed spread for a given symbol.
// JPY crosses get a wider limit due to normal market spreads.
func maxSpreadForSymbol(symbol string) float64 {
	base := domain.BaseSymbol(symbol)
	switch base {
	case "GBPJPY":
		return 6.0 // wide spread pair
	case "EURJPY", "USDJPY":
		return 5.0
	case "GBPUSD", "USDCAD":
		return 4.0 // tighter spread majors
	default:
		return defaultMaxSpread // 5.0
	}
}

func isFridayCloseWindow(now time.Time) bool {
	return now.Weekday() == time.Friday && now.Hour() >= 20
}

func isRolloverWindow(now time.Time) bool {
	minuteOfDay := now.Hour()*60 + now.Minute()
	return minuteOfDay >= 21*60+55 && minuteOfDay <= 22*60+10
}

func isLowLiquiditySession(now time.Time) bool {
	minuteOfDay := now.Hour()*60 + now.Minute()
	return minuteOfDay > 22*60+10 || minuteOfDay < 1*60
}

func hasATRExpansion(bars []domain.Bar) bool {
	if len(bars) < minATRHistoryForFilter+1 {
		return false
	}

	latest := bars[len(bars)-1].ATR
	if latest <= 0 {
		return false
	}

	sum := 0.0
	count := 0
	for _, bar := range bars[:len(bars)-1] {
		if bar.ATR <= 0 {
			continue
		}
		sum += bar.ATR
		count++
	}
	if count < minATRHistoryForFilter {
		return false
	}

	avg := sum / float64(count)
	return avg > 0 && latest >= avg*atrExpansionRatio
}
