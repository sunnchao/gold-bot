package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

func TestDecisionRepositoryRecordsAndListsTimelineEvents(t *testing.T) {
	repo := newTestDecisionRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)

	events := []domain.DecisionEvent{
		{
			DecisionID:  "tpv1_first",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageAIResult,
			Status:      domain.DecisionStatusAccepted,
			ReasonCodes: []string{"mode.close"},
			Summary: map[string]any{
				"mode": "close",
			},
			RelatedCommandID: "cmd_first",
			CreatedAt:        now,
		},
		{
			DecisionID:  "tpv1_second",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageRiskGate,
			Status:      domain.DecisionStatusRejected,
			ReasonCodes: []string{"risk.spread.wide"},
			Summary: map[string]any{
				"max_lots": 0,
			},
			CreatedAt: now.Add(time.Minute),
		},
		{
			DecisionID: "tpv1_other_symbol",
			AccountID:  "90011087",
			Symbol:     "GBPJPY",
			Stage:      domain.DecisionStageAIResult,
			Status:     domain.DecisionStatusAccepted,
			CreatedAt:  now.Add(2 * time.Minute),
		},
	}
	for _, event := range events {
		if err := repo.Record(ctx, event); err != nil {
			t.Fatalf("Record(%s/%s) returned error: %v", event.DecisionID, event.Stage, err)
		}
	}

	got, err := repo.List(ctx, domain.DecisionEventFilter{
		AccountID: "90011087",
		Symbol:    "XAUUSD",
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2: %+v", len(got), got)
	}
	if got[0].DecisionID != "tpv1_second" {
		t.Fatalf("newest event decision_id = %q, want tpv1_second", got[0].DecisionID)
	}
	if got[0].Status != domain.DecisionStatusRejected {
		t.Fatalf("status = %q, want %q", got[0].Status, domain.DecisionStatusRejected)
	}
	if len(got[0].ReasonCodes) != 1 || got[0].ReasonCodes[0] != "risk.spread.wide" {
		t.Fatalf("reason_codes = %+v, want [risk.spread.wide]", got[0].ReasonCodes)
	}
	if got[1].RelatedCommandID != "cmd_first" {
		t.Fatalf("related_command_id = %q, want cmd_first", got[1].RelatedCommandID)
	}
	if got[1].Summary["mode"] != "close" {
		t.Fatalf("summary.mode = %#v, want close", got[1].Summary["mode"])
	}

	rejected, err := repo.List(ctx, domain.DecisionEventFilter{
		AccountID: "90011087",
		Status:    domain.DecisionStatusRejected,
		Limit:     10,
	})
	if err != nil {
		t.Fatalf("List rejected returned error: %v", err)
	}
	if len(rejected) != 1 || rejected[0].DecisionID != "tpv1_second" {
		t.Fatalf("rejected events = %+v, want only tpv1_second", rejected)
	}
}

func newTestDecisionRepository(t *testing.T) *DecisionRepository {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "decisions.sqlite")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	return NewDecisionRepository(db)
}
