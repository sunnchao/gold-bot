package sqlite

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gold-bot/internal/store"
)

func TestTokenRepositoryPersistsAndValidatesTokens(t *testing.T) {
	repo := newTestTokenRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 12, 3, 4, 5, 0, time.UTC)

	if err := repo.PutToken(ctx, "test-token", "test", false, now); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	valid, err := repo.Validate(ctx, "test-token")
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
	if !valid {
		t.Fatal("Validate returned false, want true")
	}
	valid, err = repo.Validate(ctx, "missing-token")
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
	if valid {
		t.Fatal("Validate returned true for missing token")
	}

	if err := repo.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}

	accounts, err := repo.AccountsForToken(ctx, "test-token")
	if err != nil {
		t.Fatalf("AccountsForToken returned error: %v", err)
	}
	if len(accounts) != 1 || accounts[0] != "90011087" {
		t.Fatalf("AccountsForToken = %v, want [90011087]", accounts)
	}
}

func TestTokenRepositoryAuthorizeAccountBindsFirstAccountAndRejectsOthers(t *testing.T) {
	repo := newTestTokenRepository(t)
	ctx := context.Background()

	if err := repo.PutToken(ctx, "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	allowed, err := repo.AuthorizeAccount(ctx, "test-token", "90011087")
	if err != nil {
		t.Fatalf("AuthorizeAccount returned error: %v", err)
	}
	if !allowed {
		t.Fatal("AuthorizeAccount returned false for first binding")
	}

	allowed, err = repo.AuthorizeAccount(ctx, "test-token", "90022000")
	if err != nil {
		t.Fatalf("AuthorizeAccount returned error: %v", err)
	}
	if allowed {
		t.Fatal("AuthorizeAccount returned true for different account")
	}

	accounts, err := repo.AccountsForToken(ctx, "test-token")
	if err != nil {
		t.Fatalf("AccountsForToken returned error: %v", err)
	}
	if len(accounts) != 1 || accounts[0] != "90011087" {
		t.Fatalf("AccountsForToken = %v, want [90011087]", accounts)
	}
}

func TestTokenRepositoryAuthorizeAccountRejectsMissingToken(t *testing.T) {
	repo := newTestTokenRepository(t)

	allowed, err := repo.AuthorizeAccount(context.Background(), "missing-token", "90011087")
	if err != nil {
		t.Fatalf("AuthorizeAccount returned error: %v", err)
	}
	if allowed {
		t.Fatal("AuthorizeAccount returned true for missing token")
	}
}

func TestTokenRepositoryAuthorizeAccountAllowsExistingBindingWithoutTokenWrite(t *testing.T) {
	repo := newTestTokenRepository(t)
	ctx := context.Background()

	if err := repo.PutToken(ctx, "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	if err := repo.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	installTokenUpdateCounter(t, repo)

	allowed, err := repo.AuthorizeAccount(ctx, "test-token", "90011087")
	if err != nil {
		t.Fatalf("AuthorizeAccount returned error: %v", err)
	}
	if !allowed {
		t.Fatal("AuthorizeAccount returned false for existing binding")
	}
	if got := tokenUpdateCount(t, repo); got != 0 {
		t.Fatalf("token update count = %d, want 0", got)
	}
}

func TestTokenRepositoryAuthorizeAccountRejectsDifferentBindingWithoutTokenWrite(t *testing.T) {
	repo := newTestTokenRepository(t)
	ctx := context.Background()

	if err := repo.PutToken(ctx, "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	if err := repo.BindAccount(ctx, "test-token", "90011087"); err != nil {
		t.Fatalf("BindAccount returned error: %v", err)
	}
	installTokenUpdateCounter(t, repo)

	allowed, err := repo.AuthorizeAccount(ctx, "test-token", "90022000")
	if err != nil {
		t.Fatalf("AuthorizeAccount returned error: %v", err)
	}
	if allowed {
		t.Fatal("AuthorizeAccount returned true for different account")
	}
	if got := tokenUpdateCount(t, repo); got != 0 {
		t.Fatalf("token update count = %d, want 0", got)
	}
}

func TestTokenRepositoryAuthorizeAccountBindsOnlyOneAccountUnderConcurrency(t *testing.T) {
	for i := 0; i < 25; i++ {
		repo := newTestTokenRepository(t)
		ctx := context.Background()

		if err := repo.PutToken(ctx, "test-token", "test", false, time.Now().UTC()); err != nil {
			t.Fatalf("PutToken returned error: %v", err)
		}

		start := make(chan struct{})
		type result struct {
			allowed bool
			err     error
		}
		results := make(chan result, 2)

		var wg sync.WaitGroup
		for _, accountID := range []string{"90011087", "90022000"} {
			wg.Add(1)
			go func(accountID string) {
				defer wg.Done()
				<-start
				allowed, err := repo.AuthorizeAccount(context.Background(), "test-token", accountID)
				results <- result{allowed: allowed, err: err}
			}(accountID)
		}

		close(start)
		wg.Wait()
		close(results)

		allowedCount := 0
		for result := range results {
			if result.err != nil {
				t.Fatalf("AuthorizeAccount returned error: %v", result.err)
			}
			if result.allowed {
				allowedCount++
			}
		}
		if allowedCount != 1 {
			t.Fatalf("allowed count = %d, want 1", allowedCount)
		}

		accounts, err := repo.AccountsForToken(ctx, "test-token")
		if err != nil {
			t.Fatalf("AccountsForToken returned error: %v", err)
		}
		if len(accounts) != 1 {
			t.Fatalf("AccountsForToken length = %d, want 1 (accounts=%v)", len(accounts), accounts)
		}
	}
}

func TestTokenRepositoryValidateRetriesBusyLock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "tokens.sqlite")

	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	lockDB, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite lockDB returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := lockDB.Close(); err != nil {
			t.Fatalf("Close lockDB returned error: %v", err)
		}
	})

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	repo := NewTokenRepository(db)
	if err := repo.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	if _, err := lockDB.Exec(`BEGIN EXCLUSIVE`); err != nil {
		t.Fatalf("BEGIN EXCLUSIVE returned error: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockDB.Exec(`ROLLBACK`)
	})

	releaseDone := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		_, _ = lockDB.Exec(`ROLLBACK`)
		close(releaseDone)
	}()

	valid, err := repo.Validate(context.Background(), "test-token")
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}
	if !valid {
		t.Fatal("Validate returned false, want true")
	}

	<-releaseDone
}

func TestTokenRepositoryAuthorizeAccountReturnsErrorWhenFirstBindStaysBusy(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "tokens.sqlite")

	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	lockDB, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite lockDB returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := lockDB.Close(); err != nil {
			t.Fatalf("Close lockDB returned error: %v", err)
		}
	})

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	repo := NewTokenRepository(db)
	if err := repo.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	if _, err := lockDB.Exec(`BEGIN IMMEDIATE`); err != nil {
		t.Fatalf("BEGIN IMMEDIATE returned error: %v", err)
	}
	defer func() {
		_, _ = lockDB.Exec(`ROLLBACK`)
	}()

	allowed, err := repo.AuthorizeAccount(context.Background(), "test-token", "90011087")
	if err == nil {
		t.Fatal("AuthorizeAccount returned nil error, want busy error")
	}
	if allowed {
		t.Fatal("AuthorizeAccount returned true, want false")
	}
}

func newTestTokenRepository(t *testing.T) *TokenRepository {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "tokens.sqlite")
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

	return NewTokenRepository(db)
}

func installTokenUpdateCounter(t *testing.T, repo *TokenRepository) {
	t.Helper()

	if _, err := repo.db.Exec(`
		CREATE TABLE token_update_events (
			count INTEGER NOT NULL
		);
		INSERT INTO token_update_events(count) VALUES (0);
		CREATE TRIGGER token_update_counter
		AFTER UPDATE ON tokens
		BEGIN
			UPDATE token_update_events SET count = count + 1;
		END;
	`); err != nil {
		t.Fatalf("install token update counter returned error: %v", err)
	}
}

func tokenUpdateCount(t *testing.T, repo *TokenRepository) int {
	t.Helper()

	var count int
	if err := repo.db.QueryRow(`SELECT count FROM token_update_events`).Scan(&count); err != nil {
		t.Fatalf("token update counter lookup returned error: %v", err)
	}

	return count
}
