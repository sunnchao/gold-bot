package positionmgr_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/strategy/positionmgr"
)

func TestAnalyzeTimeStopWinsBeforeOtherExitRules(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       101,
		OpenTime:     now.Add(-49 * time.Hour),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3340.8,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    101,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Action != domain.PositionActionClose {
		t.Fatalf("action = %q, want %q", got[0].Action, domain.PositionActionClose)
	}
	if got[0].Ticket != 101 {
		t.Fatalf("ticket = %d, want 101", got[0].Ticket)
	}
	if got[0].Lots != 0.5 {
		t.Fatalf("lots = %v, want 0.5", got[0].Lots)
	}
	if got[0].Reason != "time_48h_0.4ATR" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "time_48h_0.4ATR")
	}
}

func TestAnalyzeBreakevenAndTP1CanFireInSamePass(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       202,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    202,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) != 2 {
		t.Fatalf("len(commands) = %d, want 2", len(got))
	}

	if got[0].Action != domain.PositionActionModify {
		t.Fatalf("first action = %q, want %q", got[0].Action, domain.PositionActionModify)
	}
	if got[0].NewSL != 3340.0 {
		t.Fatalf("first new_sl = %v, want 3340.0", got[0].NewSL)
	}
	if got[0].Reason != "breakeven_1.6ATR" {
		t.Fatalf("first reason = %q, want %q", got[0].Reason, "breakeven_1.6ATR")
	}

	if got[1].Action != domain.PositionActionClose {
		t.Fatalf("second action = %q, want %q", got[1].Action, domain.PositionActionClose)
	}
	if got[1].Lots != 0.2 {
		t.Fatalf("second lots = %v, want 0.2", got[1].Lots)
	}
	if got[1].Reason != "TP1_1.6ATR" {
		t.Fatalf("second reason = %q, want %q", got[1].Reason, "TP1_1.6ATR")
	}
}

func TestManagerLoadAndPersistStatesIncludeSymbol(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	store := &recordingStateStore{
		loaded: map[int64]domain.PositionState{
			303: {
				Ticket:       303,
				OpenTime:     now.Add(-2 * time.Hour),
				BETriggerATR: 1.5,
			},
		},
	}
	manager := positionmgr.New(
		positionmgr.WithNow(func() time.Time { return now }),
		positionmgr.WithStore(store),
	)

	if err := manager.LoadStates("90011087", "GBPJPY"); err != nil {
		t.Fatalf("LoadStates returned error: %v", err)
	}

	got := manager.Analyze(domain.PositionSnapshot{
		AccountID:    "90011087",
		Symbol:       "GBPJPY",
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    303,
				Type:      "BUY",
				OpenPrice: 3340.0,
				Lots:      0.5,
			},
		},
	})

	if len(got) == 0 {
		t.Fatal("len(commands) = 0, want at least one command so state is persisted")
	}
	if store.loadSymbol != "GBPJPY" {
		t.Fatalf("load symbol = %q, want %q", store.loadSymbol, "GBPJPY")
	}
	if len(store.saved) == 0 {
		t.Fatal("len(saved) = 0, want at least one persisted state")
	}
	if store.saved[0].symbol != "GBPJPY" {
		t.Fatalf("saved symbol = %q, want %q", store.saved[0].symbol, "GBPJPY")
	}
}

func TestAnalyzeMomentumScalpTimeStopWinsBeforeOtherRules(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       404,
		OpenTime:     now.Add(-21 * time.Minute),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 100.15,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars: []domain.Bar{
			{Close: 99.6},
			{Close: 99.8},
			{Close: 100.0},
			{Close: 100.1},
			{Close: 100.2},
			{Close: 100.3},
			{Close: 100.35},
			{Close: 100.4},
		},
		M1Bars: []domain.Bar{
			{RSI: 82},
		},
		Positions: []domain.Position{
			{
				Ticket:    404,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "bot momentum_scalp entry",
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Reason != "momentum_scalp_time_stop_0.2ATR" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "momentum_scalp_time_stop_0.2ATR")
	}
	if got[0].Action != domain.PositionActionClose {
		t.Fatalf("action = %q, want %q", got[0].Action, domain.PositionActionClose)
	}
	if got[0].Lots != 0.5 {
		t.Fatalf("lots = %v, want 0.5", got[0].Lots)
	}
}

func TestAnalyzeMomentumScalpRSIPartialThenFullExit(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:           505,
		OpenTime:         now.Add(-5 * time.Minute),
		BETriggerATR:     1.5,
		RSITp75Triggered: false,
	})

	first := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 101.0,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars:       bullishMomentumM5Bars(),
		M1Bars: []domain.Bar{
			{RSI: 76},
		},
		Positions: []domain.Position{
			{
				Ticket:    505,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(first) != 1 {
		t.Fatalf("first len(commands) = %d, want 1", len(first))
	}
	if first[0].Action != domain.PositionActionClose {
		t.Fatalf("first action = %q, want %q", first[0].Action, domain.PositionActionClose)
	}
	if first[0].Lots != 0.25 {
		t.Fatalf("first lots = %v, want 0.25", first[0].Lots)
	}
	if first[0].Reason != "momentum_scalp_rsi_tp75" {
		t.Fatalf("first reason = %q, want %q", first[0].Reason, "momentum_scalp_rsi_tp75")
	}

	second := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 101.2,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars:       bullishMomentumM5Bars(),
		M1Bars: []domain.Bar{
			{RSI: 82},
		},
		Positions: []domain.Position{
			{
				Ticket:    505,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(second) != 1 {
		t.Fatalf("second len(commands) = %d, want 1", len(second))
	}
	if second[0].Lots != 0.5 {
		t.Fatalf("second lots = %v, want 0.5", second[0].Lots)
	}
	if second[0].Reason != "momentum_scalp_rsi_extreme" {
		t.Fatalf("second reason = %q, want %q", second[0].Reason, "momentum_scalp_rsi_extreme")
	}
}

func TestAnalyzeMomentumScalpClosesWhenM5StructureBreaks(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	manager.SeedState(domain.PositionState{
		Ticket:       606,
		OpenTime:     now.Add(-5 * time.Minute),
		BETriggerATR: 1.5,
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 100.9,
		CurrentATR:   1.0,
		AvgATR:       1.0,
		H1Bars:       samplePositionBars(),
		M5Bars: []domain.Bar{
			{Close: 100.8},
			{Close: 100.7},
			{Close: 100.6},
			{Close: 100.5},
			{Close: 100.4},
			{Close: 100.3},
			{Close: 100.2},
			{Close: 100.1},
		},
		M1Bars: []domain.Bar{
			{RSI: 60},
		},
		Positions: []domain.Position{
			{
				Ticket:    606,
				Type:      "BUY",
				OpenPrice: 100.0,
				Lots:      0.5,
				Comment:   "momentum_scalp",
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(got))
	}
	if got[0].Reason != "momentum_scalp_m5_structure_break" {
		t.Fatalf("reason = %q, want %q", got[0].Reason, "momentum_scalp_m5_structure_break")
	}
}

type recordingStateStore struct {
	loadAccount string
	loadSymbol  string
	loaded      map[int64]domain.PositionState
	saved       []persistedState
}

type persistedState struct {
	accountID string
	symbol    string
	state     domain.PositionState
}

func (s *recordingStateStore) SavePositionState(_ context.Context, accountID, symbol string, state domain.PositionState) error {
	s.saved = append(s.saved, persistedState{accountID: accountID, symbol: symbol, state: state})
	return nil
}

func (s *recordingStateStore) LoadPositionStates(_ context.Context, accountID, symbol string) (map[int64]domain.PositionState, error) {
	s.loadAccount = accountID
	s.loadSymbol = symbol
	return s.loaded, nil
}

func samplePositionBars() []domain.Bar {
	return []domain.Bar{
		{EMA20: 3341.0, EMA50: 3337.0, RSI: 65, ADX: 32, MACDHist: 0.6, ATR: 2.0},
		{EMA20: 3341.5, EMA50: 3337.5, RSI: 63, ADX: 31, MACDHist: 0.5, ATR: 2.0},
		{EMA20: 3342.0, EMA50: 3338.0, RSI: 60, ADX: 30, MACDHist: 0.4, ATR: 2.0},
		{EMA20: 3342.5, EMA50: 3338.5, RSI: 58, ADX: 31, MACDHist: 0.3, ATR: 2.0},
		{EMA20: 3343.0, EMA50: 3339.0, RSI: 56, ADX: 29, MACDHist: 0.2, ATR: 2.0},
	}
}

func bullishMomentumM5Bars() []domain.Bar {
	return []domain.Bar{
		{Close: 99.6},
		{Close: 99.8},
		{Close: 100.0},
		{Close: 100.1},
		{Close: 100.2},
		{Close: 100.3},
		{Close: 100.35},
		{Close: 100.4},
	}
}

func TestBreakevenSkippedWhenBestSLAlreadyBetterBUY(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	// BUY 仓位，BestSL 已经在 3342.0（盈利方向），OpenPrice 是 3340.0
	// 保本止损不应该把 SL 拉回到 3340.0
	manager.SeedState(domain.PositionState{
		Ticket:       701,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BestSL:       3342.0, // 已经在盈利区域
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3344.0,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    701,
				Type:      "BUY",
				OpenPrice: 3340.0,
				SL:        3342.0, // 当前 SL 已经在盈利区
				Lots:      0.5,
			},
		},
	})

	// 不应该产生 MODIFY（保本）指令，因为 BestSL=3342 > OpenPrice=3340
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionModify && cmd.NewSL == 3340.0 {
			t.Fatalf("breakeven MODIFY should be skipped: BestSL=%.2f already better than OpenPrice=%.2f",
				3342.0, 3340.0)
		}
	}
	t.Logf("commands generated: %d (no backward SL move)", len(got))
}

func TestBreakevenSkippedWhenBestSLAlreadyBetterSELL(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	// SELL 仓位，BestSL 已经在 3338.0（盈利方向），OpenPrice 是 3340.0
	// 保本止损不应该把 SL 拉回到 3340.0
	manager.SeedState(domain.PositionState{
		Ticket:       702,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BestSL:       3338.0, // 已经在盈利区域（SELL 低更好）
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3336.0,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    702,
				Type:      "SELL",
				OpenPrice: 3340.0,
				SL:        3338.0, // 当前 SL 已经在盈利区
				Lots:      0.5,
			},
		},
	})

	// 不应该产生 MODIFY（保本）指令，因为 BestSL=3338 < OpenPrice=3340
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionModify && cmd.NewSL == 3340.0 {
			t.Fatalf("breakeven MODIFY should be skipped: BestSL=%.2f already better than OpenPrice=%.2f",
				3338.0, 3340.0)
		}
	}
	t.Logf("commands generated: %d (no backward SL move)", len(got))
}

func TestBreakevenAllowedWhenNoPriorBestSL(t *testing.T) {
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))
	// BUY 仓位，BestSL=0（没有历史），应该允许保本
	manager.SeedState(domain.PositionState{
		Ticket:       703,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BestSL:       0, // 没有历史 SL
	})

	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{
				Ticket:    703,
				Type:      "BUY",
				OpenPrice: 3340.0,
				SL:        0, // 没有 SL
				Lots:      0.5,
			},
		},
	})

	foundBreakeven := false
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionModify && cmd.NewSL == 3340.0 {
			foundBreakeven = true
		}
	}
	if !foundBreakeven {
		t.Fatal("breakeven should be allowed when no prior BestSL")
	}
}

func TestGroupTP1Coordination(t *testing.T) {
	// 场景：两个 BUY 仓位，一个到了 TP1（高盈利），一个没到
	// 预期：两个都触发 TP1 平仓（协调）
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))

	// 仓位A：已保本，未 TP1
	manager.SeedState(domain.PositionState{
		Ticket:       801,
		OpenTime:     now.Add(-3 * time.Hour),
		BETriggerATR: 1.5,
		BEMoved:      true, // 已保本
		BestSL:       3330.0,
	})
	// 仓位B：已保本，未 TP1
	manager.SeedState(domain.PositionState{
		Ticket:       802,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BEMoved:      true,
		BestSL:       3335.0,
	})

	// 仓位A 在 3330 入场，当前价 3345 → 盈利 15/2 = 7.5 ATR → 远超 TP1
	// 仓位B 在 3335 入场，当前价 3345 → 盈利 10/2 = 5 ATR → 也超 TP1
	// 用 samplePositionBars 让 tp1Multi = 1.5（默认值）
	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3345.0,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{Ticket: 801, Type: "BUY", OpenPrice: 3330.0, Lots: 0.5, SL: 3330.0},
			{Ticket: 802, Type: "BUY", OpenPrice: 3335.0, Lots: 0.3, SL: 3335.0},
		},
	})

	tp1Count := 0
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionClose && (cmd.Reason == "TP1_7.5ATR" || cmd.Reason == "TP1_5.0ATR" || strings.Contains(cmd.Reason, "group_tp1") || strings.Contains(cmd.Reason, "TP1")) {
			tp1Count++
		}
	}
	// 两个仓位都应该有 TP1 CLOSE 命令
	if tp1Count < 2 {
		t.Fatalf("expected 2 TP1 CLOSE commands (group coordination), got %d: %v", tp1Count, got)
	}
}

func TestGroupTP1OnlyOneTriggers(t *testing.T) {
	// 场景：两个 BUY 仓位，只有 A 到了 TP1，B 没到
	// 预期：A 触发 TP1 后，协调 pass 让 B 也 TP1
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))

	// 仓位A：已保本
	manager.SeedState(domain.PositionState{
		Ticket:       901,
		OpenTime:     now.Add(-3 * time.Hour),
		BETriggerATR: 1.5,
		BEMoved:      true,
		BestSL:       3330.0,
	})
	// 仓位B：已保本
	manager.SeedState(domain.PositionState{
		Ticket:       902,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BEMoved:      true,
		BestSL:       3342.0,
	})

	// 仓位A: entry=3330, price=3343 → profit=13/2=6.5 ATR → 超过 TP1 (1.5 ATR)
	// 仓位B: entry=3342, price=3343 → profit=1/2=0.5 ATR → 不到 TP1
	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3343.0,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{Ticket: 901, Type: "BUY", OpenPrice: 3330.0, Lots: 0.5, SL: 3330.0},
			{Ticket: 902, Type: "BUY", OpenPrice: 3342.0, Lots: 0.3, SL: 3342.0},
		},
	})

	// 统计两个仓位的 TP1 命令
	tp1Tickets := make(map[int64]bool)
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionClose && (strings.Contains(cmd.Reason, "TP1") || strings.Contains(cmd.Reason, "group_tp1")) {
			tp1Tickets[cmd.Ticket] = true
		}
	}
	if !tp1Tickets[901] {
		t.Fatal("position 901 should have TP1 (direct trigger)")
	}
	if !tp1Tickets[902] {
		t.Fatal("position 902 should have TP1 (group coordination)")
	}
}

func TestGroupBECoordination(t *testing.T) {
	// 场景：两个 BUY 仓位，一个刚触发 BE
	// 预期：两个仓位的 SL 统一到最优（较高的 OpenPrice）
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)
	manager := positionmgr.New(positionmgr.WithNow(func() time.Time { return now }))

	// 仓位A：未保本
	manager.SeedState(domain.PositionState{
		Ticket:       1001,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BestSL:       0,
	})
	// 仓位B：未保本
	manager.SeedState(domain.PositionState{
		Ticket:       1002,
		OpenTime:     now.Add(-2 * time.Hour),
		BETriggerATR: 1.5,
		BestSL:       0,
	})

	// price=3343.2, ATR=2 → profitA = 13.2/2 = 6.6 ATR, profitB = 3.2/2 = 1.6 ATR
	// 两个都 > BETriggerATR(1.5)，都会触发 BE
	got := manager.Analyze(domain.PositionSnapshot{
		CurrentPrice: 3343.2,
		CurrentATR:   2.0,
		AvgATR:       2.0,
		H1Bars:       samplePositionBars(),
		Positions: []domain.Position{
			{Ticket: 1001, Type: "BUY", OpenPrice: 3330.0, Lots: 0.5},
			{Ticket: 1002, Type: "BUY", OpenPrice: 3340.0, Lots: 0.3},
		},
	})

	// 两个仓位都应有 MODIFY 命令，SL 应统一到 3340（较高的 OpenPrice）
	beSLs := make(map[int64]float64)
	for _, cmd := range got {
		if cmd.Action == domain.PositionActionModify && (strings.Contains(cmd.Reason, "breakeven") || strings.Contains(cmd.Reason, "group_be")) {
			beSLs[cmd.Ticket] = cmd.NewSL
		}
	}
	if beSLs[1001] != 3340.0 {
		t.Fatalf("position 1001 SL should be 3340.0 (unified), got %.2f", beSLs[1001])
	}
	if beSLs[1002] != 3340.0 {
		t.Fatalf("position 1002 SL should be 3340.0 (unified), got %.2f", beSLs[1002])
	}
}
