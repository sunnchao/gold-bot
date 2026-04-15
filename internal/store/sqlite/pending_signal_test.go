package sqlite

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

func TestPendingSignalRepositorySaveAndGetPendingSignals(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, time.UTC)

	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      9,
		Strategy:   "pullback",
		Indicators: `{"adx":31,"rsi":58}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(30 * time.Second),
	}
	if err := repo.SavePendingSignal(ctx, signal); err != nil {
		t.Fatalf("SavePendingSignal returned error: %v", err)
	}
	if signal.ID == 0 {
		t.Fatal("signal.ID = 0, want non-zero after insert")
	}

	got, err := repo.GetPendingSignals(ctx, "90011087", "XAUUSD")
	if err != nil {
		t.Fatalf("GetPendingSignals returned error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].ID != signal.ID {
		t.Fatalf("got[0].ID = %d, want %d", got[0].ID, signal.ID)
	}
	if got[0].Strategy != "pullback" {
		t.Fatalf("got[0].Strategy = %q, want %q", got[0].Strategy, "pullback")
	}
}

func TestPendingSignalRepositoryUpdateArbitrationRemovesSignalFromPendingList(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 15, 0, 0, time.UTC)

	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "sell",
		Score:      8,
		Strategy:   "reversal",
		Indicators: `{"adx":28,"rsi":71}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(30 * time.Second),
	}
	if err := repo.SavePendingSignal(ctx, signal); err != nil {
		t.Fatalf("SavePendingSignal returned error: %v", err)
	}

	if err := repo.UpdateArbitration(ctx, signal.ID, "approved", "mao ok"); err != nil {
		t.Fatalf("UpdateArbitration returned error: %v", err)
	}

	pending, err := repo.GetPendingSignals(ctx, signal.AccountID, signal.Symbol)
	if err != nil {
		t.Fatalf("GetPendingSignals returned error: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("len(pending) = %d, want 0", len(pending))
	}

	stored, err := repo.GetPendingSignalByID(ctx, signal.ID)
	if err != nil {
		t.Fatalf("GetPendingSignalByID returned error: %v", err)
	}
	if stored.Status != "approved" {
		t.Fatalf("stored.Status = %q, want %q", stored.Status, "approved")
	}
	if stored.ArbitrationReason != "mao ok" {
		t.Fatalf("stored.ArbitrationReason = %q, want %q", stored.ArbitrationReason, "mao ok")
	}
}

func TestPendingSignalRepositoryGetPendingSignalsWithoutFiltersIncludesArbitratedSignals(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 30, 0, 0, time.UTC)

	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      9,
		Strategy:   "pullback",
		Indicators: `{"adx":31,"rsi":58}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(30 * time.Second),
	}
	if err := repo.SavePendingSignal(ctx, signal); err != nil {
		t.Fatalf("SavePendingSignal returned error: %v", err)
	}

	if err := repo.UpdateArbitration(ctx, signal.ID, "approved", "mao ok"); err != nil {
		t.Fatalf("UpdateArbitration returned error: %v", err)
	}

	allSignals, err := repo.GetPendingSignals(ctx, "", "")
	if err != nil {
		t.Fatalf("GetPendingSignals(all) returned error: %v", err)
	}
	if len(allSignals) != 1 {
		t.Fatalf("len(allSignals) = %d, want 1", len(allSignals))
	}
	if allSignals[0].ID != signal.ID {
		t.Fatalf("allSignals[0].ID = %d, want %d", allSignals[0].ID, signal.ID)
	}
	if allSignals[0].Status != "approved" {
		t.Fatalf("allSignals[0].Status = %q, want %q", allSignals[0].Status, "approved")
	}
}

func TestPendingSignalRepositoryUpdateArbitrationReturnsErrorWhenSignalDoesNotExist(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()

	err := repo.UpdateArbitration(ctx, 999999, "approved", "mao ok")
	if err == nil {
		t.Fatal("UpdateArbitration error = nil, want error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("UpdateArbitration error = %q, want substring %q", err.Error(), "not found")
	}
}

func TestPendingSignalRepositoryExpireStaleSignalsMarksOnlyExpiredPendingRows(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()
	now := time.Now().UTC()

	expired := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      7,
		Strategy:   "pullback",
		Indicators: `{"adx":20}`,
		Status:     "pending",
		CreatedAt:  now.Add(-2 * time.Minute),
		ExpiresAt:  now.Add(-1 * time.Minute),
	}
	active := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "GBPJPY",
		Side:       "sell",
		Score:      8,
		Strategy:   "breakout",
		Indicators: `{"adx":29}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(1 * time.Minute),
	}
	for _, signal := range []*domain.PendingSignal{expired, active} {
		if err := repo.SavePendingSignal(ctx, signal); err != nil {
			t.Fatalf("SavePendingSignal returned error: %v", err)
		}
	}

	count, err := repo.ExpireStaleSignals(ctx)
	if err != nil {
		t.Fatalf("ExpireStaleSignals returned error: %v", err)
	}
	if count != 1 {
		t.Fatalf("ExpireStaleSignals count = %d, want 1", count)
	}

	expiredStored, err := repo.GetPendingSignalByID(ctx, expired.ID)
	if err != nil {
		t.Fatalf("GetPendingSignalByID(expired) returned error: %v", err)
	}
	if expiredStored.Status != "timeout" {
		t.Fatalf("expired status = %q, want %q", expiredStored.Status, "timeout")
	}
	if expiredStored.ArbitrationResult != "timeout" {
		t.Fatalf("expired arbitration_result = %q, want %q", expiredStored.ArbitrationResult, "timeout")
	}

	activePending, err := repo.GetPendingSignals(ctx, active.AccountID, active.Symbol)
	if err != nil {
		t.Fatalf("GetPendingSignals(active) returned error: %v", err)
	}
	if len(activePending) != 1 {
		t.Fatalf("len(activePending) = %d, want 1", len(activePending))
	}
}

func TestPendingSignalRepositorySavePendingSignalUsesReturningIDForPostgres(t *testing.T) {
	t.Cleanup(resetDialectForTest)
	setPgForTest(true)

	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)
	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      9,
		Strategy:   "pullback",
		Indicators: `{"adx":31,"rsi":58}`,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(30 * time.Second),
	}

	query, args := buildPendingSignalInsert(signal)
	if !strings.Contains(query, "RETURNING id") {
		t.Fatalf("query = %q, want RETURNING id", query)
	}
	if len(args) != 9 {
		t.Fatalf("len(args) = %d, want 9", len(args))
	}
	if got := args[0]; got != signal.AccountID {
		t.Fatalf("args[0] = %v, want %q", got, signal.AccountID)
	}
	if got := args[1]; got != signal.Symbol {
		t.Fatalf("args[1] = %v, want %q", got, signal.Symbol)
	}
}

func TestPendingSignalRepositoryExpireStaleSignalsReturnsAffectedCount(t *testing.T) {
	repo := newTestPendingSignalRepository(t)
	ctx := context.Background()
	now := time.Now().UTC()

	signal := &domain.PendingSignal{
		AccountID:  "90011087",
		Symbol:     "XAUUSD",
		Side:       "buy",
		Score:      7,
		Strategy:   "pullback",
		Indicators: `{"adx":20}`,
		Status:     "pending",
		CreatedAt:  now.Add(-2 * time.Minute),
		ExpiresAt:  now.Add(-1 * time.Minute),
	}
	if err := repo.SavePendingSignal(ctx, signal); err != nil {
		t.Fatalf("SavePendingSignal returned error: %v", err)
	}

	count, err := repo.ExpireStaleSignals(ctx)
	if err != nil {
		t.Fatalf("ExpireStaleSignals returned error: %v", err)
	}
	if count != 1 {
		t.Fatalf("ExpireStaleSignals count = %d, want 1", count)
	}
}

func newTestPendingSignalRepository(t *testing.T) *PendingSignalRepository {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "pending-signals.sqlite")
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

	return NewPendingSignalRepository(db)
}
