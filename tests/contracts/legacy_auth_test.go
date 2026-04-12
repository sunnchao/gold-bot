package contracts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/legacy"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestLegacyRequiresValidToken(t *testing.T) {
	ts := newLegacyServer(t)
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", strings.NewReader(`{"account_id":"90011087"}`))
	rec := httptest.NewRecorder()

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func newLegacyServer(t *testing.T) http.Handler {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "contracts.sqlite")
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

	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	if err := tokens.PutToken(context.Background(), "test-token", "test", false, time.Now().UTC()); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	return legacy.NewRouter(legacy.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
	})
}
