package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadMigrationLoadsInitSQL(t *testing.T) {
	content, err := readMigration("0001_init.sql")
	if err != nil {
		t.Fatalf("readMigration returned error: %v", err)
	}

	if !strings.Contains(string(content), "CREATE TABLE IF NOT EXISTS accounts") {
		t.Fatal("embedded migration content does not create accounts table")
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

	var tableName string
	err = db.QueryRow(`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table' AND name = 'accounts'
	`).Scan(&tableName)
	if err != nil {
		t.Fatalf("accounts table lookup failed: %v", err)
	}
	if tableName != "accounts" {
		t.Fatalf("table name = %q, want %q", tableName, "accounts")
	}
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

	var tableName string
	err = db.QueryRow(`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table' AND name = 'accounts'
	`).Scan(&tableName)
	if err != nil {
		t.Fatalf("accounts table lookup failed after rerun: %v", err)
	}
	if tableName != "accounts" {
		t.Fatalf("table name = %q, want %q", tableName, "accounts")
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
