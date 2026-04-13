package replay_test

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"gold-bot/internal/domain"
	"gold-bot/internal/scheduler"
)

func TestReplayFixtureMatchesExpectedJSON(t *testing.T) {
	snapshotPath := filepath.Join("testdata", "account_90011087_snapshot.json")
	expectedPath := filepath.Join("testdata", "account_90011087_expected.json")

	got, err := scheduler.RunReplayFromFile(snapshotPath)
	if err != nil {
		t.Fatalf("RunReplayFromFile returned error: %v", err)
	}

	want := loadExpectedReplay(t, expectedPath)
	assertSignalEqual(t, got.Signal, want.Signal)
	assertLogsEqual(t, got.Logs, want.Logs)
	assertPositionCommandsEqual(t, got.PositionCommands, want.PositionCommands)
}

type replayExpected struct {
	Signal           *domain.Signal           `json:"signal"`
	Logs             []domain.AnalysisLog     `json:"logs"`
	PositionCommands []domain.PositionCommand `json:"position_commands"`
}

func loadExpectedReplay(t *testing.T, path string) replayExpected {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) returned error: %v", path, err)
	}

	var got replayExpected
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal(%s) returned error: %v", path, err)
	}
	return got
}

func assertSignalEqual(t *testing.T, got, want *domain.Signal) {
	t.Helper()

	if got == nil || want == nil {
		if got != want {
			t.Fatalf("signal nil mismatch: got=%v want=%v", got, want)
		}
		return
	}

	if got.Side != want.Side {
		t.Fatalf("signal side = %q, want %q", got.Side, want.Side)
	}
	if got.Strategy != want.Strategy {
		t.Fatalf("signal strategy = %q, want %q", got.Strategy, want.Strategy)
	}
	if got.Score != want.Score {
		t.Fatalf("signal score = %d, want %d", got.Score, want.Score)
	}
	assertFloatClose(t, "signal.entry", got.Entry, want.Entry, 1e-9)
	assertFloatClose(t, "signal.stop_loss", got.StopLoss, want.StopLoss, 1e-9)
	assertFloatClose(t, "signal.tp1", got.TP1, want.TP1, 1e-9)
	assertFloatClose(t, "signal.tp2", got.TP2, want.TP2, 1e-9)
	assertFloatClose(t, "signal.atr", got.ATR, want.ATR, 1e-9)

	if len(got.AllStrategies) != len(want.AllStrategies) {
		t.Fatalf("len(signal.all_strategies) = %d, want %d", len(got.AllStrategies), len(want.AllStrategies))
	}
	for i := range got.AllStrategies {
		gotStrategy := got.AllStrategies[i]
		wantStrategy := want.AllStrategies[i]
		if gotStrategy.Strategy != wantStrategy.Strategy {
			t.Fatalf("all_strategies[%d].strategy = %q, want %q", i, gotStrategy.Strategy, wantStrategy.Strategy)
		}
		if gotStrategy.Side != wantStrategy.Side {
			t.Fatalf("all_strategies[%d].side = %q, want %q", i, gotStrategy.Side, wantStrategy.Side)
		}
		if gotStrategy.Score != wantStrategy.Score {
			t.Fatalf("all_strategies[%d].score = %d, want %d", i, gotStrategy.Score, wantStrategy.Score)
		}
		assertFloatClose(t, "all_strategies.entry", gotStrategy.Entry, wantStrategy.Entry, 1e-9)
		assertFloatClose(t, "all_strategies.stop_loss", gotStrategy.StopLoss, wantStrategy.StopLoss, 1e-9)
	}
}

func assertLogsEqual(t *testing.T, got, want []domain.AnalysisLog) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("len(logs) = %d, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("logs[%d] = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func assertPositionCommandsEqual(t *testing.T, got, want []domain.PositionCommand) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("len(position_commands) = %d, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i].Action != want[i].Action {
			t.Fatalf("position_commands[%d].action = %q, want %q", i, got[i].Action, want[i].Action)
		}
		if got[i].Ticket != want[i].Ticket {
			t.Fatalf("position_commands[%d].ticket = %d, want %d", i, got[i].Ticket, want[i].Ticket)
		}
		assertFloatClose(t, "position_commands.lots", got[i].Lots, want[i].Lots, 1e-9)
		assertFloatClose(t, "position_commands.new_sl", got[i].NewSL, want[i].NewSL, 1e-9)
		if got[i].Reason != want[i].Reason {
			t.Fatalf("position_commands[%d].reason = %q, want %q", i, got[i].Reason, want[i].Reason)
		}
	}
}

func assertFloatClose(t *testing.T, label string, got, want, tolerance float64) {
	t.Helper()

	if math.Abs(got-want) > tolerance {
		t.Fatalf("%s = %.12f, want %.12f", label, got, want)
	}
}
