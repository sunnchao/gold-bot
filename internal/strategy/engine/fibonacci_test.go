package engine

import (
	"testing"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/indicator"
)

func TestCalculateFibExtension_UPTrend(t *testing.T) {
	ext := indicator.CalculateFibExtension(100, 80, "UP")

	if ext.Level1272 != 125.44 {
		t.Fatalf("Level1272 = %v, want 125.44", ext.Level1272)
	}
	if ext.Level1618 != 132.36 {
		t.Fatalf("Level1618 = %v, want 132.36", ext.Level1618)
	}
	if ext.Level2618 != 152.36 {
		t.Fatalf("Level2618 = %v, want 152.36", ext.Level2618)
	}
}

func TestCalculateFibExtension_DOWNtrend(t *testing.T) {
	ext := indicator.CalculateFibExtension(80, 100, "DOWN")

	if ext.Level1272 != 74.56 {
		t.Fatalf("Level1272 = %v, want 74.56", ext.Level1272)
	}
	if ext.Level1618 != 67.64 {
		t.Fatalf("Level1618 = %v, want 67.64", ext.Level1618)
	}
	if ext.Level2618 != 47.64 {
		t.Fatalf("Level2618 = %v, want 47.64", ext.Level2618)
	}
}

func TestIsPriceInFibZone_UP_InZone(t *testing.T) {
	inZone := indicator.IsPriceInFibZone(92, 92.36, 87.64, 2, 0.1, "UP")
	if !inZone {
		t.Fatal("expected price to be inside fib zone")
	}
}

func TestIsPriceInFibZone_UP_OutOfZone(t *testing.T) {
	inZone := indicator.IsPriceInFibZone(96, 92.36, 87.64, 2, 0.1, "UP")
	if inZone {
		t.Fatal("expected price to be outside fib zone")
	}
}

func TestDetectLastSwing_UPTrend(t *testing.T) {
	bars := []domain.Bar{
		{High: 100, Low: 90, Close: 95},
		{High: 102, Low: 91, Close: 97},
		{High: 105, Low: 92, Close: 103},
		{High: 108, Low: 94, Close: 107},
	}

	high, low, trend := detectLastSwing(bars, 4)

	if high != 108 {
		t.Fatalf("high = %v, want 108", high)
	}
	if low != 90 {
		t.Fatalf("low = %v, want 90", low)
	}
	if trend != "UP" {
		t.Fatalf("trend = %q, want UP", trend)
	}
}

func TestApplyFibExtensionTP_Disabled(t *testing.T) {
	e := New(WithConfig(DefaultStrategyConfig()))
	signal := &domain.Signal{Side: "BUY", TP1: 101, TP2: 102}
	h4 := fibBarsForTests(100, 150, 30)
	h1 := fibBarsForTests(90, 140, 30)

	got := e.applyFibExtensionTP(signal, h4, h1, 140, 10)

	if got.TP1 != 101 || got.TP2 != 102 {
		t.Fatalf("signal changed when disabled: %+v", got)
	}
}

func TestApplyFibExtensionTP_BUY_UPTrend(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.FibExtension.Enabled = true
	cfg.FibExtension.MinADX = 25
	cfg.FibExtension.SwingWindow = 5
	e := New(WithConfig(cfg))

	signal := &domain.Signal{Side: "BUY", TP1: 101, TP2: 102}
	h4 := []domain.Bar{
		{High: 100, Low: 98, Close: 99, ADX: 30},
		{High: 103, Low: 99, Close: 100, ADX: 30},
		{High: 106, Low: 100, Close: 103, ADX: 30},
		{High: 109, Low: 101, Close: 106, ADX: 30},
		{High: 112, Low: 102, Close: 110, ADX: 30},
	}

	got := e.applyFibExtensionTP(signal, h4, nil, 115, 5)

	if got.TP1 != 129.81 {
		t.Fatalf("TP1 = %v, want 129.81", got.TP1)
	}
	if got.TP2 != 134.65 {
		t.Fatalf("TP2 = %v, want 134.65", got.TP2)
	}
}

func TestApplyFibExtensionTP_LowADX(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.FibExtension.Enabled = true
	cfg.FibExtension.MinADX = 25
	cfg.FibExtension.SwingWindow = 5
	e := New(WithConfig(cfg))

	signal := &domain.Signal{Side: "BUY", TP1: 101, TP2: 102}
	h4 := []domain.Bar{
		{High: 100, Low: 90, Close: 95, ADX: 20},
		{High: 103, Low: 92, Close: 97, ADX: 20},
		{High: 106, Low: 94, Close: 101, ADX: 20},
		{High: 109, Low: 96, Close: 105, ADX: 20},
		{High: 112, Low: 98, Close: 110, ADX: 20},
	}

	got := e.applyFibExtensionTP(signal, h4, nil, 115, 5)

	if got.TP1 != 101 || got.TP2 != 102 {
		t.Fatalf("signal changed with low ADX: %+v", got)
	}
}

func TestPullbackFibFilter_PriceInZone(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.PullbackFib.RetracementEnabled = true
	cfg.FibExtension.Enabled = true
	cfg.FibExtension.MinADX = 25
	cfg.FibExtension.SwingWindow = 5
	e := New(WithConfig(cfg))

	h1 := pullbackFibH1Bars()
	h4 := pullbackFibH4BarsUp()
	m15 := []domain.Bar{{RSI: 45, ATR: 2}}

	signal, _ := e.checkPullback(h1, 95, 2, h4, m15)

	if signal == nil {
		t.Fatal("expected signal")
	}
	if signal.Strategy != "pullback_fib" {
		t.Fatalf("strategy = %q, want pullback_fib", signal.Strategy)
	}
}

func TestPullbackFibFilter_PriceOutOfZone(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.PullbackFib.RetracementEnabled = true
	e := New(WithConfig(cfg))

	h1 := pullbackFibH1Bars()
	h4 := pullbackFibH4BarsUp()

	signal, _ := e.checkPullback(h1, 100, 2, h4, nil)

	if signal != nil {
		t.Fatalf("expected nil signal, got %+v", signal)
	}
}

func TestPullbackFibFilter_Disabled(t *testing.T) {
	cfg := DefaultStrategyConfig()
	e := New(WithConfig(cfg))

	h1 := pullbackFibH1Bars()
	h4 := pullbackFibH4BarsUp()

	signal, _ := e.checkPullback(h1, 95, 2, h4, nil)

	if signal == nil {
		t.Fatal("expected signal")
	}
	if signal.Strategy != "pullback" {
		t.Fatalf("strategy = %q, want pullback", signal.Strategy)
	}
	if signal.StopLoss != 91 {
		t.Fatalf("stop loss = %v, want 91", signal.StopLoss)
	}
}

func TestPullbackFibFilter_BadH4Trend(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.PullbackFib.RetracementEnabled = true
	e := New(WithConfig(cfg))

	h1 := pullbackFibH1Bars()
	h4 := pullbackFibH4BarsDown()

	signal, _ := e.checkPullback(h1, 95, 2, h4, nil)

	if signal != nil {
		t.Fatalf("expected nil signal, got %+v", signal)
	}
}

func TestPullbackFibFilter_StopLossAt786(t *testing.T) {
	cfg := DefaultStrategyConfig()
	cfg.PullbackFib.RetracementEnabled = true
	cfg.PullbackFib.StopLossOuterATR = 0.5
	e := New(WithConfig(cfg))

	h1 := pullbackFibH1Bars()
	h4 := pullbackFibH4BarsUp()

	signal, _ := e.checkPullback(h1, 95, 2, h4, nil)

	if signal == nil {
		t.Fatal("expected signal")
	}
	if signal.StopLoss != 88 {
		t.Fatalf("stop loss = %v, want 88", signal.StopLoss)
	}
}

func fibBarsForTests(lowStart, highStart float64, adx float64) []domain.Bar {
	return []domain.Bar{
		{High: highStart - 4, Low: lowStart, Close: lowStart + 1, ADX: adx},
		{High: highStart - 3, Low: lowStart + 1, Close: lowStart + 2, ADX: adx},
		{High: highStart - 2, Low: lowStart + 2, Close: lowStart + 3, ADX: adx},
		{High: highStart - 1, Low: lowStart + 3, Close: lowStart + 4, ADX: adx},
		{High: highStart, Low: lowStart + 4, Close: lowStart + 5, ADX: adx},
	}
}

func pullbackFibH1Bars() []domain.Bar {
	return []domain.Bar{
		{
			Close:    95.2,
			EMA20:    95.8,
			EMA50:    90,
			ATR:      2,
			RSI:      45,
			MACDHist: 1,
			ADX:      35,
		},
		{
			Close:    95,
			EMA20:    95.8,
			EMA50:    90,
			ATR:      2,
			RSI:      45,
			MACDHist: 1,
			ADX:      35,
			Fib382:   96,
			Fib618:   92,
			Fib786:   89,
		},
	}
}

func pullbackFibH4BarsUp() []domain.Bar {
	return []domain.Bar{
		{EMA20: 110, EMA50: 100},
	}
}

func pullbackFibH4BarsDown() []domain.Bar {
	return []domain.Bar{
		{EMA20: 100, EMA50: 110},
	}
}
