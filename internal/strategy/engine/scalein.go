package engine

import (
	"math"
	"strings"

	"gold-bot/internal/domain"
)

func CalculateUnifiedSL(positions []domain.Position, newEntry, newLots, atr, slATR float64, side string) (weightedAvg, unifiedSL float64) {
	totalLots := newLots
	totalWeighted := newEntry * newLots
	normalizedSide := strings.ToUpper(strings.TrimSpace(side))
	for _, pos := range positions {
		if strings.ToUpper(strings.TrimSpace(pos.Type)) != normalizedSide {
			continue
		}
		totalLots += pos.Lots
		totalWeighted += pos.OpenPrice * pos.Lots
	}
	if totalLots <= 0 {
		return 0, 0
	}
	weightedAvg = round2(totalWeighted / totalLots)
	if normalizedSide == "BUY" {
		unifiedSL = round2(weightedAvg - atr*slATR)
	} else {
		unifiedSL = round2(weightedAvg + atr*slATR)
	}
	return weightedAvg, unifiedSL
}

func roundDownScaleInLot(value float64) float64 {
	if value <= 0 {
		return 0
	}
	return math.Floor((value/0.01)+1e-9) * 0.01
}
