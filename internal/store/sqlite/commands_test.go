package sqlite

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

func TestPollTakePendingPostgresMarksDelivered(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN not set")
	}

	setPgForTest(true)
	defer resetDialectForTest()

	repo, db := newTestPostgresCommandRepository(t, dsn)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	if err := repo.Enqueue(ctx, domain.Command{
		CommandID: "sig_pg_1",
		AccountID: "90011087",
		Action:    domain.CommandActionSignal,
		Status:    domain.CommandStatusPending,
		Payload: map[string]any{
			"command_id": "sig_pg_1",
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

	var status string
	if err := db.QueryRow(`SELECT status FROM commands WHERE command_id = $1`, "sig_pg_1").Scan(&status); err != nil {
		t.Fatalf("query command status returned error: %v", err)
	}
	if status != string(domain.CommandStatusDelivered) {
		t.Fatalf("stored status = %q, want %q", status, domain.CommandStatusDelivered)
	}
}

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

func TestOrderResultApplyResultTransitionsDeliveredCommandAndPersistsAudit(t *testing.T) {
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

	if err := repo.ApplyResult(ctx, domain.CommandResult{
		CommandID: "sig_ok",
		AccountID: "90011087",
		Result:    "OK",
		Ticket:    123,
		CreatedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("ApplyResult ok returned error: %v", err)
	}

	if err := repo.ApplyResult(ctx, domain.CommandResult{
		CommandID: "sig_fail",
		AccountID: "90011087",
		Result:    "REJECTED",
		ErrorText: "risk_check_failed",
		CreatedAt: now.Add(2 * time.Minute),
	}); err != nil {
		t.Fatalf("ApplyResult fail returned error: %v", err)
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

	if got := countCommandResults(t, history.db, "sig_ok"); got != 1 {
		t.Fatalf("sig_ok command result count = %d, want 1", got)
	}
	if got := countCommandResults(t, history.db, "sig_fail"); got != 1 {
		t.Fatalf("sig_fail command result count = %d, want 1", got)
	}
}

func TestOrderResultApplyResultNoOpForWrongAccountUnknownPendingAndDuplicateTerminal(t *testing.T) {
	repo, history := newTestCommandRepositories(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	for _, command := range []domain.Command{
		{
			CommandID:   "sig_other_account",
			AccountID:   "90022000",
			Action:      domain.CommandActionSignal,
			Status:      domain.CommandStatusDelivered,
			Payload:     map[string]any{"command_id": "sig_other_account", "action": "SIGNAL"},
			CreatedAt:   now,
			DeliveredAt: now,
		},
		{
			CommandID: "sig_pending",
			AccountID: "90011087",
			Action:    domain.CommandActionSignal,
			Status:    domain.CommandStatusPending,
			Payload:   map[string]any{"command_id": "sig_pending", "action": "SIGNAL"},
			CreatedAt: now,
		},
		{
			CommandID:   "sig_done",
			AccountID:   "90011087",
			Action:      domain.CommandActionSignal,
			Status:      domain.CommandStatusDelivered,
			Payload:     map[string]any{"command_id": "sig_done", "action": "SIGNAL"},
			CreatedAt:   now,
			DeliveredAt: now,
		},
	} {
		if err := repo.Enqueue(ctx, command); err != nil {
			t.Fatalf("Enqueue(%s) returned error: %v", command.CommandID, err)
		}
	}

	firstAckAt := now.Add(time.Minute)
	if err := repo.ApplyResult(ctx, domain.CommandResult{
		CommandID: "sig_done",
		AccountID: "90011087",
		Result:    "OK",
		Ticket:    321,
		CreatedAt: firstAckAt,
	}); err != nil {
		t.Fatalf("ApplyResult first ack returned error: %v", err)
	}

	testCases := []struct {
		name       string
		input      domain.CommandResult
		commandID  string
		wantStatus domain.CommandStatus
		wantAcked  time.Time
		wantFailed time.Time
		wantRows   int
	}{
		{
			name: "wrong account",
			input: domain.CommandResult{
				CommandID: "sig_other_account",
				AccountID: "90011087",
				Result:    "OK",
				Ticket:    111,
				CreatedAt: now.Add(2 * time.Minute),
			},
			commandID:  "sig_other_account",
			wantStatus: domain.CommandStatusDelivered,
			wantRows:   0,
		},
		{
			name: "unknown command",
			input: domain.CommandResult{
				CommandID: "missing",
				AccountID: "90011087",
				Result:    "ERROR",
				ErrorText: "missing",
				CreatedAt: now.Add(3 * time.Minute),
			},
			commandID: "",
			wantRows:  0,
		},
		{
			name: "pending command",
			input: domain.CommandResult{
				CommandID: "sig_pending",
				AccountID: "90011087",
				Result:    "ERROR",
				ErrorText: "too_early",
				CreatedAt: now.Add(4 * time.Minute),
			},
			commandID:  "sig_pending",
			wantStatus: domain.CommandStatusPending,
			wantRows:   0,
		},
		{
			name: "duplicate terminal callback",
			input: domain.CommandResult{
				CommandID: "sig_done",
				AccountID: "90011087",
				Result:    "ERROR",
				ErrorText: "late_failure",
				CreatedAt: now.Add(5 * time.Minute),
			},
			commandID:  "sig_done",
			wantStatus: domain.CommandStatusAcked,
			wantAcked:  firstAckAt,
			wantRows:   1,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := repo.ApplyResult(ctx, tc.input)
			if err == nil {
				t.Fatal("ApplyResult returned nil error, want sql.ErrNoRows")
			}
			if err != sql.ErrNoRows {
				t.Fatalf("ApplyResult returned %v, want sql.ErrNoRows", err)
			}

			if tc.commandID != "" {
				got, getErr := repo.Get(ctx, tc.commandID)
				if getErr != nil {
					t.Fatalf("Get(%s) returned error: %v", tc.commandID, getErr)
				}
				if got.Status != tc.wantStatus {
					t.Fatalf("status = %q, want %q", got.Status, tc.wantStatus)
				}
				if !got.AckedAt.Equal(tc.wantAcked) {
					t.Fatalf("acked_at = %v, want %v", got.AckedAt, tc.wantAcked)
				}
				if !got.FailedAt.Equal(tc.wantFailed) {
					t.Fatalf("failed_at = %v, want %v", got.FailedAt, tc.wantFailed)
				}
			}

			if got := countCommandResults(t, history.db, tc.input.CommandID); got != tc.wantRows {
				t.Fatalf("command result count = %d, want %d", got, tc.wantRows)
			}
		})
	}
}

func TestPollTakePendingRetriesOnSQLiteBusy(t *testing.T) {
	repo, _, dbPath := newTestCommandRepositoriesWithPath(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	if err := repo.Enqueue(ctx, domain.Command{
		CommandID: "sig_busy_poll",
		AccountID: "90011087",
		Action:    domain.CommandActionSignal,
		Status:    domain.CommandStatusPending,
		Payload:   map[string]any{"command_id": "sig_busy_poll", "action": "SIGNAL"},
		CreatedAt: now,
	}); err != nil {
		t.Fatalf("Enqueue returned error: %v", err)
	}

	lockDB, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite lockDB returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := lockDB.Close(); err != nil {
			t.Fatalf("Close lockDB returned error: %v", err)
		}
	})

	if _, err := lockDB.Exec(`BEGIN IMMEDIATE`); err != nil {
		t.Fatalf("BEGIN IMMEDIATE returned error: %v", err)
	}
	done := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		_, _ = lockDB.Exec(`ROLLBACK`)
		close(done)
	}()
	defer func() { <-done }()

	commands, err := repo.TakePending(ctx, "90011087", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("TakePending returned error: %v", err)
	}
	if len(commands) != 1 {
		t.Fatalf("len(commands) = %d, want 1", len(commands))
	}
}

func TestOrderResultApplyResultRetriesOnSQLiteBusy(t *testing.T) {
	repo, history, dbPath := newTestCommandRepositoriesWithPath(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 1, 2, 3, 0, time.UTC)

	if err := repo.Enqueue(ctx, domain.Command{
		CommandID:   "sig_busy_result",
		AccountID:   "90011087",
		Action:      domain.CommandActionSignal,
		Status:      domain.CommandStatusDelivered,
		Payload:     map[string]any{"command_id": "sig_busy_result", "action": "SIGNAL"},
		CreatedAt:   now,
		DeliveredAt: now,
	}); err != nil {
		t.Fatalf("Enqueue returned error: %v", err)
	}

	lockDB, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite lockDB returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := lockDB.Close(); err != nil {
			t.Fatalf("Close lockDB returned error: %v", err)
		}
	})

	if _, err := lockDB.Exec(`BEGIN IMMEDIATE`); err != nil {
		t.Fatalf("BEGIN IMMEDIATE returned error: %v", err)
	}
	done := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		_, _ = lockDB.Exec(`ROLLBACK`)
		close(done)
	}()
	defer func() { <-done }()

	if err := repo.ApplyResult(ctx, domain.CommandResult{
		CommandID: "sig_busy_result",
		AccountID: "90011087",
		Result:    "OK",
		Ticket:    999,
		CreatedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatalf("ApplyResult returned error: %v", err)
	}

	got, err := repo.Get(ctx, "sig_busy_result")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if got.Status != domain.CommandStatusAcked {
		t.Fatalf("status = %q, want %q", got.Status, domain.CommandStatusAcked)
	}
	if got := countCommandResults(t, history.db, "sig_busy_result"); got != 1 {
		t.Fatalf("command result count = %d, want 1", got)
	}
}

func newTestCommandRepositories(t *testing.T) (*CommandRepository, *HistoryRepository) {
	repo, history, _ := newTestCommandRepositoriesWithPath(t)
	return repo, history
}

func newTestCommandRepositoriesWithPath(t *testing.T) (*CommandRepository, *HistoryRepository, string) {
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

	return NewCommandRepository(db), NewHistoryRepository(db), dbPath
}

func newTestPostgresCommandRepository(t *testing.T, dsn string) (*CommandRepository, *sql.DB) {
	t.Helper()

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("sql.Open(postgres) returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close postgres db returned error: %v", err)
		}
	})

	if err := db.Ping(); err != nil {
		t.Fatalf("postgres ping returned error: %v", err)
	}

	if _, err := db.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset postgres schema returned error: %v", err)
	}

	store.SetPostgres()
	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations(postgres) returned error: %v", err)
	}

	return NewCommandRepository(db), db
}

func countCommandResults(t *testing.T, db *sql.DB, commandID string) int {
	t.Helper()

	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM command_results WHERE command_id = ?`, commandID).Scan(&count); err != nil {
		t.Fatalf("count command results returned error: %v", err)
	}

	return count
}
