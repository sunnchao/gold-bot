package engine

import (
	"fmt"
	"log"
	"math"
	"strings"

	"gold-bot/internal/domain"
)

type Engine struct {
	MinScore int
	Config   StrategyConfig
}

func New(options ...func(*Engine)) Engine {
	e := Engine{
		MinScore: 5,
		Config:   DefaultStrategyConfig(),
	}
	for _, opt := range options {
		opt(&e)
	}
	if e.MinScore == 0 {
		e.MinScore = e.Config.MinScore
	}
	return e
}

func WithConfig(cfg StrategyConfig) func(*Engine) {
	return func(e *Engine) {
		e.Config = cfg
	}
}

func WithMinScore(score int) func(*Engine) {
	return func(e *Engine) {
		e.MinScore = score
	}
}

// NewForSymbol creates a new Engine with configuration optimized for the given symbol.
func NewForSymbol(symbol string, options ...func(*Engine)) Engine {
	baseSymbol := domain.BaseSymbol(symbol)
	cfg := GetStrategyConfigBySymbol(baseSymbol)
	e := New(append([]func(*Engine){WithConfig(cfg)}, options...)...)
	return e
}

// checkM15Entry checks M15 bars for early entry confirmation.
// Returns true if M15 RSI confirms the signal direction and price is near a Fib level.
func (e Engine) checkM15Entry(m15 []domain.Bar, side string, price float64) (bool, string) {
	cfg := e.Config
	if len(m15) < 14 {
		return false, "M15数据不足"
	}
	last := m15[len(m15)-1]

	// RSI confirmation thresholds
	bullishThreshold := cfg.M15ConfirmRSIThreshold
	bearishThreshold := 100 - bullishThreshold

	switch side {
	case "BUY":
		if last.RSI > 0 && last.RSI < bullishThreshold {
			detail := fmt.Sprintf("M15确认: RSI=%.1f<%.0f(多头)", last.RSI, bullishThreshold)
			// Bonus: price near a Fib support level
			if last.Fib382 > 0 && math.Abs(price-last.Fib382) < last.ATR*0.5 {
				detail += fmt.Sprintf(" | 近Fib382=%.2f", last.Fib382)
			} else if last.Fib618 > 0 && math.Abs(price-last.Fib618) < last.ATR*0.5 {
				detail += fmt.Sprintf(" | 近Fib618=%.2f", last.Fib618)
			}
			return true, detail
		}
		return false, fmt.Sprintf("M15未确认: RSI=%.1f≥%.0f", last.RSI, bullishThreshold)
	case "SELL":
		if last.RSI > 0 && last.RSI > bearishThreshold {
			detail := fmt.Sprintf("M15确认: RSI=%.1f>%.0f(空头)", last.RSI, bearishThreshold)
			if last.Fib382 > 0 && math.Abs(price-last.Fib382) < last.ATR*0.5 {
				detail += fmt.Sprintf(" | 近Fib382=%.2f", last.Fib382)
			} else if last.Fib618 > 0 && math.Abs(price-last.Fib618) < last.ATR*0.5 {
				detail += fmt.Sprintf(" | 近Fib618=%.2f", last.Fib618)
			}
			return true, detail
		}
		return false, fmt.Sprintf("M15未确认: RSI=%.1f≤%.0f", last.RSI, bearishThreshold)
	default:
		return false, ""
	}
}

func (e Engine) Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog) {
	logs := make([]domain.AnalysisLog, 0, 8)
	log.Printf("[STRATEGY] 🔍 开始分析 account=%s | price=%.2f | H1 bars=%d | positions=%d",
		snapshot.AccountID, snapshot.CurrentPrice, len(snapshot.Bars["H1"]), len(snapshot.Positions))

	h1 := snapshot.Bars["H1"]
	m30 := snapshot.Bars["M30"]
	h4 := snapshot.Bars["H4"]
	m15 := snapshot.Bars["M15"]

	if len(h1) < 50 {
		log.Printf("[STRATEGY] ⚠️ H1数据不足: %d/50", len(h1))
		logs = append(logs, domain.AnalysisLog{
			Level:    "warn",
			Strategy: "系统",
			Message:  fmt.Sprintf("H1数据不足: %d/50", len(h1)),
		})
		return nil, logs
	}

	price := snapshot.CurrentPrice
	atr := h1[len(h1)-1].ATR
	if price <= 0 || atr <= 0 || math.IsNaN(price) || math.IsNaN(atr) {
		log.Printf("[STRATEGY] ⚠️ 价格或ATR异常: price=%.2f, ATR=%.2f", price, atr)
		logs = append(logs, domain.AnalysisLog{
			Level:    "warn",
			Strategy: "系统",
			Message:  fmt.Sprintf("价格或ATR异常: price=%.2f, ATR=%.2f", price, atr),
		})
		return nil, logs
	}

	last := h1[len(h1)-1]
	h4Trend := "未知"
	h4ADX := 0.0
	h4FilterDir := ""
	if len(h4) >= 50 {
		cfg := e.Config
		// P3-13: Check last 3 H4 bars for EMA20 > EMA50 consistency
		h4Last := h4[len(h4)-1]
		h4ADX = h4Last.ADX

		if h4ADX < cfg.H4ADXThreshold {
			// Low ADX → range market, block new positions
			h4Trend = "震荡"
			h4FilterDir = "BLOCK"
		} else {
			// Check consecutive bars for strong directional trend
			consecutive := 0
			barsToCheck := min(cfg.H4RequireConsecutive, len(h4))
			for i := len(h4) - 1; i >= len(h4)-barsToCheck; i-- {
				bar := h4[i]
				if bar.EMA20 > bar.EMA50 && bar.Close > bar.EMA20 {
					if h4FilterDir == "" || h4FilterDir == "BUY" {
						h4FilterDir = "BUY"
						consecutive++
					}
				} else if bar.EMA20 < bar.EMA50 && bar.Close < bar.EMA20 {
					if h4FilterDir == "" || h4FilterDir == "SELL" {
						h4FilterDir = "SELL"
						consecutive++
					}
				} else {
					break
				}
			}

			if consecutive >= cfg.H4RequireConsecutive {
				if h4FilterDir == "BUY" {
					h4Trend = "强多头"
				} else {
					h4Trend = "强空头"
				}
			} else if consecutive >= 1 {
				h4Trend = "趋势不明"
				h4FilterDir = ""
			} else {
				h4Trend = "趋势不明"
				h4FilterDir = ""
			}
		}
	} else {
		logs = append(logs, domain.AnalysisLog{
			Level:    "warn",
			Strategy: "H4",
			Message:  "H4数据不足,跳过主趋势过滤",
		})
	}

	trend := "空头"
	if last.EMA20 > last.EMA50 {
		trend = "多头"
	}
	logs = append(logs, domain.AnalysisLog{
		Level:    "info",
		Strategy: "市场",
		Message: fmt.Sprintf(
			"Price=%.2f | ATR=%.2f | RSI=%.1f | ADX=%.1f | EMA趋势(H1)=%s | H4=%s(ADX=%.1f) | MACD柱=%.2f",
			price, atr, last.RSI, last.ADX, trend, h4Trend, h4ADX, last.MACDHist,
		),
	})
	log.Printf("[STRATEGY] 📊 市场状态 | Price=%.2f | ATR=%.2f | RSI=%.1f | ADX=%.1f | EMA趋势(H1)=%s | H4=%s(ADX=%.1f) | MACD柱=%.2f",
		price, atr, last.RSI, last.ADX, trend, h4Trend, h4ADX, last.MACDHist)

	signals := make([]domain.Signal, 0, 4)

	if signal, detail := e.checkPullback(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
		log.Printf("[STRATEGY] %s", detail.Message)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkBreakoutRetest(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
		log.Printf("[STRATEGY] %s", detail.Message)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkDivergence(h1, m30, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
		log.Printf("[STRATEGY] %s", detail.Message)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkBreakoutPyramid(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
		log.Printf("[STRATEGY] %s", detail.Message)
	} else {
		logs = append(logs, detail)
	}

	if len(signals) == 0 {
		log.Printf("[STRATEGY] 📭 本轮无信号触发")
		logs = append(logs, domain.AnalysisLog{
			Level:    "info",
			Strategy: "汇总",
			Message:  "本轮无信号触发",
		})
		return nil, logs
	}

	// P3-13: If H4 is in range (BLOCK), filter all signals
	if h4FilterDir == "BLOCK" {
		log.Printf("[STRATEGY] 🔒 H4=震荡 | ADX<%.0f, 过滤所有信号", e.Config.H4ADXThreshold)
		logs = append(logs, domain.AnalysisLog{
			Level:    "warn",
			Strategy: "H4过滤",
			Message:  fmt.Sprintf("H4=震荡(ADX=%.1f<%.0f), 过滤所有信号", h4ADX, e.Config.H4ADXThreshold),
		})
		return nil, logs
	}

	if h4FilterDir != "" && h4FilterDir != "BLOCK" {
		filtered := make([]domain.Signal, 0, len(signals))
		for _, signal := range signals {
			if signal.Side == h4FilterDir {
				filtered = append(filtered, signal)
			}
		}
		if removed := len(signals) - len(filtered); removed > 0 {
			log.Printf("[STRATEGY] 🔄 H4=%s | 过滤掉 %d 个逆势信号,保留 %d 个", h4Trend, removed, len(filtered))
			logs = append(logs, domain.AnalysisLog{
				Level:    "warn",
				Strategy: "H4过滤",
				Message:  fmt.Sprintf("H4=%s,过滤掉 %d 个逆势信号,保留 %d 个", h4Trend, removed, len(filtered)),
			})
		}
		signals = filtered
		if len(signals) == 0 {
			logs = append(logs, domain.AnalysisLog{
				Level:    "info",
				Strategy: "H4过滤",
				Message:  "H4趋势过滤后无信号",
			})
			return nil, logs
		}
	}

	// M15 confirmation: boost score if M15 confirms direction
	if len(m15) >= 14 {
		for i, signal := range signals {
			confirmed, detail := e.checkM15Entry(m15, signal.Side, price)
			if confirmed {
				signals[i].Score = min(signal.Score+1, 10)
				logs = append(logs, domain.AnalysisLog{
					Level:    "info",
					Strategy: "M15确认",
					Message:  fmt.Sprintf("✅ %s | %s | 评分+1→%d", signal.Strategy, detail, signals[i].Score),
				})
			} else {
				logs = append(logs, domain.AnalysisLog{
					Level:    "info",
					Strategy: "M15确认",
					Message:  fmt.Sprintf("⏭ %s | %s", signal.Strategy, detail),
				})
			}
		}
	}

	best := signals[0]
	for _, candidate := range signals[1:] {
		if candidate.Score > best.Score {
			best = candidate
		}
	}

	minScore := e.MinScore
	if minScore == 0 {
		minScore = e.Config.MinScore
	}
	if best.Score < minScore {
		log.Printf("[STRATEGY] ⏭ 最优信号评分 %d < 最低要求 %d,过滤", best.Score, minScore)
		logs = append(logs, domain.AnalysisLog{
			Level:    "info",
			Strategy: "汇总",
			Message:  fmt.Sprintf("最优信号评分 %d < 最低要求 %d,过滤", best.Score, minScore),
		})
		return nil, logs
	}

	// P0-3: Anti-duplicate logic with reverse position check
	for _, position := range snapshot.Positions {
		dist := math.Abs(best.Entry - position.OpenPrice)
		posSide := strings.ToUpper(position.Type)
		if posSide == best.Side {
			// Same-direction: block if within 1 ATR
			if dist < atr {
				log.Printf("[STRATEGY] 🔒 防重复: 已有同向持仓 @ %.2f,距离 < 1.0 ATR", position.OpenPrice)
				logs = append(logs, domain.AnalysisLog{
					Level:    "warn",
					Strategy: "汇总",
					Message:  fmt.Sprintf("防重复: 已有同向持仓 @ %.2f,距离 < 1.0 ATR", position.OpenPrice),
				})
				return nil, logs
			}
		} else {
			// Reverse-direction: block if within 2 ATR (prevent hedging)
			if dist < atr*2 {
				log.Printf("[STRATEGY] 🔒 防对冲: 已有反向持仓 @ %.2f,距离 < 2.0 ATR", position.OpenPrice)
				logs = append(logs, domain.AnalysisLog{
					Level:    "warn",
					Strategy: "汇总",
					Message:  fmt.Sprintf("防对冲: 已有反向持仓 @ %.2f,距离 < 2.0 ATR", position.OpenPrice),
				})
				return nil, logs
			}
		}
	}

	best.ATR = atr
	best.AllStrategies = make([]domain.StrategyScore, 0, len(signals))
	for _, signal := range signals {
		best.AllStrategies = append(best.AllStrategies, domain.StrategyScore{
			Strategy: signal.Strategy,
			Side:     signal.Side,
			Score:    signal.Score,
			Entry:    signal.Entry,
			StopLoss: signal.StopLoss,
		})
	}

	logs = append(logs, domain.AnalysisLog{
		Level:    "signal",
		Strategy: "汇总",
		Message: fmt.Sprintf(
			"✅ 发出信号: %s @ %.2f | SL=%.2f | 策略=%s | 评分=%d",
			best.Side, best.Entry, best.StopLoss, best.Strategy, best.Score,
		),
	})
	log.Printf("[STRATEGY] ✅ 发出信号: %s @ %.2f | SL=%.2f | TP1=%.2f | TP2=%.2f | 策略=%s | 评分=%d",
		best.Side, best.Entry, best.StopLoss, best.TP1, best.TP2, best.Strategy, best.Score)
	return &best, logs
}

func (e Engine) checkPullback(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	cfg := e.Config
	last := h1[len(h1)-1]

	name := "趋势回调"

	if last.ADX < cfg.PullbackMinADX {
		return nil, domain.AnalysisLog{
			Level:    "info",
			Strategy: name,
			Message:  fmt.Sprintf("ADX=%.1f < %.0f,趋势不明显 ⏭", last.ADX, cfg.PullbackMinADX),
		}
	}

	dist := math.Abs(price - last.EMA20)
	threshold := atr * cfg.PullbackDistATR

	// P1-5: Require 2 consecutive candles near EMA20
	nearEMA := false
	if len(h1) >= 2 {
		last2 := h1[len(h1)-2]
		dist1 := math.Abs(last2.Close - last2.EMA20)
		dist2 := math.Abs(last.Close - last.EMA20)
		nearEMA = dist1 < threshold && dist2 < threshold
	}

	if last.EMA20 > last.EMA50 && price > last.EMA50 {
		if !nearEMA && dist >= threshold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("多头趋势 | 价格距EMA20=%.2f > %.2f,未回调到位 ⏭", dist, threshold),
			}
		}
		if last.RSI >= cfg.PullbackRSIOverbought {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("多头趋势 | RSI=%.1f ≥ %.0f,超买 ⏭", last.RSI, cfg.PullbackRSIOverbought),
			}
		}

		score := 5
		details := make([]string, 0, 3)
		if last.MACDHist > 0 {
			score++
			details = append(details, "MACD柱>0")
		}
		if last.RSI < 50 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f<50", last.RSI))
		}
		if last.ADX > cfg.PullbackADXBonus {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>%.0f", last.ADX, cfg.PullbackADXBonus))
		}
		if nearEMA {
			score++
			details = append(details, "连续2根回调到位")
		}

		signal := &domain.Signal{
			Side:     "BUY",
			Entry:    price,
			StopLoss: round2(price - atr*cfg.PullbackSLATR),
			TP1:      round2(price + atr*cfg.PullbackTP1ATR),
			TP2:      round2(price + atr*cfg.PullbackTP2ATR),
			Score:    min(score, 10),
			Strategy: "pullback",
		}
		return signal, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🟢 BUY 评分=%d | EMA20回调 dist=%.2f | %s", score, dist, strings.Join(details, " | ")),
		}
	}

	if last.EMA20 < last.EMA50 && price < last.EMA50 {
		if !nearEMA && dist >= threshold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("空头趋势 | 价格距EMA20=%.2f > %.2f,未回调到位 ⏭", dist, threshold),
			}
		}
		if last.RSI <= cfg.PullbackRSIOversold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("空头趋势 | RSI=%.1f ≤ %.0f,超卖 ⏭", last.RSI, cfg.PullbackRSIOversold),
			}
		}

		score := 5
		details := make([]string, 0, 3)
		if last.MACDHist < 0 {
			score++
			details = append(details, "MACD柱<0")
		}
		if last.RSI > 50 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f>50", last.RSI))
		}
		if last.ADX > cfg.PullbackADXBonus {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>%.0f", last.ADX, cfg.PullbackADXBonus))
		}
		if nearEMA {
			score++
			details = append(details, "连续2根回调到位")
		}

		signal := &domain.Signal{
			Side:     "SELL",
			Entry:    price,
			StopLoss: round2(price + atr*cfg.PullbackSLATR),
			TP1:      round2(price - atr*cfg.PullbackTP1ATR),
			TP2:      round2(price - atr*cfg.PullbackTP2ATR),
			Score:    min(score, 10),
			Strategy: "pullback",
		}
		return signal, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🔴 SELL 评分=%d | EMA20回调 dist=%.2f | %s", score, dist, strings.Join(details, " | ")),
		}
	}

	return nil, domain.AnalysisLog{
		Level:    "info",
		Strategy: name,
		Message:  fmt.Sprintf("EMA20=%.2f vs EMA50=%.2f | 价格=%.2f 不符合回调条件 ⏭", last.EMA20, last.EMA50, price),
	}
}

func (e Engine) checkBreakoutRetest(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	cfg := e.Config
	lookback := cfg.BreakoutRetestLookback
	confirmWindow := cfg.BreakoutRetestConfirmWindow
	name := "突破回踩"

	if len(h1) < lookback+5 {
		return nil, domain.AnalysisLog{
			Level:    "info",
			Strategy: name,
			Message:  fmt.Sprintf("数据不足 %d/%d ⏭", len(h1), lookback+5),
		}
	}

	recent := h1[len(h1)-lookback-5 : len(h1)-5]
	last5 := h1[len(h1)-5:]
	last := h1[len(h1)-1]

	resistance := recent[0].High
	support := recent[0].Low
	for _, bar := range recent[1:] {
		if bar.High > resistance {
			resistance = bar.High
		}
		if bar.Low < support {
			support = bar.Low
		}
	}

	last5High := last5[0].High
	last5Low := last5[0].Low
	for _, bar := range last5[1:] {
		if bar.High > last5High {
			last5High = bar.High
		}
		if bar.Low < last5Low {
			last5Low = bar.Low
		}
	}

	threshold := atr * cfg.BreakoutRetestDistATR
	brokeUp := last5High > resistance
	brokeDown := last5Low < support

	// P1-5: Require confirmWindow candles touching the broken level
	touchCount1 := 0
	for i := len(h1) - confirmWindow; i < len(h1); i++ {
		if i < 0 {
			continue
		}
		bar := h1[i]
		if brokeUp && math.Abs(bar.Low-resistance) < threshold {
			touchCount1++
		}
		if brokeDown && math.Abs(bar.High-support) < threshold {
			touchCount1++
		}
	}

	distRes := math.Abs(price - resistance)
	if brokeUp && distRes < threshold && touchCount1 >= 1 {
		score := 5
		details := make([]string, 0, 4)

		// P3-11: Volume confirmation
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) > 1.5*last.VolSMA {
			score++
			details = append(details, "成交量确认")
		}

		if last.MACDHist > 0 {
			score++
			details = append(details, "MACD柱>0")
		}
		if last.ADX > 20 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f", last.ADX))
		}
		if last.RSI > 50 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f", last.RSI))
		}
		if touchCount1 >= 2 {
			score++
			details = append(details, fmt.Sprintf("回踩确认%d根", touchCount1))
		}
		return &domain.Signal{
			Side:     "BUY",
			Entry:    price,
			StopLoss: round2(resistance - atr*cfg.BreakoutRetestSLATR),
			TP1:      round2(price + atr*cfg.BreakoutRetestTP1ATR),
			TP2:      round2(price + atr*cfg.BreakoutRetestTP2ATR),
			Score:    min(score, 10),
			Strategy: "breakout_retest",
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🟢 BUY 评分=%d | 阻力位=%.2f 突破后回踩 dist=%.2f | %s", score, resistance, distRes, strings.Join(details, " | ")),
		}
	}

	distSup := math.Abs(price - support)
	if brokeDown && distSup < threshold && touchCount1 >= 1 {
		score := 5
		details := make([]string, 0, 4)

		// P3-11: Volume confirmation
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) > 1.5*last.VolSMA {
			score++
			details = append(details, "成交量确认")
		}

		if last.MACDHist < 0 {
			score++
			details = append(details, "MACD柱<0")
		}
		if last.ADX > 20 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f", last.ADX))
		}
		if last.RSI < 50 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f", last.RSI))
		}
		return &domain.Signal{
			Side:     "SELL",
			Entry:    price,
			StopLoss: round2(support + atr*cfg.BreakoutRetestSLATR),
			TP1:      round2(price - atr*cfg.BreakoutRetestTP1ATR),
			TP2:      round2(price - atr*cfg.BreakoutRetestTP2ATR),
			Score:    min(score, 10),
			Strategy: "breakout_retest",
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🔴 SELL 评分=%d | 支撑位=%.2f 突破后回踩 dist=%.2f | %s", score, support, distSup, strings.Join(details, " | ")),
		}
	}

	message := fmt.Sprintf("阻力=%.2f 支撑=%.2f", resistance, support)
	switch {
	case brokeUp:
		message += fmt.Sprintf(" | 上破✓ 但回踩距离=%.2f > %.2f", distRes, threshold)
	case brokeDown:
		message += fmt.Sprintf(" | 下破✓ 但回踩距离=%.2f > %.2f", distSup, threshold)
	default:
		message += " | 未突破 ⏭"
	}
	return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: message}
}

func (e Engine) checkDivergence(h1, _ []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	cfg := e.Config
	name := "RSI背离"
	if len(h1) < 30 {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足 ⏭"}
	}

	last := h1[len(h1)-1]
	windowRecent := cfg.DivergenceWindowRecent
	windowPrev := cfg.DivergenceWindowPrev
	if len(h1) < windowRecent+windowPrev {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足检测背离 ⏭"}
	}

	recentLow := minClose(h1[len(h1)-windowRecent:])
	prevLow := minClose(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])
	recentRSILow := minRSI(h1[len(h1)-windowRecent:])
	prevRSILow := minRSI(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])

	recentHigh := maxClose(h1[len(h1)-windowRecent:])
	prevHigh := maxClose(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])
	recentRSIHigh := maxRSI(h1[len(h1)-windowRecent:])
	prevRSIHigh := maxRSI(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])

	bullDiv := recentLow < prevLow && recentRSILow > prevRSILow
	if bullDiv && last.RSI < cfg.DivergenceRSIBullThresh {
		score := 6
		details := make([]string, 0, 3)

		// P3-12: MACD divergence as secondary confirmation
		macdRecentLow := minMACDHist(h1[len(h1)-windowRecent:])
		macdPrevLow := minMACDHist(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])
		if macdRecentLow > macdPrevLow {
			score++
			details = append(details, "MACD背离确认")
		} else if last.MACDHist > h1[len(h1)-2].MACDHist {
			score++
			details = append(details, "MACD改善")
		}

		// P3-11: Volume shrinking at divergence bottom
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) < 0.7*last.VolSMA {
			score++
			details = append(details, "成交量萎缩")
		}

		if last.StochK < 20 {
			score++
			details = append(details, fmt.Sprintf("StochK=%.0f", last.StochK))
		}
		return &domain.Signal{
			Side:     "BUY",
			Entry:    price,
			StopLoss: round2(recentLow - atr*cfg.DivergenceSLATR),
			TP1:      round2(price + atr*cfg.DivergenceTP1ATR),
			TP2:      round2(price + atr*cfg.DivergenceTP2ATR),
			Score:    min(score, 10),
			Strategy: "divergence",
			ATRMult:  cfg.DivergenceSLATR,
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message: fmt.Sprintf(
				"🟢 BUY 评分=%d | 看涨背离: 价格新低%.2f<%.2f RSI抬高%.1f>%.1f | %s",
				score, recentLow, prevLow, recentRSILow, prevRSILow, strings.Join(details, " | "),
			),
		}
	}

	bearDiv := recentHigh > prevHigh && recentRSIHigh < prevRSIHigh
	if bearDiv && last.RSI > cfg.DivergenceRSIBearThresh {
		score := 6
		details := make([]string, 0, 3)

		// P3-12: MACD divergence as secondary confirmation
		macdRecentHigh := maxMACDHist(h1[len(h1)-windowRecent:])
		macdPrevHigh := maxMACDHist(h1[len(h1)-windowRecent-windowPrev : len(h1)-windowRecent])
		if macdRecentHigh < macdPrevHigh {
			score++
			details = append(details, "MACD背离确认")
		} else if last.MACDHist < h1[len(h1)-2].MACDHist {
			score++
			details = append(details, "MACD恶化")
		}

		// P3-11: Volume shrinking at divergence top
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) < 0.7*last.VolSMA {
			score++
			details = append(details, "成交量萎缩")
		}

		if last.StochK > 80 {
			score++
			details = append(details, fmt.Sprintf("StochK=%.0f", last.StochK))
		}
		return &domain.Signal{
			Side:     "SELL",
			Entry:    price,
			StopLoss: round2(recentHigh + atr*cfg.DivergenceSLATR),
			TP1:      round2(price - atr*cfg.DivergenceTP1ATR),
			TP2:      round2(price - atr*cfg.DivergenceTP2ATR),
			Score:    min(score, 10),
			Strategy: "divergence",
			ATRMult:  cfg.DivergenceSLATR,
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message: fmt.Sprintf(
				"🔴 SELL 评分=%d | 看跌背离: 价格新高%.2f>%.2f RSI降低%.1f<%.1f | %s",
				score, recentHigh, prevHigh, recentRSIHigh, prevRSIHigh, strings.Join(details, " | "),
			),
		}
	}

	message := fmt.Sprintf("RSI=%.1f", last.RSI)
	switch {
	case bullDiv:
		message += fmt.Sprintf(" | 看涨背离检测到但RSI=%.1f ≥ %.0f", last.RSI, cfg.DivergenceRSIBullThresh)
	case bearDiv:
		message += fmt.Sprintf(" | 看跌背离检测到但RSI=%.1f ≤ %.0f", last.RSI, cfg.DivergenceRSIBearThresh)
	default:
		message += " | 无背离 ⏭"
	}
	return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: message}
}

func (e Engine) checkBreakoutPyramid(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	cfg := e.Config
	name := "突破加仓"
	if len(h1) < 30 {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足 ⏭"}
	}

	last := h1[len(h1)-1]
	if last.ADX < cfg.BreakoutPyramidMinADX {
		return nil, domain.AnalysisLog{
			Level:    "info",
			Strategy: name,
			Message:  fmt.Sprintf("ADX=%.1f < %.0f,趋势不够强 ⏭", last.ADX, cfg.BreakoutPyramidMinADX),
		}
	}

	if price > last.BBUpper && last.EMA20 > last.EMA50 {
		score := 6
		details := make([]string, 0, 4)

		// P3-11: Volume confirmation
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) > 1.5*last.VolSMA {
			score++
			details = append(details, "成交量确认")
		}

		if last.ADX > 30 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>30", last.ADX))
		}
		if last.RSI > 55 && last.RSI < 80 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f", last.RSI))
		}
		if last.MACDHist > 0 {
			score++
			details = append(details, "MACD柱>0")
		}
		return &domain.Signal{
			Side:     "BUY",
			Entry:    price,
			StopLoss: round2(last.EMA20 - atr*cfg.BreakoutPyramidSLATR),
			TP1:      round2(price + atr*2.0),
			TP2:      round2(price + atr*5.0),
			Score:    min(score, 10),
			Strategy: "breakout_pyramid",
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🟢 BUY 评分=%d | 突破布林上轨=%.2f | %s", score, last.BBUpper, strings.Join(details, " | ")),
		}
	}

	if price < last.BBLower && last.EMA20 < last.EMA50 {
		score := 6
		details := make([]string, 0, 4)

		// P3-11: Volume confirmation
		if last.VolSMA > 0 && last.Volume > 0 && float64(last.Volume) > 1.5*last.VolSMA {
			score++
			details = append(details, "成交量确认")
		}

		if last.ADX > 30 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>30", last.ADX))
		}
		if last.RSI < 45 && last.RSI > 20 {
			score++
			details = append(details, fmt.Sprintf("RSI=%.1f", last.RSI))
		}
		if last.MACDHist < 0 {
			score++
			details = append(details, "MACD柱<0")
		}
		return &domain.Signal{
			Side:     "SELL",
			Entry:    price,
			StopLoss: round2(last.EMA20 + atr*cfg.BreakoutPyramidSLATR),
			TP1:      round2(price - atr*2.0),
			TP2:      round2(price - atr*5.0),
			Score:    min(score, 10),
			Strategy: "breakout_pyramid",
		}, domain.AnalysisLog{
			Level:    "signal",
			Strategy: name,
			Message:  fmt.Sprintf("🔴 SELL 评分=%d | 突破布林下轨=%.2f | %s", score, last.BBLower, strings.Join(details, " | ")),
		}
	}

	message := fmt.Sprintf("BB=[%.2f, %.2f] Price=%.2f", last.BBLower, last.BBUpper, price)
	switch {
	case price > last.BBUpper:
		message += " | 突破上轨但EMA20<EMA50趋势不一致"
	case price < last.BBLower:
		message += " | 突破下轨但EMA20>EMA50趋势不一致"
	default:
		message += " | 在通道内 ⏭"
	}
	return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: message}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func minClose(bars []domain.Bar) float64 {
	value := bars[0].Close
	for _, bar := range bars[1:] {
		if bar.Close < value {
			value = bar.Close
		}
	}
	return value
}

func maxClose(bars []domain.Bar) float64 {
	value := bars[0].Close
	for _, bar := range bars[1:] {
		if bar.Close > value {
			value = bar.Close
		}
	}
	return value
}

func minRSI(bars []domain.Bar) float64 {
	value := bars[0].RSI
	for _, bar := range bars[1:] {
		if bar.RSI < value {
			value = bar.RSI
		}
	}
	return value
}

func maxRSI(bars []domain.Bar) float64 {
	value := bars[0].RSI
	for _, bar := range bars[1:] {
		if bar.RSI > value {
			value = bar.RSI
		}
	}
	return value
}

func minMACDHist(bars []domain.Bar) float64 {
	value := bars[0].MACDHist
	for _, bar := range bars[1:] {
		if bar.MACDHist < value {
			value = bar.MACDHist
		}
	}
	return value
}

func maxMACDHist(bars []domain.Bar) float64 {
	value := bars[0].MACDHist
	for _, bar := range bars[1:] {
		if bar.MACDHist > value {
			value = bar.MACDHist
		}
	}
	return value
}

func round2(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}