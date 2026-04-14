package indicator

// PivotLevels holds classic pivot point levels
type PivotLevels struct {
	PP float64 `json:"pp,omitempty"`   // Pivot Point
	R1 float64 `json:"r1,omitempty"`   // Resistance 1
	R2 float64 `json:"r2,omitempty"`   // Resistance 2
	R3 float64 `json:"r3,omitempty"`   // Resistance 3
	S1 float64 `json:"s1,omitempty"`   // Support 1
	S2 float64 `json:"s2,omitempty"`   // Support 2
	S3 float64 `json:"s3,omitempty"`   // Support 3
}

// PivotPoints calculates classic pivot points from the previous period's HLC
func PivotPoints(prevHigh, prevLow, prevClose float64) PivotLevels {
	pp := (prevHigh + prevLow + prevClose) / 3.0
	return PivotLevels{
		PP: pp,
		R1: 2*pp - prevLow,
		R2: pp + (prevHigh - prevLow),
		R3: prevHigh + 2*(pp - prevLow),
		S1: 2*pp - prevHigh,
		S2: pp - (prevHigh - prevLow),
		S3: prevLow - 2*(prevHigh - pp),
	}
}