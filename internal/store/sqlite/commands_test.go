package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

func TestPollTakePendingMarksDelivered(t *testing.T) {
	repo, history := newTestCommandRepositories(t)
	_ = history
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	if err := repo.Enqueue(ctx, domain.Command{
		CommandID: "sig_1",
		AccountID: "90011087",
		Action:    domain.CommandActionSignal,
		Status:    domain.CommandStatusPending,
		Payload: map[string]any{
			"command_id": "sig_1",
			"action":     "SIGNAL",
			"symbol":     "XAUUSD",
			"type":       "BUY",
		},
		CreatedAt: now,
	}); err != nil {
		t.Fatalf("Enqueue returned error: %v", err)
	}

	commands, err := repo.TakePending(ctx, "90011087", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("TakePending returned error: %v", err)
	}
	if len(commands) != 1 {
		t.Fatalf("len(commands) = %d, want %d", len(commands), 1)
	}
	if commands[0].Status != domain.CommandStatusDelivered {
		t.Fatalf("status = %q, want %q", commands[0].Status, domain.CommandStatusDelivered)
	}
	if commands[0].DeliveredAt != now.Add(time.Minute) {
		t.Fatalf("delivered_at = %v, want %v", commands[0].DeliveredAt, now.Add(time.Minute))
	}

	commands, err = repo.TakePending(ctx, "90011087", now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("second TakePending returned error: %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("len(commands) = %d, want %d after delivery", len(commands), 0)
	}
}

func TestOrderResultMarkFromResult(t *testing.T) {
	repo, history := newTestCommandRepositories(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	for _, command := range []domain.Command{
		{
			CommandID: "sig_ok",
			AccountID: "90011087",
			Action:    domain.CommandActionSignal,
			Status:    domain.CommandStatusDelivered,
			Payload: map[string]any{
				"command_id": "sig_ok",
				"action":     "SIGNAL",
			},
			CreatedAt:   now,
			DeliveredAt: now,
		},
		{
			CommandID: "sig_fail",
			AccountID: "90011087",
			Action:    domain.CommandActionSignal,
			Status:    domain.CommandStatusDelivered,
			Payload: map[string]any{
				"command_id": "sig_fail",
				"action":     "SIGNAL",
			},
			CreatedAt:   now,
			DeliveredAt: now,
		},
	} {
		if err := repo.Enqueue(ctx, command); err != nil {
			t.Fatalf("Enqueue(%s) returned error: %v", command.CommandID, err)
		}
	}

	if err := history.SaveCommandResult(ctx, domain.CommandResult{
		CommandID: "sig_ok",
		AccountID: "90011087",
		Result:    "OK",
		Ticket:    123,
		CreatedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("SaveCommandResult ok returned error: %v", err)
	}
	if err := repo.MarkFromResult(ctx, "sig_ok", "OK", now.Add(time.Minute)); err != nil {
		t.Fatalf("MarkFromResult ok returned error: %v", err)
	}

	if err := history.SaveCommandResult(ctx, domain.CommandResult{
		CommandID: "sig_fail",
		AccountID: "90011087",
		Result:    "REJECTED",
		ErrorText: "risk_check_failed",
		CreatedAt: now.Add(2 * time.Minute),
	}); err != nil {
		t.Fatalf("SaveCommandResult fail returned error: %v", err)
	}
	if err := repo.MarkFromResult(ctx, "sig_fail", "REJECTED", now.Add(2*time.Minute)); err != nil {
		t.Fatalf("MarkFromResult fail returned error: %v", err)
	}

	gotOK, err := repo.Get(ctx, "sig_ok")
	if err != nil {
		t.Fatalf("Get(sig_ok) returned error: %v", err)
	}
	if gotOK.Status != domain.CommandStatusAcked {
		t.Fatalf("sig_ok status = %q, want %q", gotOK.Status, domain.CommandStatusAcked)
	}
	if gotOK.AckedAt != now.Add(time.Minute) {
		t.Fatalf("sig_ok acked_at = %v, want %v", gotOK.AckedAt, now.Add(time.Minute))
	}

	gotFailed, err := repo.Get(ctx, "sig_fail")
	if err != nil {
		t.Fatalf("Get(sig_fail) returned error: %v", err)
	}
	if gotFailed.Status != domain.CommandStatusFailed {
		t.Fatalf("sig_fail status = %q, want %q", gotFailed.Status, domain.CommandStatusFailed)
	}
	if gotFailed.FailedAt != now.Add(2*time.Minute) {
		t.Fatalf("sig_fail failed_at = %v, want %v", gotFailed.FailedAt, now.Add(2*time.Minute))
	}
}

func newTestCommandRepositories(t *testing.T) (*CommandRepository, *HistoryRepository) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "commands.sqlite")
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

	return NewCommandRepository(db), NewHistoryRepository(db)
}
