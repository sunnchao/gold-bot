package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gold-bot/internal/domain"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

var (
	isPostgres bool
	pgOnce     sync.Once
)

// IsPostgres reports whether the active driver is PostgreSQL.
func IsPostgres() bool {
	return isPostgres
}

// SetPostgres marks the driver as PostgreSQL. Called by OpenDB.
func SetPostgres() {
	pgOnce.Do(func() { isPostgres = true })
}

// Ph returns the placeholder(s) for n arguments.
// SQLite: ?,?,?   PostgreSQL: $1,$2,$3
func Ph(n int) string {
	if isPostgres {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = fmt.Sprintf("$%d", i+1)
		}
		return strings.Join(parts, ", ")
	}
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ", ")
}

// Ph1 returns a single placeholder at position n (PostgreSQL) or ? (SQLite).
func Ph1(n int) string {
	if isPostgres {
		return fmt.Sprintf("$%d", n)
	}
	return "?"
}

func OpenDB(cfg struct{ DBPath, DSN string }) (*sql.DB, error) {
	if cfg.DSN != "" {
		return openPostgres(cfg.DSN)
	}
	return OpenSQLite(cfg.DBPath)
}

// OpenSQLite opens a SQLite database (kept for backward compatibility in tests).
func OpenSQLite(path string) (*sql.DB, error) {
	if err := ensureParentDir(path); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return db, nil
}

func openPostgres(dsn string) (*sql.DB, error) {
	pgOnce.Do(func() { isPostgres = true })

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return db, nil
}

func ensureParentDir(path string) error {
	if strings.HasPrefix(path, "file:") || path == ":memory:" {
		return nil
	}

	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}

	return os.MkdirAll(dir, 0o755)
}

// PositionStateStore defines the interface for persisting position states.
type PositionStateStore interface {
	SavePositionState(ctx context.Context, accountID, symbol string, state domain.PositionState) error
	LoadPositionStates(ctx context.Context, accountID, symbol string) (map[int64]domain.PositionState, error)
}

// PendingSignalStore defines the interface for arbitration signal management.
type PendingSignalStore interface {
	SavePendingSignal(ctx context.Context, signal *domain.PendingSignal) error
	GetPendingSignals(ctx context.Context, accountID, symbol string) ([]domain.PendingSignal, error)
	UpdateArbitration(ctx context.Context, id int64, result, reason string) error
	ExpireStaleSignals(ctx context.Context) (int64, error)
}
