package store

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"time"

	migrationfs "gold-bot/migrations"
)

// pgMigrationsFS is embedded PostgreSQL migrations.
//
//go:embed pg/*.sql
var pgMigrationsFS embed.FS

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

	mfs := migrationSource()
	files, err := migrationFiles(mfs)
	if err != nil {
		return err
	}

	for _, file := range files {
		if err := applyMigration(db, mfs, file); err != nil {
			return err
		}
	}

	return nil
}

func migrationSource() fs.FS {
	if isPostgres {
		return pgMigrationsFS
	}
	return migrationfs.Files
}

func applyMigration(db *sql.DB, mfs fs.FS, file string) error {
	ph := Ph1(1)

	var count int
	if err := db.QueryRow(fmt.Sprintf("SELECT COUNT(1) FROM schema_migrations WHERE version = %s", ph), file).Scan(&count); err != nil {
		return fmt.Errorf("check migration %s: %w", file, err)
	}
	if count > 0 {
		return nil
	}

	content, err := readMigrationFS(mfs, file)
	if err != nil {
		return err
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
		fmt.Sprintf("INSERT INTO schema_migrations(version, applied_at) VALUES(%s, %s)", Ph1(1), Ph1(2)),
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

func migrationFiles(mfs fs.FS) ([]string, error) {
	entries, err := fs.ReadDir(mfs, ".")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if path.Ext(entry.Name()) != ".sql" {
			continue
		}
		files = append(files, entry.Name())
	}

	sort.Strings(files)
	return files, nil
}

func readMigrationFS(mfs fs.FS, file string) ([]byte, error) {
	content, err := fs.ReadFile(mfs, file)
	if err != nil {
		return nil, fmt.Errorf("read migration %s: %w", file, err)
	}
	return content, nil
}
