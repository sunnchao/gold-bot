package engine

import (
	"fmt"
	"math"
	"strings"

	"gold-bot/internal/domain"
)

type Engine struct {
	MinScore int
}

func New() Engine {
	return Engine{MinScore: 5}
}

func (e Engine) Analyze(snapshot domain.AnalysisSnapshot) (*domain.Signal, []domain.AnalysisLog) {
	logs := make([]domain.AnalysisLog, 0, 8)

	h1 := snapshot.Bars["H1"]
	m30 := snapshot.Bars["M30"]
	h4 := snapshot.Bars["H4"]

	if len(h1) < 50 {
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
		h4Last := h4[len(h4)-1]
		h4ADX = h4Last.ADX
		if h4ADX > 25 {
			switch {
			case h4Last.EMA20 > h4Last.EMA50 && h4Last.Close > h4Last.EMA20:
				h4Trend = "强多头"
				h4FilterDir = "BUY"
			case h4Last.EMA20 < h4Last.EMA50 && h4Last.Close < h4Last.EMA20:
				h4Trend = "强空头"
				h4FilterDir = "SELL"
			default:
				h4Trend = "趋势不明"
			}
		} else {
			h4Trend = "震荡"
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

	signals := make([]domain.Signal, 0, 4)

	if signal, detail := e.checkPullback(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkBreakoutRetest(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkDivergence(h1, m30, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
	} else {
		logs = append(logs, detail)
	}

	if signal, detail := e.checkBreakoutPyramid(h1, price, atr); signal != nil {
		signals = append(signals, *signal)
		logs = append(logs, detail)
	} else {
		logs = append(logs, detail)
	}

	if len(signals) == 0 {
		logs = append(logs, domain.AnalysisLog{
			Level:    "info",
			Strategy: "汇总",
			Message:  "本轮无信号触发",
		})
		return nil, logs
	}

	if h4FilterDir != "" {
		filtered := make([]domain.Signal, 0, len(signals))
		for _, signal := range signals {
			if signal.Side == h4FilterDir {
				filtered = append(filtered, signal)
			}
		}
		if removed := len(signals) - len(filtered); removed > 0 {
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

	best := signals[0]
	for _, candidate := range signals[1:] {
		if candidate.Score > best.Score {
			best = candidate
		}
	}

	if best.Score < e.MinScore {
		logs = append(logs, domain.AnalysisLog{
			Level:    "info",
			Strategy: "汇总",
			Message:  fmt.Sprintf("最优信号评分 %d < 最低要求 %d,过滤", best.Score, e.MinScore),
		})
		return nil, logs
	}

	for _, position := range snapshot.Positions {
		if math.Abs(best.Entry-position.OpenPrice) < atr && strings.ToUpper(position.Type) == best.Side {
			logs = append(logs, domain.AnalysisLog{
				Level:    "warn",
				Strategy: "汇总",
				Message:  fmt.Sprintf("防重复: 已有同向持仓 @ %.2f,距离 < 1.0 ATR", position.OpenPrice),
			})
			return nil, logs
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
	return &best, logs
}

func (Engine) checkPullback(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	last := h1[len(h1)-1]
	const (
		minADX        = 20.0
		rsiOversold   = 35.0
		rsiOverbought = 65.0
	)
	name := "趋势回调"

	if last.ADX < minADX {
		return nil, domain.AnalysisLog{
			Level:    "info",
			Strategy: name,
			Message:  fmt.Sprintf("ADX=%.1f < %.0f,趋势不明显 ⏭", last.ADX, minADX),
		}
	}

	dist := math.Abs(price - last.EMA20)
	threshold := atr * 0.5

	if last.EMA20 > last.EMA50 && price > last.EMA50 {
		if dist >= threshold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("多头趋势 | 价格距EMA20=%.2f > %.2f,未回调到位 ⏭", dist, threshold),
			}
		}
		if last.RSI >= rsiOverbought {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("多头趋势 | RSI=%.1f ≥ %.0f,超买 ⏭", last.RSI, rsiOverbought),
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
		if last.ADX > 25 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>25", last.ADX))
		}

		signal := &domain.Signal{
			Side:     "BUY",
			Entry:    price,
			StopLoss: round2(price - atr*1.5),
			TP1:      round2(price + atr*1.5),
			TP2:      round2(price + atr*3.0),
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
		if dist >= threshold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("空头趋势 | 价格距EMA20=%.2f > %.2f,未回调到位 ⏭", dist, threshold),
			}
		}
		if last.RSI <= rsiOversold {
			return nil, domain.AnalysisLog{
				Level:    "info",
				Strategy: name,
				Message:  fmt.Sprintf("空头趋势 | RSI=%.1f ≤ %.0f,超卖 ⏭", last.RSI, rsiOversold),
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
		if last.ADX > 25 {
			score++
			details = append(details, fmt.Sprintf("ADX=%.1f>25", last.ADX))
		}

		signal := &domain.Signal{
			Side:     "SELL",
			Entry:    price,
			StopLoss: round2(price + atr*1.5),
			TP1:      round2(price - atr*1.5),
			TP2:      round2(price - atr*3.0),
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

func (Engine) checkBreakoutRetest(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	const lookback = 20
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

	threshold := atr * 0.5
	brokeUp := last5High > resistance
	distRes := math.Abs(price - resistance)
	if brokeUp && distRes < threshold {
		score := 5
		details := make([]string, 0, 3)
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
		return &domain.Signal{
				Side:     "BUY",
				Entry:    price,
				StopLoss: round2(resistance - atr*1.0),
				TP1:      round2(price + atr*2.0),
				TP2:      round2(price + atr*4.0),
				Score:    min(score, 10),
				Strategy: "breakout_retest",
			}, domain.AnalysisLog{
				Level:    "signal",
				Strategy: name,
				Message:  fmt.Sprintf("🟢 BUY 评分=%d | 阻力位=%.2f 突破后回踩 dist=%.2f | %s", score, resistance, distRes, strings.Join(details, " | ")),
			}
	}

	brokeDown := last5Low < support
	distSup := math.Abs(price - support)
	if brokeDown && distSup < threshold {
		score := 5
		details := make([]string, 0, 3)
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
				StopLoss: round2(support + atr*1.0),
				TP1:      round2(price - atr*2.0),
				TP2:      round2(price - atr*4.0),
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

func (Engine) checkDivergence(h1, _ []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	name := "RSI背离"
	if len(h1) < 30 {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足 ⏭"}
	}

	last := h1[len(h1)-1]
	if len(h1) < 20 {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足20根 ⏭"}
	}

	recentLow := minClose(h1[len(h1)-10:])
	prevLow := minClose(h1[len(h1)-20 : len(h1)-10])
	recentRSILow := minRSI(h1[len(h1)-10:])
	prevRSILow := minRSI(h1[len(h1)-20 : len(h1)-10])

	recentHigh := maxClose(h1[len(h1)-10:])
	prevHigh := maxClose(h1[len(h1)-20 : len(h1)-10])
	recentRSIHigh := maxRSI(h1[len(h1)-10:])
	prevRSIHigh := maxRSI(h1[len(h1)-20 : len(h1)-10])

	bullDiv := recentLow < prevLow && recentRSILow > prevRSILow
	if bullDiv && last.RSI < 40 {
		score := 6
		details := make([]string, 0, 2)
		if last.MACDHist > h1[len(h1)-2].MACDHist {
			score++
			details = append(details, "MACD改善")
		}
		if last.StochK < 20 {
			score++
			details = append(details, fmt.Sprintf("StochK=%.0f", last.StochK))
		}
		return &domain.Signal{
				Side:     "BUY",
				Entry:    price,
				StopLoss: round2(recentLow - atr*0.5),
				TP1:      round2(price + atr*2.0),
				TP2:      round2(price + atr*4.0),
				Score:    min(score, 10),
				Strategy: "divergence",
				ATRMult:  0.5,
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
	if bearDiv && last.RSI > 60 {
		score := 6
		details := make([]string, 0, 2)
		if last.MACDHist < h1[len(h1)-2].MACDHist {
			score++
			details = append(details, "MACD恶化")
		}
		if last.StochK > 80 {
			score++
			details = append(details, fmt.Sprintf("StochK=%.0f", last.StochK))
		}
		return &domain.Signal{
				Side:     "SELL",
				Entry:    price,
				StopLoss: round2(recentHigh + atr*0.5),
				TP1:      round2(price - atr*2.0),
				TP2:      round2(price - atr*4.0),
				Score:    min(score, 10),
				Strategy: "divergence",
				ATRMult:  0.5,
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
		message += fmt.Sprintf(" | 看涨背离检测到但RSI=%.1f ≥ 40", last.RSI)
	case bearDiv:
		message += fmt.Sprintf(" | 看跌背离检测到但RSI=%.1f ≤ 60", last.RSI)
	default:
		message += " | 无背离 ⏭"
	}
	return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: message}
}

func (Engine) checkBreakoutPyramid(h1 []domain.Bar, price, atr float64) (*domain.Signal, domain.AnalysisLog) {
	name := "突破加仓"
	if len(h1) < 30 {
		return nil, domain.AnalysisLog{Level: "info", Strategy: name, Message: "数据不足 ⏭"}
	}

	last := h1[len(h1)-1]
	if last.ADX < 25 {
		return nil, domain.AnalysisLog{
			Level:    "info",
			Strategy: name,
			Message:  fmt.Sprintf("ADX=%.1f < 25,趋势不够强 ⏭", last.ADX),
		}
	}

	if price > last.BBUpper && last.EMA20 > last.EMA50 {
		score := 6
		details := make([]string, 0, 3)
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
				StopLoss: round2(last.EMA20 - atr*0.5),
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
		details := make([]string, 0, 3)
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
				StopLoss: round2(last.EMA20 + atr*0.5),
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

func round2(value float64) float64 {
	return math.RoundToEven(value*100) / 100
}
