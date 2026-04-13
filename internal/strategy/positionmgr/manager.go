package positionmgr

import (
	"fmt"
	"math"
	"strings"
	"time"

	"gold-bot/internal/domain"
)

type Option func(*Manager)

type Manager struct {
	states map[int64]domain.PositionState
	now    func() time.Time
}

func New(options ...Option) *Manager {
	manager := &Manager{
		states: make(map[int64]domain.PositionState),
		now:    time.Now,
	}
	for _, option := range options {
		option(manager)
	}
	return manager
}

func WithNow(now func() time.Time) Option {
	return func(manager *Manager) {
		manager.now = now
	}
}

func (m *Manager) SeedState(state domain.PositionState) {
	if state.BETriggerATR == 0 {
		state.BETriggerATR = 1.0
	}
	if state.OpenTime.IsZero() {
		state.OpenTime = m.now()
	}
	m.states[state.Ticket] = state
}

func (m *Manager) Analyze(snapshot domain.PositionSnapshot) []domain.PositionCommand {
	if len(snapshot.Positions) == 0 || len(snapshot.H1Bars) < 5 {
		return nil
	}
	if snapshot.CurrentATR <= 0 || snapshot.CurrentPrice <= 0 {
		return nil
	}

	tp1Multi, tp2Multi := adaptiveATRMultis(snapshot.H1Bars)
	commands := make([]domain.PositionCommand, 0, len(snapshot.Positions))
	active := make(map[int64]struct{}, len(snapshot.Positions))

	for _, position := range snapshot.Positions {
		active[position.Ticket] = struct{}{}
		if position.OpenPrice <= 0 || position.Lots <= 0 {
			continue
		}

		state, ok := m.states[position.Ticket]
		if !ok {
			state = domain.PositionState{
				Ticket:       position.Ticket,
				OpenTime:     m.now(),
				BETriggerATR: 1.0,
			}
		}
		if state.BETriggerATR == 0 {
			state.BETriggerATR = 1.0
		}

		side := strings.ToUpper(position.Type)
		profitPips := snapshot.CurrentPrice - position.OpenPrice
		if side != "BUY" {
			profitPips = position.OpenPrice - snapshot.CurrentPrice
		}
		profitATR := profitPips / snapshot.CurrentATR
		if profitATR > state.MaxProfitATR {
			state.MaxProfitATR = profitATR
		}

		if command, ok := m.checkTimeStop(position, state, side, profitATR); ok {
			commands = append(commands, command)
			m.states[position.Ticket] = state
			continue
		}

		if command, ok := m.checkBreakeven(position, &state, profitATR); ok {
			commands = append(commands, command)
		}

		if command, ok := m.checkTP1(position, &state, side, snapshot.CurrentATR, profitATR, tp1Multi, snapshot.H1Bars); ok {
			commands = append(commands, command)
			m.states[position.Ticket] = state
			continue
		}

		if command, ok := m.checkKeyLevel(position, &state, side, snapshot.CurrentPrice, snapshot.CurrentATR, profitATR); ok {
			commands = append(commands, command)
			m.states[position.Ticket] = state
			continue
		}

		if command, ok := m.checkTP2(position, &state, side, profitATR, tp2Multi, snapshot.H1Bars); ok {
			commands = append(commands, command)
			m.states[position.Ticket] = state
			continue
		}

		if command, ok := m.checkTrendReversal(position, state, side, snapshot.CurrentPrice, profitATR, snapshot.H1Bars); ok {
			commands = append(commands, command)
			m.states[position.Ticket] = state
			continue
		}

		if command, ok := m.checkDynamicTrailing(position, state, profitATR); ok {
			commands = append(commands, command)
		}

		m.states[position.Ticket] = state
	}

	for ticket := range m.states {
		if _, ok := active[ticket]; !ok {
			delete(m.states, ticket)
		}
	}

	return commands
}

func adaptiveATRMultis(h1 []domain.Bar) (float64, float64) {
	if len(h1) < 25 {
		return 1.5, 3.0
	}

	currentATR := h1[len(h1)-1].ATR
	if currentATR <= 0 || math.IsNaN(currentATR) {
		return 1.5, 3.0
	}

	sum := 0.0
	count := 0
	for _, bar := range h1[len(h1)-20:] {
		if math.IsNaN(bar.ATR) || bar.ATR <= 0 {
			continue
		}
		sum += bar.ATR
		count++
	}
	if count == 0 {
		return 1.5, 3.0
	}

	avgATR := sum / float64(count)
	if avgATR <= 0 {
		return 1.5, 3.0
	}

	ratio := currentATR / avgATR
	switch {
	case ratio > 1.3:
		return 2.0, 4.0
	case ratio < 0.7:
		return 1.0, 2.0
	default:
		return 1.5, 3.0
	}
}

func (m *Manager) checkTimeStop(position domain.Position, state domain.PositionState, _ string, profitATR float64) (domain.PositionCommand, bool) {
	hours := m.now().Sub(state.OpenTime).Hours()

	switch {
	case hours > 72 && !state.TP2Hit:
		closeLots := roundLots(position.Lots * 0.5)
		if closeLots <= 0.02 {
			closeLots = position.Lots
		}
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   closeLots,
			Reason: fmt.Sprintf("time_72h_%.1fATR", profitATR),
		}, true
	case hours > 48 && profitATR < 1.0:
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("time_48h_%.1fATR", profitATR),
		}, true
	case hours > 24 && profitATR < 0.3:
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("time_24h_%.1fATR", profitATR),
		}, true
	default:
		return domain.PositionCommand{}, false
	}
}

func (m *Manager) checkBreakeven(position domain.Position, state *domain.PositionState, profitATR float64) (domain.PositionCommand, bool) {
	if state.BEMoved || profitATR < state.BETriggerATR {
		return domain.PositionCommand{}, false
	}

	state.BEMoved = true
	return domain.PositionCommand{
		Action: domain.PositionActionModify,
		Ticket: position.Ticket,
		NewSL:  position.OpenPrice,
		Reason: fmt.Sprintf("breakeven_%.1fATR", profitATR),
	}, true
}

func (m *Manager) checkTP1(position domain.Position, state *domain.PositionState, side string, atr, profitATR, tp1Multi float64, h1 []domain.Bar) (domain.PositionCommand, bool) {
	if state.TP1Hit || !state.BEMoved {
		return domain.PositionCommand{}, false
	}

	shouldTP1 := profitATR >= tp1Multi
	earlyThreshold := tp1Multi * 0.6
	if !shouldTP1 && profitATR >= earlyThreshold && len(h1) >= 3 {
		last := h1[len(h1)-1]
		prev := h1[len(h1)-2]
		if side == "BUY" {
			if prev.RSI > 65 && last.RSI < 55 {
				shouldTP1 = true
			}
		} else if prev.RSI < 35 && last.RSI > 45 {
			shouldTP1 = true
		}
	}

	if !shouldTP1 {
		return domain.PositionCommand{}, false
	}

	closeLots := roundLots(position.Lots * 0.4)
	if closeLots < 0.01 {
		closeLots = position.Lots
	}
	state.TP1Hit = true
	return domain.PositionCommand{
		Action: domain.PositionActionClose,
		Ticket: position.Ticket,
		Lots:   closeLots,
		Reason: fmt.Sprintf("TP1_%.1fATR", profitATR),
	}, true
}

func (m *Manager) checkKeyLevel(position domain.Position, state *domain.PositionState, side string, price, atr, profitATR float64) (domain.PositionCommand, bool) {
	if profitATR < 1.0 {
		return domain.PositionCommand{}, false
	}

	keyLevel := nearestKeyLevel(price, side)
	if math.Abs(price-keyLevel) >= atr*0.2 {
		return domain.PositionCommand{}, false
	}

	closeLots := roundLots(position.Lots * 0.4)
	if closeLots < 0.01 {
		closeLots = position.Lots
	}

	if !state.TP1Hit {
		state.TP1Hit = true
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   closeLots,
			Reason: fmt.Sprintf("key_level_%.0f", keyLevel),
		}, true
	}
	if state.TP1Hit && !state.TP2Hit && profitATR > 2.0 {
		state.TP2Hit = true
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   closeLots,
			Reason: fmt.Sprintf("key_level2_%.0f", keyLevel),
		}, true
	}

	return domain.PositionCommand{}, false
}

func (m *Manager) checkTP2(position domain.Position, state *domain.PositionState, side string, profitATR, tp2Multi float64, h1 []domain.Bar) (domain.PositionCommand, bool) {
	if !state.TP1Hit || state.TP2Hit {
		return domain.PositionCommand{}, false
	}

	shouldTP2 := profitATR >= tp2Multi
	earlyThreshold := tp2Multi * 0.7
	if !shouldTP2 && profitATR >= earlyThreshold && len(h1) >= 3 {
		last := h1[len(h1)-1]
		prev := h1[len(h1)-2]
		weakness := 0
		if side == "BUY" {
			if last.MACDHist < prev.MACDHist {
				weakness++
			}
			if last.RSI < prev.RSI && last.RSI < 60 {
				weakness++
			}
			if last.ADX < prev.ADX {
				weakness++
			}
		} else {
			if last.MACDHist > prev.MACDHist {
				weakness++
			}
			if last.RSI > prev.RSI && last.RSI > 40 {
				weakness++
			}
			if last.ADX < prev.ADX {
				weakness++
			}
		}
		if weakness >= 2 {
			shouldTP2 = true
		}
	}

	if !shouldTP2 {
		return domain.PositionCommand{}, false
	}

	closeLots := roundLots(position.Lots * 0.4)
	if closeLots < 0.01 {
		closeLots = position.Lots
	}
	state.TP2Hit = true
	return domain.PositionCommand{
		Action: domain.PositionActionClose,
		Ticket: position.Ticket,
		Lots:   closeLots,
		Reason: fmt.Sprintf("TP2_%.1fATR", profitATR),
	}, true
}

func (m *Manager) checkTrendReversal(position domain.Position, state domain.PositionState, side string, price, profitATR float64, h1 []domain.Bar) (domain.PositionCommand, bool) {
	if !state.BEMoved || profitATR < 0.3 || len(h1) < 4 {
		return domain.PositionCommand{}, false
	}

	last := h1[len(h1)-1]
	prev := h1[len(h1)-2]
	score := 0
	reasons := make([]string, 0, 5)

	if side == "BUY" {
		ema20 := last.EMA20
		if ema20 == 0 {
			ema20 = price
		}
		if last.MACDHist < -0.5 && price < ema20 {
			score += 3
			reasons = append(reasons, fmt.Sprintf("MACD=%.2f<-0.5且价格<EMA20", last.MACDHist))
		}
		if last.RSI < 40 {
			score += 2
			reasons = append(reasons, fmt.Sprintf("RSI=%.0f<40", last.RSI))
		}
		if last.MACDHist < 0 && prev.MACDHist > 0 {
			score++
			reasons = append(reasons, "MACD翻负")
		}
		if last.ADX < 20 {
			score++
			reasons = append(reasons, fmt.Sprintf("ADX=%.0f<20", last.ADX))
		}
		if last.EMA20 < last.EMA50 && prev.EMA20 >= prev.EMA50 {
			score += 2
			reasons = append(reasons, "EMA死叉")
		}
	} else {
		ema20 := last.EMA20
		if ema20 == 0 {
			ema20 = price
		}
		if last.MACDHist > 0.5 && price > ema20 {
			score += 3
			reasons = append(reasons, fmt.Sprintf("MACD=%.2f>0.5且价格>EMA20", last.MACDHist))
		}
		if last.RSI > 60 {
			score += 2
			reasons = append(reasons, fmt.Sprintf("RSI=%.0f>60", last.RSI))
		}
		if last.MACDHist > 0 && prev.MACDHist < 0 {
			score++
			reasons = append(reasons, "MACD翻正")
		}
		if last.ADX < 20 {
			score++
			reasons = append(reasons, fmt.Sprintf("ADX=%.0f<20", last.ADX))
		}
		if last.EMA20 > last.EMA50 && prev.EMA20 <= prev.EMA50 {
			score += 2
			reasons = append(reasons, "EMA金叉")
		}
	}

	if score < 4 {
		return domain.PositionCommand{}, false
	}

	return domain.PositionCommand{
		Action: domain.PositionActionClose,
		Ticket: position.Ticket,
		Lots:   position.Lots,
		Reason: fmt.Sprintf("reversal_s%d_%s", score, strings.Join(reasons, " ")),
	}, true
}

func (m *Manager) checkDynamicTrailing(position domain.Position, state domain.PositionState, profitATR float64) (domain.PositionCommand, bool) {
	if !state.TP1Hit || state.MaxProfitATR <= 0 {
		return domain.PositionCommand{}, false
	}

	drawdown := state.MaxProfitATR - profitATR
	if state.TP2Hit {
		if drawdown > state.MaxProfitATR*0.4 {
			return domain.PositionCommand{
				Action: domain.PositionActionClose,
				Ticket: position.Ticket,
				Lots:   position.Lots,
				Reason: fmt.Sprintf("trail_tp2_dd%.1f", drawdown),
			}, true
		}
		return domain.PositionCommand{}, false
	}

	if drawdown > state.MaxProfitATR*0.5 && profitATR < 0.5 {
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("trail_tp1_dd%.1f", drawdown),
		}, true
	}
	return domain.PositionCommand{}, false
}

func nearestKeyLevel(price float64, side string) float64 {
	levelBelow := math.Floor(price/50) * 50
	levelAbove := (math.Floor(price/50) + 1) * 50
	if side == "BUY" {
		return levelAbove
	}
	return levelBelow
}

func roundLots(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}
