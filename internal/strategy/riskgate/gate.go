package riskgate

import (
	"math"
	"strings"
	"time"

	"gold-bot/internal/domain"
)

type Status string

const (
	StatusAccepted Status = "accepted"
	StatusRejected Status = "rejected"
	StatusClamped  Status = "clamped"
)

const (
	defaultMaxTickAge   = 2 * time.Minute
	defaultMaxRiskPct   = 0.02
	defaultMarginUsePct = 0.50
)

type Input struct {
	Now             time.Time
	Account         domain.Account
	Runtime         domain.AccountRuntime
	State           domain.AccountState
	CandidateSignal *domain.PendingSignal
	Plan            *domain.TradePlan
	AllowAdd        bool
	AllowHedge      bool
	SourceStrategy  string
}

type Result struct {
	DecisionID    string   `json:"decision_id,omitempty"`
	Mode          string   `json:"mode,omitempty"`
	Symbol        string   `json:"symbol,omitempty"`
	Status        Status   `json:"status"`
	AuditOnly     bool     `json:"audit_only"`
	ReasonCodes   []string `json:"reason_codes"`
	RequestedLots float64  `json:"requested_lots,omitempty"`
	AllowedLots   float64  `json:"allowed_lots,omitempty"`
	MaxRiskLots   float64  `json:"max_risk_lots,omitempty"`
	MaxMarginLots float64  `json:"max_margin_lots,omitempty"`
}

type symbolMeta struct {
	Symbol        string
	ContractSize  float64
	MinLot        float64
	MaxLot        float64
	LotStep       float64
	MaxSpread     float64
	MinSLDistance float64
	MaxSLDistance float64
}

func Evaluate(input Input) Result {
	now := input.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}

	result := Result{
		Status:      StatusAccepted,
		ReasonCodes: []string{},
	}
	if input.Plan == nil {
		result.ReasonCodes = append(result.ReasonCodes, "plan.absent")
		return result
	}

	plan := input.Plan
	result.DecisionID = plan.DecisionID
	result.Mode = strings.ToLower(plan.Mode)
	result.Symbol = domain.BaseSymbol(plan.Symbol)
	result.AuditOnly = isAuditOnlyMode(result.Mode)
	meta := metadataFor(result.Symbol)

	if !isExecutableMode(result.Mode) {
		result.ReasonCodes = append(result.ReasonCodes, "action.non_executable")
		return result
	}

	rejects := tradeabilityRejects(input, now, meta)
	if len(rejects) > 0 {
		result.Status = StatusRejected
		result.ReasonCodes = append(result.ReasonCodes, rejects...)
		return result
	}

	if result.Mode == "close" || result.Mode == "reduce" {
		result.ReasonCodes = append(result.ReasonCodes, "action.audit_safe")
		return result
	}

	lotResult, rejects := validateExpandableRisk(input, now, meta)
	result.RequestedLots = lotResult.RequestedLots
	result.AllowedLots = lotResult.AllowedLots
	result.MaxRiskLots = lotResult.MaxRiskLots
	result.MaxMarginLots = lotResult.MaxMarginLots
	if len(rejects) > 0 {
		result.Status = StatusRejected
		result.ReasonCodes = append(result.ReasonCodes, rejects...)
		return result
	}
	if lotResult.Clamped {
		result.Status = StatusClamped
		result.ReasonCodes = append(result.ReasonCodes, "lots.clamped")
		return result
	}

	result.ReasonCodes = append(result.ReasonCodes, "lots.accepted")
	return result
}

func tradeabilityRejects(input Input, now time.Time, meta symbolMeta) []string {
	reasons := []string{}
	if !input.Runtime.MarketOpen {
		reasons = append(reasons, "market.closed")
	}
	if !input.Runtime.IsTradeAllowed {
		reasons = append(reasons, "market.trade_not_allowed")
	}
	if input.Runtime.LastTickAt.IsZero() {
		reasons = append(reasons, "tick.missing")
	} else if now.Sub(input.Runtime.LastTickAt.UTC()) > defaultMaxTickAge {
		reasons = append(reasons, "tick.stale")
	}
	if input.State.Tick.Bid <= 0 || input.State.Tick.Ask <= 0 {
		reasons = append(reasons, "tick.missing_price")
	}
	if input.State.Tick.Spread > meta.MaxSpread {
		reasons = append(reasons, "spread.too_wide")
	}
	if input.Plan != nil && !input.Plan.ExpiresAt.IsZero() && now.After(input.Plan.ExpiresAt.UTC()) {
		reasons = append(reasons, "plan.expired")
	}
	return reasons
}

type lotValidation struct {
	RequestedLots float64
	AllowedLots   float64
	MaxRiskLots   float64
	MaxMarginLots float64
	Clamped       bool
}

func validateExpandableRisk(input Input, _ time.Time, meta symbolMeta) (lotValidation, []string) {
	plan := input.Plan
	result := lotValidation{RequestedLots: plan.MaxLots}
	reasons := []string{}

	entry := executionPrice(input.State.Tick, plan.Side)
	if entry <= 0 {
		reasons = append(reasons, "entry.missing")
	}
	if plan.StopLoss <= 0 {
		reasons = append(reasons, "sl.missing")
	}
	if entry > 0 && plan.StopLoss > 0 {
		distance := math.Abs(entry - plan.StopLoss)
		if strings.EqualFold(plan.Side, "buy") && plan.StopLoss >= entry {
			reasons = append(reasons, "sl.wrong_side")
		}
		if strings.EqualFold(plan.Side, "sell") && plan.StopLoss <= entry {
			reasons = append(reasons, "sl.wrong_side")
		}
		if distance < meta.MinSLDistance {
			reasons = append(reasons, "sl.too_close")
		}
		if distance > meta.MaxSLDistance {
			reasons = append(reasons, "sl.too_far")
		}
		result.MaxRiskLots = roundDownLot((input.Runtime.Equity*defaultMaxRiskPct)/(distance*meta.ContractSize), meta.LotStep)
	}
	if plan.MaxLots <= 0 {
		reasons = append(reasons, "lots.missing")
	}
	if input.Runtime.FreeMargin <= 0 {
		reasons = append(reasons, "margin.free_margin_missing")
	}

	if entry > 0 && input.Runtime.FreeMargin > 0 {
		leverage := float64(input.Account.Leverage)
		if leverage <= 0 {
			leverage = 1
		}
		marginPerLot := (entry * meta.ContractSize) / leverage
		if marginPerLot > 0 {
			result.MaxMarginLots = roundDownLot((input.Runtime.FreeMargin*defaultMarginUsePct)/marginPerLot, meta.LotStep)
		}
	}
	if len(reasons) > 0 {
		return result, reasons
	}
	reasons = append(reasons, positionConflictRejects(input)...)
	if len(reasons) > 0 {
		return result, reasons
	}

	allowed := minPositive(plan.MaxLots, meta.MaxLot, result.MaxRiskLots, result.MaxMarginLots)
	allowed = roundDownLot(allowed, meta.LotStep)
	if allowed < meta.MinLot {
		reasons = append(reasons, "lots.below_min_after_clamp")
		return result, reasons
	}

	result.AllowedLots = allowed
	result.Clamped = allowed < plan.MaxLots
	return result, nil
}

func positionConflictRejects(input Input) []string {
	if input.Plan == nil {
		return nil
	}
	reasons := []string{}
	planSide := strings.ToLower(input.Plan.Side)
	planSymbol := domain.BaseSymbol(input.Plan.Symbol)
	addRejected := false
	hedgeRejected := false

	for _, position := range input.State.Positions {
		if position.Ticket <= 0 || position.Lots <= 0 {
			continue
		}
		if position.Symbol != "" && domain.BaseSymbol(position.Symbol) != planSymbol {
			continue
		}
		positionSide := positionSide(position.Type)
		if positionSide == "" || planSide == "none" {
			continue
		}
		// 不同策略的持仓不构成冲突
		if input.SourceStrategy != "" && position.Strategy != "" &&
			position.Strategy != input.SourceStrategy {
			continue
		}
		if positionSide == planSide && !input.AllowAdd && !addRejected {
			reasons = append(reasons, "position.add_not_allowed")
			addRejected = true
		}
		if positionSide != planSide && !input.AllowHedge && !hedgeRejected {
			reasons = append(reasons, "position.hedge_not_allowed")
			hedgeRejected = true
		}
	}

	return reasons
}

func positionSide(positionType string) string {
	switch strings.ToUpper(strings.TrimSpace(positionType)) {
	case "BUY":
		return "buy"
	case "SELL":
		return "sell"
	default:
		return ""
	}
}

func executionPrice(tick domain.TickSnapshot, side string) float64 {
	switch strings.ToLower(side) {
	case "buy":
		return tick.Ask
	case "sell":
		return tick.Bid
	default:
		if tick.Bid > 0 && tick.Ask > 0 {
			return (tick.Bid + tick.Ask) / 2
		}
		return 0
	}
}

func isExecutableMode(mode string) bool {
	switch mode {
	case "approve", "modify", "reduce", "close":
		return true
	default:
		return false
	}
}

func isAuditOnlyMode(mode string) bool {
	switch mode {
	case "approve", "modify", "observe", "veto":
		return true
	default:
		return false
	}
}

func metadataFor(symbol string) symbolMeta {
	switch domain.BaseSymbol(symbol) {
	case "GBPJPY", "EURJPY", "USDJPY":
		// JPY crosses: higher volatility, wider spreads, wider SL range
		return jpyCrossMetadata(symbol)
	case "GBPUSD":
		return symbolMeta{
			Symbol:        "GBPUSD",
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        30,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.0005,
			MaxSLDistance: 0.05,
		}
	case "USDCAD":
		return symbolMeta{
			Symbol:        "USDCAD",
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        30,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.0005,
			MaxSLDistance: 0.05,
		}
	case "US100CASH":
		return symbolMeta{Symbol: "US100CASH", ContractSize: 1, MinLot: 0.01, MaxLot: 20, LotStep: 0.01, MaxSpread: 80.0, MinSLDistance: 1.0, MaxSLDistance: 500.0}
	case "USOILCASH":
		return symbolMeta{Symbol: "USOILCASH", ContractSize: 100, MinLot: 0.01, MaxLot: 30, LotStep: 0.01, MaxSpread: 80.0, MinSLDistance: 0.05, MaxSLDistance: 10.0}
	case "UKOILCASH":
		return symbolMeta{Symbol: "UKOILCASH", ContractSize: 100, MinLot: 0.01, MaxLot: 30, LotStep: 0.01, MaxSpread: 80.0, MinSLDistance: 0.05, MaxSLDistance: 10.0}
	default:
		return symbolMeta{
			Symbol:        "XAUUSD",
			ContractSize:  100,
			MinLot:        0.01,
			MaxLot:        50,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.50,
			MaxSLDistance: 100.0,
		}
	}
}

// jpyCrossMetadata returns symbol metadata for JPY cross pairs.
// GBPJPY has wider spread tolerance than EURJPY/USDJPY due to lower liquidity.
func jpyCrossMetadata(symbol string) symbolMeta {
	base := domain.BaseSymbol(symbol)
	switch base {
	case "GBPJPY":
		return symbolMeta{
			Symbol:        "GBPJPY",
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        20,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.03, // was 0.05 — allow tighter SL for scalps
			MaxSLDistance: 8.0,  // was 5.0 — accommodate wider SL for swings
		}
	case "EURJPY":
		return symbolMeta{
			Symbol:        "EURJPY",
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        20,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.03,
			MaxSLDistance: 7.0,
		}
	case "USDJPY":
		return symbolMeta{
			Symbol:        "USDJPY",
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        30, // more liquid
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.02,
			MaxSLDistance: 6.0,
		}
	default:
		// Fallback for unknown JPY crosses
		return symbolMeta{
			Symbol:        base,
			ContractSize:  100000,
			MinLot:        0.01,
			MaxLot:        20,
			LotStep:       0.01,
			MaxSpread:     80.0,
			MinSLDistance: 0.03,
			MaxSLDistance: 8.0,
		}
	}
}

func minPositive(values ...float64) float64 {
	min := 0.0
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if min == 0 || value < min {
			min = value
		}
	}
	return min
}

func roundDownLot(value, step float64) float64 {
	if value <= 0 || step <= 0 {
		return 0
	}
	return math.Floor((value/step)+1e-9) * step
}
