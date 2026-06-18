package api

import "testing"

func TestCalcAILotsCapsAtOneCentLot(t *testing.T) {
	tests := []struct {
		name    string
		maxLots float64
		want    float64
	}{
		{name: "zero input", maxLots: 0, want: 0},
		{name: "rounds up small values", maxLots: 0.01, want: 0.01},
		{name: "caps large values", maxLots: 3.77, want: 0.01},
		{name: "caps exact threshold overflow", maxLots: 0.03, want: 0.01},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := calcAILots(tt.maxLots); got != tt.want {
				t.Fatalf("calcAILots(%v) = %v, want %v", tt.maxLots, got, tt.want)
			}
		})
	}
}
