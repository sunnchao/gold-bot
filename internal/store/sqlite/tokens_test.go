package sqlite

import (
	"context"
	"path/filepath"
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
	if !repo.Validate(ctx, "test-token") {
		t.Fatal("Validate returned false, want true")
	}
	if repo.Validate(ctx, "missing-token") {
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
