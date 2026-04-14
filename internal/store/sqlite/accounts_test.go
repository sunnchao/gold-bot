package sqlite

import (
	"context"
	"path/filepath"
	"sync"
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

func TestAccountRepositorySaveBarsHandlesConcurrentWrites(t *testing.T) {
	repo := newTestAccountRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 13, 6, 49, 41, 0, time.UTC)

	if err := repo.EnsureAccount(ctx, "900110872", now); err != nil {
		t.Fatalf("EnsureAccount returned error: %v", err)
	}

	timeframes := []string{"M15", "M30", "H1", "H4"}
	bars := []domain.Bar{
		{
			Time:   "1712988000",
			Open:   3235.1,
			High:   3237.2,
			Low:    3232.8,
			Close:  3236.6,
			Volume: 42,
		},
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	errCh := make(chan error, len(timeframes)*8)

	for i := 0; i < 8; i++ {
		for _, tf := range timeframes {
			wg.Add(1)
			go func(timeframe string, offset int) {
				defer wg.Done()
				<-start
				errCh <- repo.SaveBars(ctx, "900110872", timeframe, bars, now.Add(time.Duration(offset)*time.Millisecond))
			}(tf, i)
		}
	}

	close(start)
	wg.Wait()
	close(errCh)

	for err := range errCh {
		if err != nil {
			t.Fatalf("SaveBars returned error: %v", err)
		}
	}

	state, err := repo.GetState(ctx, "900110872")
	if err != nil {
		t.Fatalf("GetState returned error: %v", err)
	}
	for _, tf := range timeframes {
		if len(state.Bars[tf]) == 0 {
			t.Fatalf("state.Bars[%s] is empty", tf)
		}
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
