package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadMigrationLoadsInitSQL(t *testing.T) {
	mfs := migrationSource()
	content, err := readMigrationFS(mfs, "0001_init.sql")
	if err != nil {
		t.Fatalf("readMigrationFS returned error: %v", err)
	}

	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS accounts") {
		t.Fatal("embedded migration content does not create accounts table")
	}
	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS account_runtime") {
		t.Fatal("embedded migration content does not create account_runtime table")
	}
	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS tokens") {
		t.Fatal("embedded migration content does not create tokens table")
	}
	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS token_accounts") {
		t.Fatal("embedded migration content does not create token_accounts table")
	}
	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS commands") {
		t.Fatal("embedded migration content does not create commands table")
	}
	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS command_results") {
		t.Fatal("embedded migration content does not create command_results table")
	}
}

func TestRunMigrationsCreatesAccountsTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.sqlite")

	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	assertTableExists(t, db, "accounts")
	assertTableExists(t, db, "account_runtime")
	assertTableExists(t, db, "tokens")
	assertTableExists(t, db, "token_accounts")
	assertTableExists(t, db, "commands")
	assertTableExists(t, db, "command_results")
}

func TestRunMigrationsIsIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.sqlite")

	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if err := RunMigrations(db); err != nil {
		t.Fatalf("first RunMigrations returned error: %v", err)
	}
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second RunMigrations returned error: %v", err)
	}

	var count int
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0001_init.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0002_legacy_auth_runtime.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0003_command_queue.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}

	assertTableExists(t, db, "accounts")
	assertTableExists(t, db, "account_runtime")
	assertTableExists(t, db, "tokens")
	assertTableExists(t, db, "token_accounts")
	assertTableExists(t, db, "commands")
	assertTableExists(t, db, "command_results")
}

func TestRunMigrationsUpgradesLegacy0001Database(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.sqlite")

	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
		  version TEXT PRIMARY KEY,
		  applied_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS accounts (
		  account_id TEXT PRIMARY KEY,
		  broker TEXT NOT NULL DEFAULT '',
		  server_name TEXT NOT NULL DEFAULT '',
		  account_name TEXT NOT NULL DEFAULT '',
		  account_type TEXT NOT NULL DEFAULT '',
		  currency TEXT NOT NULL DEFAULT 'USD',
		  leverage INTEGER NOT NULL DEFAULT 0,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL
		);

		INSERT INTO schema_migrations(version, applied_at)
		VALUES ('0001_init.sql', '2026-04-12T00:00:00Z');
	`); err != nil {
		t.Fatalf("seed legacy database returned error: %v", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	assertTableExists(t, db, "accounts")
	assertTableExists(t, db, "account_runtime")
	assertTableExists(t, db, "tokens")
	assertTableExists(t, db, "token_accounts")
	assertTableExists(t, db, "commands")
	assertTableExists(t, db, "command_results")

	var count int
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0002_legacy_auth_runtime.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0003_command_queue.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}
}

func TestRunMigrationsUpgradesLegacy0002Database(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.sqlite")

	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
		  version TEXT PRIMARY KEY,
		  applied_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS accounts (
		  account_id TEXT PRIMARY KEY,
		  broker TEXT NOT NULL DEFAULT '',
		  server_name TEXT NOT NULL DEFAULT '',
		  account_name TEXT NOT NULL DEFAULT '',
		  account_type TEXT NOT NULL DEFAULT '',
		  currency TEXT NOT NULL DEFAULT 'USD',
		  leverage INTEGER NOT NULL DEFAULT 0,
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS account_runtime (
		  account_id TEXT PRIMARY KEY,
		  connected INTEGER NOT NULL DEFAULT 0,
		  balance REAL NOT NULL DEFAULT 0,
		  equity REAL NOT NULL DEFAULT 0,
		  margin REAL NOT NULL DEFAULT 0,
		  free_margin REAL NOT NULL DEFAULT 0,
		  market_open INTEGER NOT NULL DEFAULT 1,
		  is_trade_allowed INTEGER NOT NULL DEFAULT 1,
		  mt4_server_time TEXT NOT NULL DEFAULT '',
		  last_heartbeat_at TEXT NOT NULL DEFAULT '',
		  last_tick_at TEXT NOT NULL DEFAULT '',
		  updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS tokens (
		  token TEXT PRIMARY KEY,
		  name TEXT NOT NULL DEFAULT '',
		  is_admin INTEGER NOT NULL DEFAULT 0,
		  created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS token_accounts (
		  token TEXT NOT NULL,
		  account_id TEXT NOT NULL,
		  PRIMARY KEY (token, account_id)
		);

		INSERT INTO schema_migrations(version, applied_at)
		VALUES
		  ('0001_init.sql', '2026-04-12T00:00:00Z'),
		  ('0002_legacy_auth_runtime.sql', '2026-04-12T00:01:00Z');
	`); err != nil {
		t.Fatalf("seed legacy database returned error: %v", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	assertTableExists(t, db, "commands")
	assertTableExists(t, db, "command_results")

	var count int
	err = db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, "0003_command_queue.sql").Scan(&count)
	if err != nil {
		t.Fatalf("schema_migrations lookup failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want %d", count, 1)
	}
}

func TestOpenSQLiteCreatesParentDir(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "tmp", "subdir", "app.sqlite")

	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})

	if _, err := os.Stat(filepath.Dir(dbPath)); err != nil {
		t.Fatalf("parent dir stat returned error: %v", err)
	}
}

func assertTableExists(t *testing.T, db *sql.DB, table string) {
	t.Helper()

	var tableName string
	err := db.QueryRow(`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table' AND name = ?
	`, table).Scan(&tableName)
	if err != nil {
		t.Fatalf("%s table lookup failed: %v", table, err)
	}
	if tableName != table {
		t.Fatalf("table name = %q, want %q", tableName, table)
	}
}
