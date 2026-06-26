package engine

import (
	"math"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/domain"
)

func TestDefaultStrategyConfigIncludesMomentumScalpDefaults(t *testing.T) {
	cfg := DefaultStrategyConfig()

	if cfg.MomentumScalpMinADX != 20 {
		t.Fatalf("MomentumScalpMinADX = %v, want 20", cfg.MomentumScalpMinADX)
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
	if cfg.MomentumScalpRSIBullThresh != 45 {
		t.Fatalf("MomentumScalpRSIBullThresh = %v, want 45", cfg.MomentumScalpRSIBullThresh)
	}
	if cfg.MomentumScalpRSIBearThresh != 55 {
		t.Fatalf("MomentumScalpRSIBearThresh = %v, want 55", cfg.MomentumScalpRSIBearThresh)
	}
	if cfg.MomentumScalpRSICrossoverBull != 48 {
		t.Fatalf("MomentumScalpRSICrossoverBull = %v, want 48", cfg.MomentumScalpRSICrossoverBull)
	}
	if cfg.MomentumScalpRSICrossoverBear != 52 {
		t.Fatalf("MomentumScalpRSICrossoverBear = %v, want 52", cfg.MomentumScalpRSICrossoverBear)
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
	if cfg.MomentumScalpVolConfirm != 1.05 {
		t.Fatalf("MomentumScalpVolConfirm = %v, want 1.05", cfg.MomentumScalpVolConfirm)
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
			{EMA20: 96, EMA50: 94, ADX: 17.9}, // 阈值是18，17.9应被阻止
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

func TestCheckMomentumScalpReportsSpecificM5FailureReason(t *testing.T) {
	e := New()

	tests := []struct {
		name    string
		m15     []domain.Bar
		m5      []domain.Bar
		wantAll []string
	}{
		{
			name: "buy ema alignment failure",
			m15: []domain.Bar{
				{EMA20: 97, EMA50: 95, ADX: 30},
			},
			m5: []domain.Bar{
				{Close: 100.0, MACDHist: 0.10},
				{Close: 99.8, MACDHist: 0.15},
				{Close: 99.6, MACDHist: 0.20},
				{Close: 99.4, MACDHist: 0.25},
				{Close: 99.2, MACDHist: 0.30},
				{Close: 99.0, MACDHist: 0.35},
				{Close: 98.8, MACDHist: 0.40},
				{Close: 98.6, MACDHist: 0.45},
				{Close: 98.4, MACDHist: 0.50},
				{Close: 98.2, MACDHist: 0.55},
				{Close: 98.0, MACDHist: 0.60},
				{Close: 97.8, MACDHist: 0.65},
			},
			wantAll: []string{"BUY", "EMA部分排列未满足", "EMA5=", "EMA8="},
		},
		{
			name: "buy macd momentum failure",
			m15: []domain.Bar{
				{EMA20: 97, EMA50: 95, ADX: 30},
			},
			m5: []domain.Bar{
				{Close: 98.0, MACDHist: 0.80},
				{Close: 98.4, MACDHist: 0.78},
				{Close: 98.8, MACDHist: 0.76},
				{Close: 99.0, MACDHist: 0.74},
				{Close: 99.2, MACDHist: 0.72},
				{Close: 99.4, MACDHist: 0.70},
				{Close: 99.5, MACDHist: 0.68},
				{Close: 99.6, MACDHist: 0.66},
				{Close: 99.7, MACDHist: 0.64},
				{Close: 99.8, MACDHist: 0.62},
				{Close: 99.9, MACDHist: 0.60},
				{Close: 100.0, MACDHist: 0.58},
			},
			wantAll: []string{"BUY", "MACD动能未满足", "prev=", "curr="},
		},
		{
			name: "sell ema alignment failure",
			m15: []domain.Bar{
				{EMA20: 95, EMA50: 97, ADX: 30},
			},
			m5: []domain.Bar{
				{Close: 98.0, MACDHist: -0.10},
				{Close: 98.2, MACDHist: -0.15},
				{Close: 98.4, MACDHist: -0.20},
				{Close: 98.6, MACDHist: -0.25},
				{Close: 98.8, MACDHist: -0.30},
				{Close: 99.0, MACDHist: -0.35},
				{Close: 99.2, MACDHist: -0.40},
				{Close: 99.4, MACDHist: -0.45},
				{Close: 99.6, MACDHist: -0.50},
				{Close: 99.8, MACDHist: -0.55},
				{Close: 100.0, MACDHist: -0.60},
				{Close: 100.2, MACDHist: -0.65},
			},
			wantAll: []string{"SELL", "EMA部分排列未满足", "EMA5=", "EMA8="},
		},
		{
			name: "sell macd momentum failure",
			m15: []domain.Bar{
				{EMA20: 95, EMA50: 97, ADX: 30},
			},
			m5: []domain.Bar{
				{Close: 100.0, MACDHist: -0.80},
				{Close: 99.8, MACDHist: -0.78},
				{Close: 99.6, MACDHist: -0.76},
				{Close: 99.4, MACDHist: -0.74},
				{Close: 99.2, MACDHist: -0.72},
				{Close: 99.0, MACDHist: -0.70},
				{Close: 98.8, MACDHist: -0.68},
				{Close: 98.6, MACDHist: -0.66},
				{Close: 98.4, MACDHist: -0.64},
				{Close: 98.2, MACDHist: -0.62},
				{Close: 98.0, MACDHist: -0.60},
				{Close: 97.8, MACDHist: -0.58},
			},
			wantAll: []string{"SELL", "MACD动能未满足", "prev=", "curr="},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			signal, detail := e.checkMomentumScalp(tt.m15, tt.m5, momentumM1BarsForTests(), 100)

			if signal != nil {
				t.Fatalf("signal = %+v, want nil", signal)
			}
			for _, want := range tt.wantAll {
				if !strings.Contains(detail.Message, want) {
					t.Fatalf("detail.Message = %q, want substring %q", detail.Message, want)
				}
			}
		})
	}
}

func TestCheckBreakoutPyramidBlocksBuyAheadOfBearishOrderBlock(t *testing.T) {
	e := New()
	h1 := breakoutPyramidBuyOrderBlockBarsForTests()
	price := h1[len(h1)-1].Close

	signal, detail := e.checkBreakoutPyramid(h1, nil, price, 2.0)

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if detail.Level != "info" {
		t.Fatalf("detail.Level = %q, want info", detail.Level)
	}
	if !strings.Contains(detail.Message, "前方有空头OB") {
		t.Fatalf("detail.Message = %q, want bearish OB block reason", detail.Message)
	}
}

func TestCheckBreakoutPyramidBlocksSellAheadOfBullishOrderBlock(t *testing.T) {
	e := New()
	h1 := breakoutPyramidSellOrderBlockBarsForTests()
	price := h1[len(h1)-1].Close

	signal, detail := e.checkBreakoutPyramid(h1, nil, price, 2.0)

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if detail.Level != "info" {
		t.Fatalf("detail.Level = %q, want info", detail.Level)
	}
	if !strings.Contains(detail.Message, "前方有多头OB") {
		t.Fatalf("detail.Message = %q, want bullish OB block reason", detail.Message)
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

func breakoutPyramidBaseBarsForTests() []domain.Bar {
	bars := make([]domain.Bar, 30)
	for i := range bars {
		bars[i] = domain.Bar{
			Time:     time.Unix(int64(i+1), 0).UTC().Format(time.RFC3339),
			Open:     100.0,
			High:     100.5,
			Low:      99.5,
			Close:    100.0,
			ATR:      2.0,
			ADX:      35.0,
			RSI:      60.0,
			EMA20:    101.0,
			EMA50:    99.0,
			BBUpper:  101.0,
			BBLower:  99.0,
			MACDHist: 0.2,
		}
	}
	return bars
}

func breakoutPyramidBuyOrderBlockBarsForTests() []domain.Bar {
	bars := breakoutPyramidBaseBarsForTests()
	bars[13].High = 101.25
	bars[13].Close = 100.8
	bars[18] = domain.Bar{
		Time:     bars[18].Time,
		Open:     99.5,
		High:     101.4,
		Low:      99.4,
		Close:    101.2,
		ATR:      2.0,
		ADX:      35.0,
		RSI:      60.0,
		EMA20:    101.0,
		EMA50:    99.0,
		BBUpper:  101.0,
		BBLower:  99.0,
		MACDHist: 0.2,
	}
	bars[19].High = 101.45
	bars[19].Close = 101.3
	bars[29].Close = 101.2
	bars[29].EMA20 = 101.0
	bars[29].EMA50 = 99.0
	bars[29].BBUpper = 101.0
	return bars
}

func breakoutPyramidSellOrderBlockBarsForTests() []domain.Bar {
	bars := breakoutPyramidBaseBarsForTests()
	bars[13].Low = 98.75
	bars[13].Close = 99.2
	bars[18] = domain.Bar{
		Time:     bars[18].Time,
		Open:     100.5,
		High:     100.6,
		Low:      98.6,
		Close:    98.8,
		ATR:      2.0,
		ADX:      35.0,
		RSI:      40.0,
		EMA20:    99.0,
		EMA50:    101.0,
		BBUpper:  101.0,
		BBLower:  99.0,
		MACDHist: -0.2,
	}
	bars[19].Low = 98.55
	bars[19].Close = 98.7
	bars[29].Close = 98.8
	bars[29].RSI = 40.0
	bars[29].EMA20 = 99.0
	bars[29].EMA50 = 101.0
	bars[29].BBLower = 99.0
	bars[29].MACDHist = -0.2
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
	// 新阈值: prev < 45 && curr >= 48
	bars[12].RSI = 38     // < 45 ✓
	bars[13].RSI = 49     // >= 48 ✓
	bars[13].Volume = 130 // > 80*1.05 ✓
	return bars
}

func TestCheckScaleInBuildsBuySignal(t *testing.T) {
	cfg := DefaultStrategyConfig()
	e := New(WithConfig(cfg))

	price := 98.0
	atr := 2.0
	now := time.Now().UTC()
	positions := []domain.Position{
		{
			Ticket:    1001,
			Type:      "BUY",
			Lots:      0.10,
			OpenPrice: 101.1,
			OpenTime:  now.Add(-2 * time.Hour).Unix(),
			Comment:   "pullback",
		},
	}
	h1 := scaleInH1BarsForTests(domain.Bar{
		Close:    price,
		ATR:      atr,
		ADX:      32,
		RSI:      28,
		MACDHist: 0.4,
		EMA20:    100.5,
		EMA50:    98.35,
		EMA200:   110.0,
		Fib382:   98.1,
		Fib500:   99.0,
		Fib618:   99.8,
		PP:       101.8,
		S1:       97.8,
		R1:       103.2,
	})

	signal, detail := e.checkScaleIn(h1, price, atr, positions)
	if signal == nil {
		t.Fatalf("signal = nil, detail=%+v", detail)
	}
	if signal.Strategy != "scale_in" {
		t.Fatalf("strategy = %q, want scale_in", signal.Strategy)
	}
	if signal.Side != "BUY" {
		t.Fatalf("side = %q, want BUY", signal.Side)
	}
	if signal.ScaleInParentTicket != 1001 {
		t.Fatalf("parent ticket = %d, want 1001", signal.ScaleInParentTicket)
	}
	if signal.ScaleInCount != 0 {
		t.Fatalf("scale in count = %d, want 0", signal.ScaleInCount)
	}
	if signal.Entry != price {
		t.Fatalf("entry = %v, want %v", signal.Entry, price)
	}
	if signal.WeightedAvgEntry != 99.94 {
		t.Fatalf("weighted avg = %v, want 99.94", signal.WeightedAvgEntry)
	}
	if signal.UnifiedSL != 97.54 {
		t.Fatalf("unified sl = %v, want 97.54", signal.UnifiedSL)
	}
	if signal.StopLoss != signal.UnifiedSL {
		t.Fatalf("stop loss = %v, want unified sl %v", signal.StopLoss, signal.UnifiedSL)
	}
	if signal.TP1 != 102.94 {
		t.Fatalf("tp1 = %v, want 102.94", signal.TP1)
	}
	if signal.TP2 != 105.94 {
		t.Fatalf("tp2 = %v, want 105.94", signal.TP2)
	}
	if signal.Score != 10 {
		t.Fatalf("score = %d, want 10", signal.Score)
	}
	if !strings.Contains(detail.Message, "浮亏加仓 BUY") {
		t.Fatalf("detail = %q, want scale in log", detail.Message)
	}
}

func TestCheckScaleInRejectsWhenADXTooLow(t *testing.T) {
	cfg := DefaultStrategyConfig()
	e := New(WithConfig(cfg))

	signal, detail := e.checkScaleIn(scaleInH1BarsForTests(domain.Bar{
		Close:  98.0,
		ATR:    2.0,
		ADX:    20.0,
		RSI:    28,
		EMA50:  98.3,
		Fib382: 98.1,
	}), 98.2, 2.0, []domain.Position{
		{Ticket: 1001, Type: "BUY", Lots: 0.10, OpenPrice: 101.1},
	})

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if !strings.Contains(detail.Message, "ADX") {
		t.Fatalf("detail = %q, want ADX reason", detail.Message)
	}
}

func TestCheckScaleInRejectsWhenMaxAddCountReached(t *testing.T) {
	cfg := DefaultStrategyConfig()
	e := New(WithConfig(cfg))

	positions := []domain.Position{
		{Ticket: 1001, Type: "BUY", Lots: 0.10, OpenPrice: 101.0, Comment: "pullback"},
		{Ticket: 1002, Type: "BUY", Lots: 0.06, OpenPrice: 99.2, Comment: "scale_in"},
		{Ticket: 1003, Type: "BUY", Lots: 0.03, OpenPrice: 98.7, Comment: "scale_in add"},
	}
	signal, detail := e.checkScaleIn(scaleInH1BarsForTests(domain.Bar{
		Close:    98.0,
		ATR:      2.0,
		ADX:      32,
		RSI:      28,
		EMA50:    98.3,
		Fib382:   98.1,
		MACDHist: 0.4,
	}), 98.0, 2.0, positions)

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if !strings.Contains(detail.Message, "加仓次数已达上限") {
		t.Fatalf("detail = %q, want max count reason", detail.Message)
	}
}

func TestCheckScaleInRejectsWhenDistanceTooShort(t *testing.T) {
	cfg := DefaultStrategyConfig()
	e := New(WithConfig(cfg))

	positions := []domain.Position{
		{Ticket: 1001, Type: "BUY", Lots: 0.10, OpenPrice: 101.1, OpenTime: time.Now().Add(-2 * time.Hour).Unix(), Comment: "pullback"},
		{Ticket: 1002, Type: "BUY", Lots: 0.06, OpenPrice: 98.9, OpenTime: time.Now().Add(-1 * time.Hour).Unix(), Comment: "scale_in"},
	}
	signal, detail := e.checkScaleIn(scaleInH1BarsForTests(domain.Bar{
		Close:    98.0,
		ATR:      2.0,
		ADX:      32,
		RSI:      28,
		EMA50:    98.3,
		Fib382:   98.1,
		MACDHist: 0.4,
	}), 98.0, 2.0, positions)

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}
	if !strings.Contains(detail.Message, "距离最近入场不足") {
		t.Fatalf("detail = %q, want distance reason", detail.Message)
	}
}

func TestAnalyzeAllowsScaleInPastSameDirectionDuplicateGate(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.PullbackMinADX = math.MaxFloat64
	cfg.BreakoutPyramidMinADX = math.MaxFloat64
	e := New(WithConfig(cfg), WithMinScore(1))

	signal, logs := e.Analyze(domain.AnalysisSnapshot{
		AccountID:    "acct-1",
		CurrentPrice: 98.0,
		Bars: map[string][]domain.Bar{
			"H1":  scaleInH1BarsForTests(domain.Bar{Close: 98.0, ATR: 2.0, ADX: 32, RSI: 28, MACDHist: 0.4, EMA20: 100.5, EMA50: 98.35, EMA200: 110, Fib382: 98.1}),
			"M30": scaleInH1BarsForTests(domain.Bar{Close: 98.0, ATR: 2.0}),
			"H4":  scaleInH4BarsForTests("BUY"),
			"M15": scaleInM15BarsForTests(),
		},
		Positions: []domain.Position{
			{Ticket: 1001, Type: "BUY", Lots: 0.10, OpenPrice: 98.6, OpenTime: time.Now().Add(-3 * time.Hour).Unix(), Comment: "pullback"},
			{Ticket: 1002, Type: "BUY", Lots: 0.10, OpenPrice: 101.1, OpenTime: time.Now().Add(-2 * time.Hour).Unix(), Comment: "pullback"},
		},
	})

	if signal == nil {
		t.Fatalf("signal = nil, logs=%+v", logs)
	}
	if signal.Strategy != "scale_in" {
		t.Fatalf("strategy = %q, want scale_in", signal.Strategy)
	}

	foundExemption := false
	for _, entry := range logs {
		if strings.Contains(entry.Message, "浮亏加仓豁免防重复") {
			foundExemption = true
			break
		}
	}
	if !foundExemption {
		t.Fatal("expected anti-duplicate exemption log for scale_in")
	}
}

func TestAnalyzeBlocksNonScaleInAtSameDirectionDuplicateGate(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.ScaleInEnabled = false
	e := New(WithConfig(cfg), WithMinScore(1))

	signal, logs := e.Analyze(domain.AnalysisSnapshot{
		AccountID:    "acct-1",
		CurrentPrice: 100.2,
		Bars: map[string][]domain.Bar{
			"H1":  pullbackH1BarsForTests(domain.Bar{Close: 100.2, ATR: 2.0, ADX: 35, RSI: 45, MACDHist: 0.3, EMA20: 100.0, EMA50: 98.0}),
			"M30": nil,
			"H4":  scaleInH4BarsForTests("BUY"),
			"M15": scaleInM15BarsForTests(),
		},
		Positions: []domain.Position{
			{Ticket: 1001, Type: "BUY", Lots: 0.10, OpenPrice: 100.0, Comment: "pullback"},
		},
	})

	if signal != nil {
		t.Fatalf("signal = %+v, want nil", signal)
	}

	foundBlocked := false
	for _, entry := range logs {
		if strings.Contains(entry.Message, "防重复: 已有同向持仓") {
			foundBlocked = true
			break
		}
	}
	if !foundBlocked {
		t.Fatal("expected duplicate-block log for non-scale_in strategy")
	}
}

func TestCalculateUnifiedSL(t *testing.T) {
	positions := []domain.Position{
		{Type: "BUY", Lots: 0.10, OpenPrice: 101.0},
		{Type: "BUY", Lots: 0.06, OpenPrice: 99.2},
		{Type: "SELL", Lots: 0.05, OpenPrice: 103.0},
	}

	weightedAvg, unifiedSL := CalculateUnifiedSL(positions, 98.2, 0.03, 2.0, 1.2, "BUY", 2)

	if weightedAvg != 99.99 {
		t.Fatalf("weighted avg = %v, want 99.99", weightedAvg)
	}
	if unifiedSL != 97.59 {
		t.Fatalf("unified sl = %v, want 97.59", unifiedSL)
	}
}

func TestRoundToPrecisionAndRoundingPrecision(t *testing.T) {
	tests := []struct {
		symbol    string
		value     float64
		wantPrec  int
		wantRound float64
	}{
		{symbol: "EURUSD", value: 1.234567, wantPrec: 5, wantRound: 1.23457},
		{symbol: "GBPUSD", value: 1.250004, wantPrec: 5, wantRound: 1.25},
		{symbol: "GBPJPY", value: 198.4567, wantPrec: 3, wantRound: 198.457},
		{symbol: "XAUUSD", value: 2345.678, wantPrec: 2, wantRound: 2345.68},
		{symbol: "USOilCash", value: 72.345, wantPrec: 2, wantRound: 72.35},
		{symbol: "UKOilCash", value: 75.123, wantPrec: 2, wantRound: 75.12},
		{symbol: "US100Cash", value: 19876.54, wantPrec: 2, wantRound: 19876.54},
	}

	for _, tt := range tests {
		t.Run(tt.symbol, func(t *testing.T) {
			if got := roundingPrecision(tt.symbol); got != tt.wantPrec {
				t.Fatalf("precision = %d, want %d", got, tt.wantPrec)
			}
			if got := roundToPrecision(tt.value, tt.wantPrec); got != tt.wantRound {
				t.Fatalf("rounded = %v, want %v", got, tt.wantRound)
			}
		})
	}
}

func TestPickSLTPBuyUsesNearestSRWithBuffer(t *testing.T) {
	cfg := DefaultStrategyConfig()
	price := 1.10000
	atr := 0.00100
	last := domain.Bar{
		EMA20:   1.09960,
		EMA50:   1.09890,
		BBLower: 1.09920,
		BBUpper: 1.10120,
		Fib382:  1.10080,
		Fib618:  1.09910,
		Fib786:  1.09860,
		R1:      1.10220,
		S1:      1.09880,
	}

	sl, tp1, tp2, usedSR := pickSLTP("BUY", price, last, atr, 5, cfg, nil)
	if !usedSR {
		t.Fatal("usedSR = false, want true")
	}
	if sl != 1.09910 {
		t.Fatalf("sl = %v, want 1.09910", sl)
	}
	if tp1 != 1.10080 {
		t.Fatalf("tp1 = %v, want 1.10080", tp1)
	}
	if tp2 != 1.10080 {
		t.Fatalf("tp2 = %v, want 1.10080", tp2)
	}
}

func TestPickSLTPSellFallsBackWhenNoReasonableSR(t *testing.T) {
	cfg := DefaultStrategyConfig()
	price := 1.25000
	atr := 0.00100
	last := domain.Bar{
		EMA20:   1.24995,
		EMA50:   1.24990,
		BBLower: 1.24980,
		BBUpper: 1.25005,
		Fib382:  1.25006,
		Fib618:  1.24992,
		Fib786:  1.24991,
		R1:      1.25010,
		S1:      1.24989,
	}

	sl, tp1, tp2, usedSR := pickSLTP("SELL", price, last, atr, 5, cfg, nil)
	if usedSR {
		t.Fatal("usedSR = true, want false")
	}
	if sl != 1.25150 {
		t.Fatalf("sl = %v, want 1.25150", sl)
	}
	if tp1 != 1.24850 {
		t.Fatalf("tp1 = %v, want 1.24850", tp1)
	}
	if tp2 != 1.24700 {
		t.Fatalf("tp2 = %v, want 1.24700", tp2)
	}
}

func TestCalculateUnifiedSLUsesProvidedPrecision(t *testing.T) {
	positions := []domain.Position{
		{Type: "BUY", Lots: 0.10, OpenPrice: 1.10123},
		{Type: "BUY", Lots: 0.06, OpenPrice: 1.09987},
	}

	weightedAvg, unifiedSL := CalculateUnifiedSL(positions, 1.09876, 0.03, 0.00080, 1.2, "BUY", 5)

	if weightedAvg != 1.10041 {
		t.Fatalf("weightedAvg = %v, want 1.10041", weightedAvg)
	}
	if unifiedSL != 1.09945 {
		t.Fatalf("unifiedSL = %v, want 1.09945", unifiedSL)
	}
}

func TestScaleInLotDecayRoundsDown(t *testing.T) {
	if got := roundDownScaleInLot(0.10 * 0.6); got != 0.06 {
		t.Fatalf("first decay = %v, want 0.06", got)
	}
	if got := roundDownScaleInLot(0.06 * 0.6); got != 0.03 {
		t.Fatalf("second decay = %v, want 0.03", got)
	}
}

func scaleInH1BarsForTests(last domain.Bar) []domain.Bar {
	bars := make([]domain.Bar, 50)
	for i := range bars {
		bars[i] = domain.Bar{
			Time:     time.Unix(int64(i+1), 0).UTC().Format(time.RFC3339),
			Close:    100.0,
			EMA20:    101.0,
			EMA50:    99.0,
			EMA200:   110.0,
			ATR:      2.0,
			RSI:      45.0,
			ADX:      28.0,
			MACDHist: 0.1,
		}
	}
	bars[len(bars)-1] = last
	if bars[len(bars)-2].Time == "" {
		bars[len(bars)-2].Time = time.Unix(49, 0).UTC().Format(time.RFC3339)
	}
	return bars
}

func scaleInH4BarsForTests(side string) []domain.Bar {
	bars := make([]domain.Bar, 50)
	for i := range bars {
		bar := domain.Bar{
			Time:  time.Unix(int64(i+1), 0).UTC().Format(time.RFC3339),
			Close: 100,
			ATR:   2,
			ADX:   35,
		}
		if side == "SELL" {
			bar.EMA20 = 98
			bar.EMA50 = 100
			bar.Close = 97.5
		} else {
			bar.EMA20 = 102
			bar.EMA50 = 100
			bar.Close = 102.5
		}
		bars[i] = bar
	}
	return bars
}

func scaleInM15BarsForTests() []domain.Bar {
	return []domain.Bar{
		{ATR: 2, RSI: 35, Fib382: 98.3},
		{ATR: 2, RSI: 29, Fib382: 98.3},
	}
}

func pullbackH1BarsForTests(last domain.Bar) []domain.Bar {
	bars := make([]domain.Bar, 50)
	for i := range bars {
		bars[i] = domain.Bar{
			Time:     time.Unix(int64(i+1), 0).UTC().Format(time.RFC3339),
			Close:    100.0,
			EMA20:    100.0,
			EMA50:    98.0,
			ATR:      2.0,
			RSI:      45.0,
			ADX:      35.0,
			MACDHist: 0.2,
		}
	}
	bars[len(bars)-2].Close = 100.1
	bars[len(bars)-2].EMA20 = 100.0
	bars[len(bars)-1] = last
	return bars
}
