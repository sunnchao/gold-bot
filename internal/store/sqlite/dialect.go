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
)

func isPg() bool {
	detectOnce.Do(func() {
		detectedPg = strings.HasPrefix(os.Getenv("DSN"), "postgres://") ||
			strings.HasPrefix(os.Getenv("DSN"), "postgresql://")
	})
	return detectedPg
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
	parts := make([]string, n)
	for i := range parts {
		parts[i] = ph(i + 1)
	}
	return strings.Join(parts, ", ")
}

// Dialect returns "postgres" or "sqlite" based on DSN env var.
func Dialect() string {
	if isPg() {
		return "postgres"
	}
	return "sqlite"
}
