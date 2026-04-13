package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDashboardHandlerServesDynamicAccountFallback(t *testing.T) {
	dist := t.TempDir()
	accountDir := filepath.Join(dist, "accounts", "__dynamic__")
	if err := os.MkdirAll(accountDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(accountDir, "index.html"), []byte("account detail shell"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	handler := newDashboardHandler(dist)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/accounts/90011087", nil)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /accounts/90011087 status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), "account detail shell") {
		t.Fatalf("body = %q, want dynamic fallback content", rec.Body.String())
	}
}
