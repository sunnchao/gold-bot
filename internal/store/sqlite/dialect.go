package sqlite

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

var (
	detectOnce sync.Once
	detectedPg bool
	forcedPg   *bool
)

func detectPg(dsn string) bool {
	return strings.HasPrefix(dsn, "postgres://") ||
		strings.HasPrefix(dsn, "postgresql://")
}

func isPg() bool {
	if forcedPg != nil {
		return *forcedPg
	}

	detectOnce.Do(func() {
		detectedPg = detectPg(os.Getenv("DSN"))
	})
	return detectedPg
}

func setPgForTest(v bool) {
	forcedPg = &v
}

func resetDialectForTest() {
	forcedPg = nil
	detectedPg = false
	detectOnce = sync.Once{}
}

// ph returns the Nth placeholder (1-indexed).
// PostgreSQL: $1, $2, $3...   SQLite: ?, ?, ?...
func ph(n int) string {
	if isPg() {
		return fmt.Sprintf("$%d", n)
	}
	return "?"
}

// phs returns N placeholders joined by ", ".
// Use this when you need a list like "?, ?, ?" for IN clauses.
func phs(n int) string {
	return phsFrom(1, n)
}

func phsFrom(start, n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = ph(start + i)
	}
	return strings.Join(parts, ", ")
}

// pgText returns a PostgreSQL-compatible text cast suffix.
// For SQLite it returns an empty string; for PostgreSQL it returns "::text".
// Use this when a WHERE clause compares a TEXT column against a string parameter
// to avoid PostgreSQL's "could not determine data type of parameter" error.
func pgText() string {
	if isPg() {
		return "::text"
	}
	return ""
}

// Dialect returns "postgres" or "sqlite" based on DSN env var.
func Dialect() string {
	if isPg() {
		return "postgres"
	}
	return "sqlite"
}
