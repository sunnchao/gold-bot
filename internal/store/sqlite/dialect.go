package sqlite

import (
	"fmt"
	"strings"
)

// ph returns the Nth PostgreSQL placeholder (1-indexed).
func ph(n int) string {
	return fmt.Sprintf("$%d", n)
}

// phs returns N placeholders joined by ", ".
// Use this when you need a list like "$1, $2, $3" for IN clauses.
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

func pgText() string {
	return ""
}

func jsonExtract(field, jsonPath string) string {
	return field + "::jsonb->>'" + jsonPath + "'"
}

func Dialect() string {
	return "postgres"
}
