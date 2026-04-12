package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/store"
)

func TestAccountRepositoryPersistsAccountAndRuntime(t *testing.T) {
	repo := newTestAccountRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 12, 3, 4, 5, 0, time.UTC)

	if err := repo.UpsertAccount(ctx, domain.Account{
		AccountID:   "90011087",
		Broker:      "Demo Broker",
		ServerName:  "Demo-1",
		AccountName: "Primary",
		Currency:    "USD",
		Leverage:    500,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}

	if err := repo.SaveHeartbeat(ctx, domain.AccountRuntime{
		AccountID:       "90011087",
		Connected:       true,
		Balance:         1000.5,
		Equity:          1100.25,
		Margin:          100,
		FreeMargin:      1000.25,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		MT4ServerTime:   "2026.04.12 11:04",
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}

	if err := repo.SaveTick(ctx, "90011087", now.Add(time.Minute)); err != nil {
		t.Fatalf("SaveTick returned error: %v", err)
	}

	account, err := repo.GetAccount(ctx, "90011087")
	if err != nil {
		t.Fatalf("GetAccount returned error: %v", err)
	}
	if account.Broker != "Demo Broker" {
		t.Fatalf("Broker = %q, want %q", account.Broker, "Demo Broker")
	}

	runtime, err := repo.GetRuntime(ctx, "90011087")
	if err != nil {
		t.Fatalf("GetRuntime returned error: %v", err)
	}
	if !runtime.Connected {
		t.Fatal("Connected = false, want true")
	}
	if runtime.Balance != 1000.5 {
		t.Fatalf("Balance = %v, want %v", runtime.Balance, 1000.5)
	}
	if runtime.LastHeartbeatAt != now {
		t.Fatalf("LastHeartbeatAt = %v, want %v", runtime.LastHeartbeatAt, now)
	}
	if runtime.LastTickAt != now.Add(time.Minute) {
		t.Fatalf("LastTickAt = %v, want %v", runtime.LastTickAt, now.Add(time.Minute))
	}
}

func newTestAccountRepository(t *testing.T) *AccountRepository {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "accounts.sqlite")
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

	return NewAccountRepository(db)
}
