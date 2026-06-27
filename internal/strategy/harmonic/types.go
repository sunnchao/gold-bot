package harmonic

type HarmonicPattern struct {
	Type      string `json:"type"`
	Direction string `json:"direction"`
	Timeframe string `json:"timeframe"`
	Status    string `json:"status"`

	XIndex int `json:"x_index"`
	AIndex int `json:"a_index"`
	BIndex int `json:"b_index"`
	CIndex int `json:"c_index"`
	DIndex int `json:"d_index"`

	XPrice float64 `json:"x_price"`
	APrice float64 `json:"a_price"`
	BPrice float64 `json:"b_price"`
	CPrice float64 `json:"c_price"`
	DPrice float64 `json:"d_price"`

	ABRatio float64 `json:"ab_ratio"`
	BCRatio float64 `json:"bc_ratio"`
	CDRatio float64 `json:"cd_ratio"`
	XDRatio float64 `json:"xd_ratio"`

	PRZLow      float64 `json:"prz_low"`
	PRZHigh     float64 `json:"prz_high"`
	StopLoss    float64 `json:"stop_loss"`
	Target1     float64 `json:"target_1"`
	Target2     float64 `json:"target_2"`
	Invalidated bool    `json:"invalidated"`

	Score      int     `json:"score"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

type HarmonicContext struct {
	H4Patterns  []HarmonicPattern `json:"h4_patterns"`
	H1Patterns  []HarmonicPattern `json:"h1_patterns"`
	M30Patterns []HarmonicPattern `json:"m30_patterns"`

	ActivePattern *HarmonicPattern `json:"active_pattern,omitempty"`
	DirectionBias string           `json:"direction_bias"`
	Score         int              `json:"score"`
	Summary       string           `json:"summary"`
}
