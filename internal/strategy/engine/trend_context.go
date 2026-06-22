package engine

import (
	"log"
	"strings"

	"gold-bot/internal/domain"
)

// TrendContext holds multi-timeframe trend information.
// Weighted confidence from 0.0 (no signal) to 1.0 (strong trend).
type TrendContext struct {
	D1Direction  string
	H4Direction  string
	H1Direction  string
	M30Direction string
	M15Direction string

	D1Weight  float64
	H4Weight  float64
	H1Weight  float64
	M30Weight float64

	ConsensusDirection string
	ConsensusStrength  float64

	D1ADX  float64
	H4ADX  float64
	H1ADX  float64
	M30ADX float64
}

// TrendRating describes how the trend context adjusts a signal.
type TrendRating struct {
	Penalty       int
	LotMultiplier float64
	Reason        string
}

// BuildTrendContext builds a multi-timeframe trend consensus.
func BuildTrendContext(d1, h4, h1, m30, m15 []domain.Bar, cfg TrendConfig) TrendContext {
	tc := TrendContext{
		D1Weight:  cfg.D1Weight,
		H4Weight:  cfg.H4Weight,
		H1Weight:  cfg.H1Weight,
		M30Weight: cfg.M30Weight,
	}

	// Determine direction for each timeframe
	tc.D1Direction, tc.D1ADX = barDirection(d1)
	tc.H4Direction, tc.H4ADX = barDirection(h4)
	tc.H1Direction, tc.H1ADX = barDirection(h1)
	tc.M30Direction, tc.M30ADX = barDirection(m30)
	tc.M15Direction = m15Direction(m15)

	// Compute confidence scores
	d1Conf := confidence(tc.D1Direction, tc.D1ADX, cfg)
	h4Conf := confidence(tc.H4Direction, tc.H4ADX, cfg)
	h1Conf := confidence(tc.H1Direction, tc.H1ADX, cfg)
	m30Conf := confidence(tc.M30Direction, tc.M30ADX, cfg)

	// Weighted consensus strength
	tc.ConsensusStrength = tc.D1Weight*d1Conf + tc.H4Weight*h4Conf + tc.H1Weight*h1Conf + tc.M30Weight*m30Conf

	// Weighted vote for consensus direction
	bullWeight := 0.0
	bearWeight := 0.0
	if tc.D1Direction == "BULL" {
		bullWeight += tc.D1Weight
	} else if tc.D1Direction == "BEAR" {
		bearWeight += tc.D1Weight
	}
	if tc.H4Direction == "BULL" {
		bullWeight += tc.H4Weight
	} else if tc.H4Direction == "BEAR" {
		bearWeight += tc.H4Weight
	}
	if tc.H1Direction == "BULL" {
		bullWeight += tc.H1Weight
	} else if tc.H1Direction == "BEAR" {
		bearWeight += tc.H1Weight
	}
	if tc.M30Direction == "BULL" {
		bullWeight += tc.M30Weight
	} else if tc.M30Direction == "BEAR" {
		bearWeight += tc.M30Weight
	}

	if bullWeight > bearWeight {
		tc.ConsensusDirection = "BULL"
	} else if bearWeight > bullWeight {
		tc.ConsensusDirection = "BEAR"
	} else {
		tc.ConsensusDirection = "NEUTRAL"
	}

	return tc
}

// barDirection returns the direction ("BULL"/"BEAR"/"NEUTRAL") and ADX from the last bar.
func barDirection(bars []domain.Bar) (string, float64) {
	if len(bars) == 0 {
		return "NEUTRAL", 0
	}
	last := bars[len(bars)-1]
	adx := last.ADX
	if last.EMA20 > last.EMA50 && last.Close > last.EMA20 {
		return "BULL", adx
	}
	if last.EMA20 < last.EMA50 && last.Close < last.EMA20 {
		return "BEAR", adx
	}
	return "NEUTRAL", adx
}

// m15Direction uses RSI for short-term direction.
func m15Direction(bars []domain.Bar) string {
	if len(bars) == 0 {
		return "NEUTRAL"
	}
	rsi := bars[len(bars)-1].RSI
	if rsi > 55 {
		return "BULL"
	}
	if rsi < 45 {
		return "BEAR"
	}
	return "NEUTRAL"
}

// confidence returns a confidence score based on direction and ADX.
func confidence(dir string, adx float64, cfg TrendConfig) float64 {
	if dir == "NEUTRAL" {
		return 0
	}
	if adx < cfg.WeakADXThreshold {
		return 0.3
	}
	if adx <= cfg.StrongADXThreshold {
		return 0.6
	}
	return 0.9
}

// ApplyTrendRating adjusts signal score and lot multiplier based on trend context.
func ApplyTrendRating(signal *domain.Signal, tc TrendContext, cfg TrendConfig) TrendRating {
	if !cfg.Enabled {
		return TrendRating{Penalty: 0, LotMultiplier: 1.0}
	}

	// Map signal side to trend direction
	signalDir := "BULL"
	if signal.Side == "SELL" {
		signalDir = "BEAR"
	}

	// Soft threshold: weak consensus → penalty 1
	if tc.ConsensusStrength < cfg.SoftThreshold {
		// Medium: weak consensus + H4 inverse → penalty 2, reduced lots
		if isInverse(tc.H4Direction, signalDir) {
			return TrendRating{
				Penalty:       2,
				LotMultiplier: 0.7,
				Reason:        "趋势弱+逆H4方向",
			}
		}
		return TrendRating{
			Penalty:       1,
			LotMultiplier: 1.0,
			Reason:        "趋势弱",
		}
	}

	return TrendRating{Penalty: 0, LotMultiplier: 1.0}
}

func isInverse(h4Dir, signalDir string) bool {
	return h4Dir != "NEUTRAL" && h4Dir != signalDir
}

// LogTrendContext writes the trend context to the logger.
func LogTrendContext(tc TrendContext) {
	log.Printf("[STRATEGY] 📊 趋势聚合 | D1=%s H4=%s(ADX=%.1f) H1=%s(ADX=%.1f) M30=%s(ADX=%.1f) 共识=%s(强度=%.2f)",
		tc.D1Direction, tc.H4Direction, tc.H4ADX, tc.H1Direction, tc.H1ADX, tc.M30Direction, tc.M30ADX,
		tc.ConsensusDirection, tc.ConsensusStrength)
}

// signalSideToDir maps signal side to trend direction string.
func signalSideToDir(side string) string {
	if strings.ToUpper(side) == "SELL" {
		return "BEAR"
	}
	return "BULL"
}