package indicator

import (
	"math"

	"gold-bot/internal/domain"
)

// DivergenceType 定义背离类型
type DivergenceType string

const (
	DivBullishMACD DivergenceType = "bullish_macd"
	DivBearishMACD DivergenceType = "bearish_macd"
	DivBullishRSI  DivergenceType = "bullish_rsi"
	DivBearishRSI  DivergenceType = "bearish_rsi"
)

// DivergenceSignal 背离信号
type DivergenceSignal struct {
	Type       DivergenceType `json:"type"`
	Strength   string         `json:"strength"`   // "strong" | "moderate" | "weak"
	Confidence float64        `json:"confidence"` // 0.0 ~ 1.0
	PriceLevel float64        `json:"price_level"`
	Time       string         `json:"time"`
}

// DetectMACDDivergence 检测 MACD 背离
// 算法：在最近的 N 根 K 线中找价格极值点和 MACD 极值点
// Bullish: 价格创新低，但 MACD 未创新低 (或 MACD 走高)
// Bearish: 价格创新高，但 MACD 未创新高 (或 MACD 走低)
func DetectMACDDivergence(bars []domain.Bar) *DivergenceSignal {
	if len(bars) < 20 {
		return nil
	}

	// 使用最近 20 根 K 线
	lookback := 20
	if len(bars) < lookback {
		lookback = len(bars)
	}

	recent := bars[len(bars)-lookback:]

	// 找价格低点和 MACD 低点的对应关系
	priceLows := findLocalLows(recent, 3)
	priceHighs := findLocalHighs(recent, 3)

	// 找 MACD 低点和高点
	macdLows := findMACDLows(recent, 3)
	macdHighs := findMACDHighs(recent, 3)

	// 检测 Bullish MACD Divergence
	if len(priceLows) >= 2 && len(macdLows) >= 2 {
		// 最新的两个价格低点
		pl1, pl2 := priceLows[len(priceLows)-2], priceLows[len(priceLows)-1]
		// 对应的 MACD 低点
		ml1, ml2 := findCorrespondingMACDLows(recent, pl1, pl2)

		if pl1 != -1 && pl2 != -1 && ml1 != -1 && ml2 != -1 {
			// 价格创新低，但 MACD 未创新低
			if recent[pl2].Low < recent[pl1].Low && recent[ml2].MACDHist >= recent[ml1].MACDHist {
				strength := calculateDivergenceStrength(recent, pl1, pl2, ml1, ml2, "bullish")
				return &DivergenceSignal{
					Type:       DivBullishMACD,
					Strength:   strength,
					Confidence: calculateConfidence(recent, pl1, pl2, ml1, ml2, "bullish"),
					PriceLevel: recent[pl2].Low,
					Time:       recent[pl2].Time,
				}
			}
		}
	}

	// 检测 Bearish MACD Divergence
	if len(priceHighs) >= 2 && len(macdHighs) >= 2 {
		ph1, ph2 := priceHighs[len(priceHighs)-2], priceHighs[len(priceHighs)-1]
		mh1, mh2 := findCorrespondingMACDHighs(recent, ph1, ph2)

		if ph1 != -1 && ph2 != -1 && mh1 != -1 && mh2 != -1 {
			// 价格创新高，但 MACD 未创新高
			if recent[ph2].High > recent[ph1].High && recent[mh2].MACDHist <= recent[mh1].MACDHist {
				strength := calculateDivergenceStrength(recent, ph1, ph2, mh1, mh2, "bearish")
				return &DivergenceSignal{
					Type:       DivBearishMACD,
					Strength:   strength,
					Confidence: calculateConfidence(recent, ph1, ph2, mh1, mh2, "bearish"),
					PriceLevel: recent[ph2].High,
					Time:       recent[ph2].Time,
				}
			}
		}
	}

	return nil
}

// DetectRSIDivergence 检测 RSI 背离
func DetectRSIDivergence(bars []domain.Bar) *DivergenceSignal {
	if len(bars) < 20 {
		return nil
	}

	lookback := 20
	if len(bars) < lookback {
		lookback = len(bars)
	}

	recent := bars[len(bars)-lookback:]

	// 找价格低点和 RSI 低点
	priceLows := findLocalLows(recent, 3)
	priceHighs := findLocalHighs(recent, 3)

	// Bullish RSI Divergence
	if len(priceLows) >= 2 {
		pl1, pl2 := priceLows[len(priceLows)-2], priceLows[len(priceLows)-1]
		if pl1 != -1 && pl2 != -1 {
			// 价格创新低，但 RSI 未创新低
			rsi1 := recent[pl1].RSI
			rsi2 := recent[pl2].RSI
			if !math.IsNaN(rsi1) && !math.IsNaN(rsi2) &&
				recent[pl2].Low < recent[pl1].Low && rsi2 > rsi1 {
				strength := calculateRSIDivergenceStrength(recent, pl1, pl2, "bullish")
				return &DivergenceSignal{
					Type:       DivBullishRSI,
					Strength:   strength,
					Confidence: calculateRSIConfidence(recent, pl1, pl2, "bullish"),
					PriceLevel: recent[pl2].Low,
					Time:       recent[pl2].Time,
				}
			}
		}
	}

	// Bearish RSI Divergence
	if len(priceHighs) >= 2 {
		ph1, ph2 := priceHighs[len(priceHighs)-2], priceHighs[len(priceHighs)-1]
		if ph1 != -1 && ph2 != -1 {
			// 价格创新高，但 RSI 未创新高
			rsi1 := recent[ph1].RSI
			rsi2 := recent[ph2].RSI
			if !math.IsNaN(rsi1) && !math.IsNaN(rsi2) &&
				recent[ph2].High > recent[ph1].High && rsi2 < rsi1 {
				strength := calculateRSIDivergenceStrength(recent, ph1, ph2, "bearish")
				return &DivergenceSignal{
					Type:       DivBearishRSI,
					Strength:   strength,
					Confidence: calculateRSIConfidence(recent, ph1, ph2, "bearish"),
					PriceLevel: recent[ph2].High,
					Time:       recent[ph2].Time,
				}
			}
		}
	}

	return nil
}

// findLocalLows 找局部低点（左右各 minBars 根 K 线内最低）
func findLocalLows(bars []domain.Bar, minBars int) []int {
	var lows []int
	for i := minBars; i < len(bars)-minBars; i++ {
		isLow := true
		for j := i - minBars; j <= i+minBars; j++ {
			if j != i && bars[j].Low <= bars[i].Low {
				isLow = false
				break
			}
		}
		if isLow {
			lows = append(lows, i)
		}
	}
	return lows
}

// findLocalHighs 找局部高点
func findLocalHighs(bars []domain.Bar, minBars int) []int {
	var highs []int
	for i := minBars; i < len(bars)-minBars; i++ {
		isHigh := true
		for j := i - minBars; j <= i+minBars; j++ {
			if j != i && bars[j].High >= bars[i].High {
				isHigh = false
				break
			}
		}
		if isHigh {
			highs = append(highs, i)
		}
	}
	return highs
}

// findMACDLows 找 MACD 柱状图局部低点
func findMACDLows(bars []domain.Bar, minBars int) []int {
	var lows []int
	for i := minBars; i < len(bars)-minBars; i++ {
		if math.IsNaN(bars[i].MACDHist) {
			continue
		}
		isLow := true
		for j := i - minBars; j <= i+minBars; j++ {
			if j != i && !math.IsNaN(bars[j].MACDHist) && bars[j].MACDHist <= bars[i].MACDHist {
				isLow = false
				break
			}
		}
		if isLow {
			lows = append(lows, i)
		}
	}
	return lows
}

// findMACDHighs 找 MACD 柱状图局部高点
func findMACDHighs(bars []domain.Bar, minBars int) []int {
	var highs []int
	for i := minBars; i < len(bars)-minBars; i++ {
		if math.IsNaN(bars[i].MACDHist) {
			continue
		}
		isHigh := true
		for j := i - minBars; j <= i+minBars; j++ {
			if j != i && !math.IsNaN(bars[j].MACDHist) && bars[j].MACDHist >= bars[i].MACDHist {
				isHigh = false
				break
			}
		}
		if isHigh {
			highs = append(highs, i)
		}
	}
	return highs
}

// findCorrespondingMACDLows 找与价格低点对应的 MACD 低点
func findCorrespondingMACDLows(bars []domain.Bar, pl1, pl2 int) (int, int) {
	// 简单实现：找价格低点附近 (±2) 的 MACD 低点
	ml1 := findNearestMACDLow(bars, pl1)
	ml2 := findNearestMACDLow(bars, pl2)
	return ml1, ml2
}

// findCorrespondingMACDHighs 找与价格高点对应的 MACD 高点
func findCorrespondingMACDHighs(bars []domain.Bar, ph1, ph2 int) (int, int) {
	mh1 := findNearestMACDHigh(bars, ph1)
	mh2 := findNearestMACDHigh(bars, ph2)
	return mh1, mh2
}

// findNearestMACDLow 找最近的 MACD 低点
func findNearestMACDLow(bars []domain.Bar, idx int) int {
	best := -1
	bestDist := 999
	for i := 0; i < len(bars); i++ {
		if math.IsNaN(bars[i].MACDHist) {
			continue
		}
		// 检查是否是局部低点
		isLow := true
		for j := max(0, i-2); j <= min(len(bars)-1, i+2); j++ {
			if j != i && !math.IsNaN(bars[j].MACDHist) && bars[j].MACDHist <= bars[i].MACDHist {
				isLow = false
				break
			}
		}
		if isLow {
			dist := abs(i - idx)
			if dist < bestDist {
				bestDist = dist
				best = i
			}
		}
	}
	return best
}

// findNearestMACDHigh 找最近的 MACD 高点
func findNearestMACDHigh(bars []domain.Bar, idx int) int {
	best := -1
	bestDist := 999
	for i := 0; i < len(bars); i++ {
		if math.IsNaN(bars[i].MACDHist) {
			continue
		}
		isHigh := true
		for j := max(0, i-2); j <= min(len(bars)-1, i+2); j++ {
			if j != i && !math.IsNaN(bars[j].MACDHist) && bars[j].MACDHist >= bars[i].MACDHist {
				isHigh = false
				break
			}
		}
		if isHigh {
			dist := abs(i - idx)
			if dist < bestDist {
				bestDist = dist
				best = i
			}
		}
	}
	return best
}

// calculateDivergenceStrength 计算背离强度
func calculateDivergenceStrength(bars []domain.Bar, p1, p2, m1, m2 int, direction string) string {
	priceDiff := math.Abs(bars[p2].Low - bars[p1].Low)
	macdDiff := math.Abs(bars[m2].MACDHist - bars[m1].MACDHist)

	// 价格差异大但 MACD 差异小 = 强背离
	ratio := priceDiff / (macdDiff + 0.0001)
	if ratio > 3.0 {
		return "strong"
	} else if ratio > 1.5 {
		return "moderate"
	}
	return "weak"
}

// calculateRSIDivergenceStrength 计算 RSI 背离强度
func calculateRSIDivergenceStrength(bars []domain.Bar, p1, p2 int, direction string) string {
	rsiDiff := math.Abs(bars[p2].RSI - bars[p1].RSI)
	if rsiDiff > 10 {
		return "strong"
	} else if rsiDiff > 5 {
		return "moderate"
	}
	return "weak"
}

// calculateConfidence 计算 MACD 背离置信度
func calculateConfidence(bars []domain.Bar, p1, p2, m1, m2 int, direction string) float64 {
	// 基于多个因素计算
	score := 0.5

	// 价格差异程度
	if p1 >= 0 && p2 >= 0 {
		priceDiff := math.Abs(bars[p2].Low - bars[p1].Low) / bars[p1].Low
		if priceDiff > 0.01 {
			score += 0.1
		}
	}

	// MACD 差异程度
	if m1 >= 0 && m2 >= 0 && !math.IsNaN(bars[m1].MACDHist) && !math.IsNaN(bars[m2].MACDHist) {
		macdDiff := math.Abs(bars[m2].MACDHist - bars[m1].MACDHist)
		if macdDiff > 0.1 {
			score += 0.1
		}
	}

	// 时间间隔（越长越可靠）
	if p2 > p1 {
		barsBetween := p2 - p1
		if barsBetween > 5 {
			score += 0.1
		}
	}

	return math.Min(score, 1.0)
}

// calculateRSIConfidence 计算 RSI 背离置信度
func calculateRSIConfidence(bars []domain.Bar, p1, p2 int, direction string) float64 {
	score := 0.5

	if p1 >= 0 && p2 >= 0 && !math.IsNaN(bars[p1].RSI) && !math.IsNaN(bars[p2].RSI) {
		rsiDiff := math.Abs(bars[p2].RSI - bars[p1].RSI)
		if rsiDiff > 5 {
			score += 0.2
		}
		if rsiDiff > 10 {
			score += 0.1
		}
	}

	// RSI 在极端区域更可靠
	if p2 >= 0 && !math.IsNaN(bars[p2].RSI) {
		if bars[p2].RSI < 30 || bars[p2].RSI > 70 {
			score += 0.1
		}
	}

	return math.Min(score, 1.0)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}
