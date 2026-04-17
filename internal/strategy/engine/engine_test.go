package engine

import (
	"testing"

	"gold-bot/internal/domain"
)

func TestDefaultStrategyConfigIncludesMomentumScalpDefaults(t *testing.T) {
	cfg := DefaultStrategyConfig()

	if cfg.MomentumScalpMinADX != 25 {
		t.Fatalf("MomentumScalpMinADX = %v, want 25", cfg.MomentumScalpMinADX)
	}
	if cfg.MomentumScalpEMAPeriod1 != 5 {
		t.Fatalf("MomentumScalpEMAPeriod1 = %d, want 5", cfg.MomentumScalpEMAPeriod1)
	}
	if cfg.MomentumScalpEMAPeriod2 != 8 {
		t.Fatalf("MomentumScalpEMAPeriod2 = %d, want 8", cfg.MomentumScalpEMAPeriod2)
	}
	if cfg.MomentumScalpEMAPeriod3 != 12 {
		t.Fatalf("MomentumScalpEMAPeriod3 = %d, want 12", cfg.MomentumScalpEMAPeriod3)
	}
	if cfg.MomentumScalpRSIBullThresh != 40 {
		t.Fatalf("MomentumScalpRSIBullThresh = %v, want 40", cfg.MomentumScalpRSIBullThresh)
	}
	if cfg.MomentumScalpRSIBearThresh != 60 {
		t.Fatalf("MomentumScalpRSIBearThresh = %v, want 60", cfg.MomentumScalpRSIBearThresh)
	}
	if cfg.MomentumScalpRSICrossoverBull != 45 {
		t.Fatalf("MomentumScalpRSICrossoverBull = %v, want 45", cfg.MomentumScalpRSICrossoverBull)
	}
	if cfg.MomentumScalpRSICrossoverBear != 55 {
		t.Fatalf("MomentumScalpRSICrossoverBear = %v, want 55", cfg.MomentumScalpRSICrossoverBear)
	}
	if cfg.MomentumScalpSLATR != 0.4 {
		t.Fatalf("MomentumScalpSLATR = %v, want 0.4", cfg.MomentumScalpSLATR)
	}
	if cfg.MomentumScalpTP1ATR != 0.5 {
		t.Fatalf("MomentumScalpTP1ATR = %v, want 0.5", cfg.MomentumScalpTP1ATR)
	}
	if cfg.MomentumScalpTP2ATR != 0.8 {
		t.Fatalf("MomentumScalpTP2ATR = %v, want 0.8", cfg.MomentumScalpTP2ATR)
	}
	if cfg.MomentumScalpVolConfirm != 1.3 {
		t.Fatalf("MomentumScalpVolConfirm = %v, want 1.3", cfg.MomentumScalpVolConfirm)
	}
	if cfg.MomentumScalpMinScore != 7 {
		t.Fatalf("MomentumScalpMinScore = %d, want 7", cfg.MomentumScalpMinScore)
	}
	if cfg.MomentumScalpMaxHoldingMin != 20 {
		t.Fatalf("MomentumScalpMaxHoldingMin = %d, want 20", cfg.MomentumScalpMaxHoldingMin)
	}
}

func TestCheckMomentumScalpBuildsBuySignal(t *testing.T) {
	e := New()
	price := 100.0

	signal, detail := e.checkMomentumScalp(
		[]domain.Bar{
			{EMA20: 96, EMA50: 94, ADX: 28},
			{EMA20: 97, EMA50: 95, ADX: 33},
		},
		momentumM5BarsForTests(),
		momentumM1BarsForTests(),
		price,
	)

	if signal == nil {
		t.Fatalf("signal = nil, detail=%+v", detail)
	}
	if signal.Side != "BUY" {
		t.Fatalf("side = %q, want BUY", signal.Side)
	}
	if signal.Strategy != "momentum_scalp" {
		t.Fatalf("strategy = %q, want momentum_scalp", signal.Strategy)
	}
	if signal.Entry != 100 {
		t.Fatalf("entry = %v, want 100", signal.Entry)
	}
	if signal.StopLoss != 99.4 {
		t.Fatalf("stop_loss = %v, want 99.4", signal.StopLoss)
	}
	if signal.TP1 != 100.75 {
		t.Fatalf("tp1 = %v, want 100.75", signal.TP1)
	}
	if signal.TP2 != 101.2 {
		t.Fatalf("tp2 = %v, want 101.2", signal.TP2)
	}
	if signal.Score != 10 {
		t.Fatalf("score = %d, want 10", signal.Score)
	}
	if signal.ATR != 1.5 {
		t.Fatalf("atr = %v, want 1.5", signal.ATR)
	}
}

func TestCheckMomentumScalpBlocksWhenM15ADXBelowThreshold(t *testing.T) {
	e := New()

	signal, detail := e.checkMomentumScalp(
		[]domain.Bar{
			{EMA20: 96, EMA50: 94, ADX: 24.9},
		},
		momentumM5BarsForTests(),
		momentumM1BarsForTests(),
		100,
	)

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if detail.Strategy != "动量剥头皮" {
		t.Fatalf("detail.strategy = %q, want %q", detail.Strategy, "动量剥头皮")
	}
}

func TestAnalyzeSkipsMomentumScalpWhenM1BarsInsufficient(t *testing.T) {
	e := New(WithMinScore(1))

	signal, logs := e.Analyze(domain.AnalysisSnapshot{
		AccountID:    "acct-1",
		CurrentPrice: 100,
		Bars: map[string][]domain.Bar{
			"H1":  flatH1BarsForMomentumTests(),
			"M30": nil,
			"M15": []domain.Bar{
				{EMA20: 96, EMA50: 94, ADX: 31},
			},
			"M5": momentumM5BarsForTests(),
			"M1": []domain.Bar{
				{Close: 99.2, ATR: 1.5, RSI: 44, Volume: 90, VolSMA: 80},
				{Close: 99.1, ATR: 1.5, RSI: 38, Volume: 95, VolSMA: 80},
				{Close: 99.4, ATR: 1.5, RSI: 46, Volume: 130, VolSMA: 80},
			},
		},
	})

	if signal != nil {
		t.Fatalf("signal = %+v, want nil when M1 bars are insufficient", signal)
	}

	found := false
	for _, entry := range logs {
		if entry.Strategy == "动量剥头皮" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected momentum scalp skip log when M1 bars are insufficient")
	}
}

func flatH1BarsForMomentumTests() []domain.Bar {
	bars := make([]domain.Bar, 50)
	for i := range bars {
		bars[i] = domain.Bar{
			Close:    100,
			EMA20:    100,
			EMA50:    100,
			ATR:      2,
			RSI:      50,
			ADX:      10,
			MACDHist: 0,
		}
	}
	return bars
}

func momentumM5BarsForTests() []domain.Bar {
	return []domain.Bar{
		{Close: 98.0, MACDHist: 0.10},
		{Close: 98.4, MACDHist: 0.15},
		{Close: 98.8, MACDHist: 0.21},
		{Close: 99.0, MACDHist: 0.27},
		{Close: 99.2, MACDHist: 0.34},
		{Close: 99.4, MACDHist: 0.40},
		{Close: 99.5, MACDHist: 0.47},
		{Close: 99.6, MACDHist: 0.54},
		{Close: 99.7, MACDHist: 0.60},
		{Close: 99.8, MACDHist: 0.66},
		{Close: 99.9, MACDHist: 0.73},
		{Close: 100.0, MACDHist: 0.81},
	}
}

func momentumM1BarsForTests() []domain.Bar {
	bars := make([]domain.Bar, 14)
	for i := range bars {
		bars[i] = domain.Bar{
			Close:  99.00 + float64(i)*0.02,
			ATR:    1.5,
			RSI:    44,
			Volume: 90,
			VolSMA: 80,
		}
	}
	bars[12].RSI = 38
	bars[13].RSI = 46
	bars[13].Volume = 130
	return bars
}
