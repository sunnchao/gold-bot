package positionmgr

import (
	"context"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/engine"
	"gold-bot/internal/strategy/indicator"
)

type Option func(*Manager)

// StateStore persists position states across restarts.
type StateStore interface {
	SavePositionState(ctx context.Context, accountID, symbol string, state domain.PositionState) error
	LoadPositionStates(ctx context.Context, accountID, symbol string) (map[int64]domain.PositionState, error)
}

type Manager struct {
	states map[int64]domain.PositionState
	now    func() time.Time
	store  StateStore
	ctx    context.Context
}

func New(options ...Option) *Manager {
	manager := &Manager{
		states: make(map[int64]domain.PositionState),
		now:    time.Now,
		ctx:    context.Background(),
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

func WithStore(store StateStore) Option {
	return func(manager *Manager) {
		manager.store = store
	}
}

func WithContext(ctx context.Context) Option {
	return func(manager *Manager) {
		manager.ctx = ctx
	}
}

// LoadStates loads position states from the persistent store for a given account+symbol.
func (m *Manager) LoadStates(accountID, symbol string) error {
	if m.store == nil {
		return nil
	}
	states, err := m.store.LoadPositionStates(m.ctx, accountID, symbol)
	if err != nil {
		return fmt.Errorf("load position states: %w", err)
	}
	for ticket, state := range states {
		m.states[ticket] = state
	}
	log.Printf("[POSMGR] 📂 Loaded %d position states for account=%s symbol=%s", len(states), accountID, symbol)
	return nil
}

func (m *Manager) SeedState(state domain.PositionState) {
	if state.BETriggerATR == 0 {
		state.BETriggerATR = 1.5
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

	log.Printf("[POSMGR] 🔍 分析 %d 个持仓 | price=%.2f ATR=%.2f",
		len(snapshot.Positions), snapshot.CurrentPrice, snapshot.CurrentATR)

	tp1Multi, tp2Multi := adaptiveATRMultis(snapshot.H1Bars)
	commands := make([]domain.PositionCommand, 0, len(snapshot.Positions))
	active := make(map[int64]struct{}, len(snapshot.Positions))

	// 保存 per-position 处理前的状态快照，用于协调 pass 判断"本轮新触发"
	preTP1Hit := make(map[int64]bool, len(snapshot.Positions))
	preTP2Hit := make(map[int64]bool, len(snapshot.Positions))
	preBE := make(map[int64]bool, len(snapshot.Positions))
	for _, pos := range snapshot.Positions {
		if st, ok := m.states[pos.Ticket]; ok {
			preTP1Hit[pos.Ticket] = st.TP1Hit
			preTP2Hit[pos.Ticket] = st.TP2Hit
			preBE[pos.Ticket] = st.BEMoved
		}
	}

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
				BETriggerATR: 1.5,
				BestSL:       position.SL, // 初始化为当前 SL
			}
		}
		if state.BETriggerATR == 0 {
			state.BETriggerATR = 1.5
		}

		side := strings.ToUpper(position.Type)

		// 初始化 BestSL：如果还没跟踪过，用当前 SL；如果已有，取更优值
		if state.BestSL == 0 && position.SL != 0 {
			state.BestSL = position.SL
		} else if position.SL != 0 {
			if side == "BUY" && position.SL > state.BestSL {
				state.BestSL = position.SL
			} else if side == "SELL" && position.SL < state.BestSL {
				state.BestSL = position.SL
			}
		}

		profitPips := snapshot.CurrentPrice - position.OpenPrice
		if side != "BUY" {
			profitPips = position.OpenPrice - snapshot.CurrentPrice
		}
		profitATR := profitPips / snapshot.CurrentATR
		if profitATR > state.MaxProfitATR {
			state.MaxProfitATR = profitATR
		}

		log.Printf("[POSMGR] 📋 #%d %s %.2f手 | entry=%.2f profit=%.2f (%.2f ATR) | max_profit=%.2f ATR | BE=%v",
			position.Ticket, side, position.Lots, position.OpenPrice,
			profitPips, profitATR, state.MaxProfitATR, state.BEMoved)

		if strings.Contains(strings.ToLower(position.Comment), "momentum_scalp") {
			if command, ok := m.checkMomentumScalpExit(position, &state, side, profitATR, snapshot.M5Bars, snapshot.M1Bars); ok {
				log.Printf("[POSMGR] ⚡ #%d | MomentumScalp出场: %s | reason=%s", position.Ticket, command.Action, command.Reason)
				commands = append(commands, command)
				m.states[position.Ticket] = state
				m.persistState(snapshot.AccountID, snapshot.Symbol, state)
				continue
			}
		}

		if command, ok := m.checkTimeStop(position, state, side, profitATR, snapshot.CurrentATR, snapshot.AvgATR); ok {
			log.Printf("[POSMGR] ⏰ #%d | 时间止损: %s", position.Ticket, command.Reason)
			commands = append(commands, command)
			m.states[position.Ticket] = state
			m.persistState(snapshot.AccountID, snapshot.Symbol, state)
			continue
		}

		if command, ok := m.checkBreakeven(position, &state, side, profitATR); ok {
			log.Printf("[POSMGR] 🛡️ #%d | 保本止损: SL→%.2f | reason=%s", position.Ticket, command.NewSL, command.Reason)
			commands = append(commands, command)
		}

		if command, ok := m.checkTP1(position, &state, side, snapshot.CurrentATR, profitATR, tp1Multi, snapshot.H1Bars); ok {
			log.Printf("[POSMGR] 🎯 #%d | TP1: %s %.2f手 | reason=%s", position.Ticket, command.Action, command.Lots, command.Reason)
			commands = append(commands, command)
			m.states[position.Ticket] = state
			m.persistState(snapshot.AccountID, snapshot.Symbol, state)
			continue
		}

		if command, ok := m.checkKeyLevel(position, &state, side, snapshot.CurrentPrice, snapshot.CurrentATR, profitATR, snapshot.H1Bars); ok {
			log.Printf("[POSMGR] 📍 #%d | 关键位止损: %s | reason=%s", position.Ticket, command.Action, command.Reason)
			commands = append(commands, command)
			m.states[position.Ticket] = state
			m.persistState(snapshot.AccountID, snapshot.Symbol, state)
			continue
		}

		if command, ok := m.checkTP2(position, &state, side, profitATR, tp2Multi, snapshot.H1Bars); ok {
			log.Printf("[POSMGR] 🎯 #%d | TP2: %s %.2f手 | reason=%s", position.Ticket, command.Action, command.Lots, command.Reason)
			commands = append(commands, command)
			m.states[position.Ticket] = state
			m.persistState(snapshot.AccountID, snapshot.Symbol, state)
			continue
		}

		if command, ok := m.checkTrendReversal(position, state, side, snapshot.CurrentPrice, profitATR, snapshot.H1Bars); ok {
			log.Printf("[POSMGR] 🔄 #%d | 趋势反转: %s | reason=%s", position.Ticket, command.Action, command.Reason)
			commands = append(commands, command)
			m.states[position.Ticket] = state
			m.persistState(snapshot.AccountID, snapshot.Symbol, state)
			continue
		}

		if command, ok := m.checkDynamicTrailing(position, state, profitATR); ok {
			log.Printf("[POSMGR] 📐 #%d | 动态追踪: SL→%.2f | reason=%s", position.Ticket, command.NewSL, command.Reason)
			commands = append(commands, command)
		}

		m.states[position.Ticket] = state
		m.persistState(snapshot.AccountID, snapshot.Symbol, state)
	}

	// ===== 协调 pass：同方向仓位统一出场 =====
	// 按方向分组
	type sideGroup struct {
		positions []domain.Position
	}
	groups := map[string]*sideGroup{}
	for _, pos := range snapshot.Positions {
		if pos.OpenPrice <= 0 || pos.Lots <= 0 {
			continue
		}
		s := strings.ToUpper(pos.Type)
		if groups[s] == nil {
			groups[s] = &sideGroup{}
		}
		groups[s].positions = append(groups[s].positions, pos)
	}

	for side, grp := range groups {
		if len(grp.positions) <= 1 {
			continue // 单仓位无需协调
		}

		// TP1 协调：本轮任一仓位新触发 TP1 → 同方向所有仓位各平 40%
		anyTP1 := false
		for _, pos := range grp.positions {
			st := m.states[pos.Ticket]
			if st.TP1Hit && !preTP1Hit[pos.Ticket] {
				anyTP1 = true
				break
			}
		}
		if anyTP1 {
			for _, pos := range grp.positions {
				st := m.states[pos.Ticket]
				if !st.TP1Hit {
					closeLots := roundLots(pos.Lots * 0.4)
					if closeLots < 0.01 {
						closeLots = pos.Lots
					}
					st.TP1Hit = true
					log.Printf("[POSMGR] 🎯 #%d | 组合TP1: CLOSE %.2f手", pos.Ticket, closeLots)
					commands = append(commands, domain.PositionCommand{
						Action: domain.PositionActionClose,
						Ticket: pos.Ticket,
						Lots:   closeLots,
						Reason: fmt.Sprintf("group_tp1_%s", side),
					})
					m.states[pos.Ticket] = st
					m.persistState(snapshot.AccountID, snapshot.Symbol, st)
				}
			}
		}

		// TP2 协调：本轮任一仓位新触发 TP2 → 同方向所有仓位各平 40%
		anyTP2 := false
		for _, pos := range grp.positions {
			st := m.states[pos.Ticket]
			if st.TP2Hit && !preTP2Hit[pos.Ticket] {
				anyTP2 = true
				break
			}
		}
		if anyTP2 {
			for _, pos := range grp.positions {
				st := m.states[pos.Ticket]
				if !st.TP2Hit {
					closeLots := roundLots(pos.Lots * 0.4)
					if closeLots < 0.01 {
						closeLots = pos.Lots
					}
					st.TP2Hit = true
					log.Printf("[POSMGR] 🎯 #%d | 组合TP2: CLOSE %.2f手", pos.Ticket, closeLots)
					commands = append(commands, domain.PositionCommand{
						Action: domain.PositionActionClose,
						Ticket: pos.Ticket,
						Lots:   closeLots,
						Reason: fmt.Sprintf("group_tp2_%s", side),
					})
					m.states[pos.Ticket] = st
					m.persistState(snapshot.AccountID, snapshot.Symbol, st)
				}
			}
		}

		// BE 协调：本轮任一仓位新触发 BE → 同方向所有仓位 SL 统一到最优
		anyBE := false
		for _, pos := range grp.positions {
			st := m.states[pos.Ticket]
			if st.BEMoved && !preBE[pos.Ticket] {
				anyBE = true
				break
			}
		}
		if anyBE {
			bestSL := 0.0
			for _, pos := range grp.positions {
				if side == "BUY" && pos.OpenPrice > bestSL {
					bestSL = pos.OpenPrice
				} else if side == "SELL" && (bestSL == 0 || pos.OpenPrice < bestSL) {
					bestSL = pos.OpenPrice
				}
			}
			for _, pos := range grp.positions {
				st := m.states[pos.Ticket]
				if validateNewSL(side, bestSL, st.BestSL) && bestSL != st.BestSL {
					st.BestSL = bestSL
					log.Printf("[POSMGR] 🛡️ #%d | 组合BE: SL→%.2f", pos.Ticket, bestSL)
					commands = append(commands, domain.PositionCommand{
						Action: domain.PositionActionModify,
						Ticket: pos.Ticket,
						NewSL:  bestSL,
						Reason: fmt.Sprintf("group_be_%s", side),
					})
					m.states[pos.Ticket] = st
					m.persistState(snapshot.AccountID, snapshot.Symbol, st)
				}
			}
		}
	}

	for ticket := range m.states {
		if _, ok := active[ticket]; !ok {
			delete(m.states, ticket)
		}
	}

	if len(commands) > 0 {
		log.Printf("[POSMGR] ✅ 生成 %d 条持仓管理指令", len(commands))
	}
	return commands
}

func (m *Manager) checkMomentumScalpExit(position domain.Position, state *domain.PositionState, side string, profitATR float64, m5Bars, m1Bars []domain.Bar) (domain.PositionCommand, bool) {
	maxHolding := engine.DefaultStrategyConfig().MomentumScalpMaxHoldingMin
	if maxHolding <= 0 {
		maxHolding = 20
	}

	if m.now().Sub(state.OpenTime) > time.Duration(maxHolding)*time.Minute && profitATR < 0.2 {
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: "momentum_scalp_time_stop_0.2ATR",
		}, true
	}

	if len(m5Bars) > 0 {
		closes := make([]float64, len(m5Bars))
		for i, bar := range m5Bars {
			closes[i] = bar.Close
		}
		ema5 := indicator.EMA(closes, 5)
		ema8 := indicator.EMA(closes, 8)
		lastIdx := len(closes) - 1
		if (side == "BUY" && ema5[lastIdx] < ema8[lastIdx]) || (side == "SELL" && ema5[lastIdx] > ema8[lastIdx]) {
			return domain.PositionCommand{
				Action: domain.PositionActionClose,
				Ticket: position.Ticket,
				Lots:   position.Lots,
				Reason: "momentum_scalp_m5_structure_break",
			}, true
		}
	}

	if len(m1Bars) > 0 {
		rsi := m1Bars[len(m1Bars)-1].RSI
		if (side == "BUY" && rsi > 80) || (side == "SELL" && rsi < 20) {
			return domain.PositionCommand{
				Action: domain.PositionActionClose,
				Ticket: position.Ticket,
				Lots:   position.Lots,
				Reason: "momentum_scalp_rsi_extreme",
			}, true
		}
		if !state.RSITp75Triggered && ((side == "BUY" && rsi > 75) || (side == "SELL" && rsi < 25)) {
			closeLots := roundLots(position.Lots * 0.5)
			if closeLots < 0.01 {
				closeLots = position.Lots
			}
			state.RSITp75Triggered = true
			return domain.PositionCommand{
				Action: domain.PositionActionClose,
				Ticket: position.Ticket,
				Lots:   closeLots,
				Reason: "momentum_scalp_rsi_tp75",
			}, true
		}
	}

	return domain.PositionCommand{}, false
}

func (m *Manager) persistState(accountID, symbol string, state domain.PositionState) {
	if m.store == nil || accountID == "" || symbol == "" {
		return
	}
	if err := m.store.SavePositionState(m.ctx, accountID, symbol, state); err != nil {
		log.Printf("[POSMGR] ⚠️ 保存持仓状态失败 account=%s symbol=%s ticket=%d: %v", accountID, symbol, state.Ticket, err)
	}
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

func (m *Manager) checkTimeStop(position domain.Position, state domain.PositionState, _ string, profitATR, currentATR, avgATR float64) (domain.PositionCommand, bool) {
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
	case hours > 48 && profitATR < 0.5:
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("time_48h_%.1fATR", profitATR),
		}, true
	case hours > 24 && profitATR < 0.1 && avgATR > 0 && currentATR < avgATR*0.7:
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("time_24h_%.1fATR_lowvol", profitATR),
		}, true
	default:
		return domain.PositionCommand{}, false
	}
}

func (m *Manager) checkBreakeven(position domain.Position, state *domain.PositionState, side string, profitATR float64) (domain.PositionCommand, bool) {
	if state.BEMoved || profitATR < state.BETriggerATR {
		return domain.PositionCommand{}, false
	}

	newSL := position.OpenPrice
	// 校验：新 SL 不能比已跟踪的最优 SL 更差
	if !validateNewSL(side, newSL, state.BestSL) {
		log.Printf("[POSMGR] 🛡️ #%d | 保本止损跳过: newSL=%.2f 差于 BestSL=%.2f", position.Ticket, newSL, state.BestSL)
		return domain.PositionCommand{}, false
	}

	state.BEMoved = true
	state.BestSL = newSL // 更新最优 SL
	return domain.PositionCommand{
		Action: domain.PositionActionModify,
		Ticket: position.Ticket,
		NewSL:  newSL,
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
		candle1 := h1[len(h1)-1]
		candle2 := h1[len(h1)-2]
		divergenceCount := 0
		if side == "BUY" {
			if candle2.RSI > 65 && candle1.RSI < 55 {
				divergenceCount++
			}
			if candle1.RSI < candle2.RSI {
				divergenceCount++
			}
		} else {
			if candle2.RSI < 35 && candle1.RSI > 45 {
				divergenceCount++
			}
			if candle1.RSI > candle2.RSI {
				divergenceCount++
			}
		}
		if divergenceCount >= 2 {
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

func (m *Manager) checkKeyLevel(position domain.Position, state *domain.PositionState, side string, price, atr, profitATR float64, h1 []domain.Bar) (domain.PositionCommand, bool) {
	if profitATR < 1.0 {
		return domain.PositionCommand{}, false
	}

	keyLevel := nearestKeyLevel(price, side, h1)
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
		// Require 2 consecutive candles showing EMA bearish cross
		if last.EMA20 < last.EMA50 && prev.EMA20 < prev.EMA50 {
			score += 2
			reasons = append(reasons, "EMA死叉确认(2根)")
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
		// Require 2 consecutive candles showing EMA bullish cross
		if last.EMA20 > last.EMA50 && prev.EMA20 > prev.EMA50 {
			score += 2
			reasons = append(reasons, "EMA金叉确认(2根)")
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
		// P1-6: Widen TP2 trailing drawdown tolerance from 40% to 55%
		if drawdown > state.MaxProfitATR*0.55 {
			return domain.PositionCommand{
				Action: domain.PositionActionClose,
				Ticket: position.Ticket,
				Lots:   position.Lots,
				Reason: fmt.Sprintf("trail_tp2_dd%.1f", drawdown),
			}, true
		}
		return domain.PositionCommand{}, false
	}

	// P1-6: Widen TP1 trailing from 50%+0.5ATR to 60%+0.8ATR
	if drawdown > state.MaxProfitATR*0.6 && profitATR < state.MaxProfitATR-0.8 {
		return domain.PositionCommand{
			Action: domain.PositionActionClose,
			Ticket: position.Ticket,
			Lots:   position.Lots,
			Reason: fmt.Sprintf("trail_tp1_dd%.1f", drawdown),
		}, true
	}
	return domain.PositionCommand{}, false
}

func nearestKeyLevel(price float64, side string, h1 []domain.Bar) float64 {
	levelBelow := math.Floor(price/50) * 50
	levelAbove := (math.Floor(price/50) + 1) * 50

	// Also check recent H1 highs/lows as major levels
	if len(h1) >= 20 {
		recentHigh := 0.0
		recentLow := math.Inf(1)
		for _, bar := range h1[len(h1)-20:] {
			if bar.High > recentHigh {
				recentHigh = bar.High
			}
			if bar.Low < recentLow {
				recentLow = bar.Low
			}
		}
		// Round recent high/low to nearest 50 for key level significance
		roundedHigh := math.Round(recentHigh/50) * 50
		roundedLow := math.Round(recentLow/50) * 50
		if side == "BUY" && roundedHigh > levelAbove && math.Abs(price-roundedHigh) < math.Abs(price-levelAbove) {
			levelAbove = roundedHigh
		}
		if side == "SELL" && roundedLow < levelBelow && math.Abs(price-roundedLow) < math.Abs(price-levelBelow) {
			levelBelow = roundedLow
		}
	}

	if side == "BUY" {
		return levelAbove
	}
	return levelBelow
}

// validateNewSL checks that the proposed new SL is not worse than the best SL
// ever set for this position. For BUY: newSL must be >= bestSL. For SELL: newSL must be <= bestSL.
// Returns false if the move would be backward (into more loss territory).
func validateNewSL(side string, newSL, bestSL float64) bool {
	if bestSL == 0 {
		return true // no prior SL tracked, allow any move
	}
	if side == "BUY" {
		return newSL >= bestSL
	}
	// SELL
	return newSL <= bestSL
}

func roundLots(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}
