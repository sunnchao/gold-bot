package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"
)

const schemaMigrationsDDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`

func RunMigrations(db *sql.DB) error {
	if _, err := db.Exec(schemaMigrationsDDL); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	files, err := migrationFiles()
	if err != nil {
		return err
	}

	for _, file := range files {
		if err := applyMigration(db, file); err != nil {
			return err
		}
	}

	return nil
}

func applyMigration(db *sql.DB, file string) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(1) FROM schema_migrations WHERE version = ?", file).Scan(&count); err != nil {
		return fmt.Errorf("check migration %s: %w", file, err)
	}
	if count > 0 {
		return nil
	}

	content, err := os.ReadFile(filepath.Join(migrationsDir(), file))
	if err != nil {
		return fmt.Errorf("read migration %s: %w", file, err)
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", file, err)
	}

	if _, err := tx.Exec(string(content)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("run migration %s: %w", file, err)
	}

	if _, err := tx.Exec(
		"INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
		file,
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record migration %s: %w", file, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", file, err)
	}

	return nil
}

func migrationFiles() ([]string, error) {
	entries, err := os.ReadDir(migrationsDir())
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		files = append(files, entry.Name())
	}

	sort.Strings(files)
	return files, nil
}

func migrationsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
