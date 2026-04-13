package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"gold-bot/internal/api"
	"gold-bot/internal/domain"
	"gold-bot/internal/ea"
	"gold-bot/internal/scheduler"
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestAuditReturnsCutoverReport(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "api-audit.sqlite")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("OpenSQLite returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := store.RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations returned error: %v", err)
	}

	accounts := sqlitestore.NewAccountRepository(db)
	tokens := sqlitestore.NewTokenRepository(db)
	commands := sqlitestore.NewCommandRepository(db)
	now := time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC)

	if err := tokens.PutToken(context.Background(), "admin-token", "admin", true, now); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}
	if err := accounts.UpsertAccount(context.Background(), domain.Account{
		AccountID:  "90011087",
		Broker:     "Demo Broker",
		ServerName: "Demo-1",
		CreatedAt:  now,
		UpdatedAt:  now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
		Cutover: scheduler.NewCutoverService(scheduler.StaticShadowStatsSource{
			Stats: scheduler.ShadowStats{
				ReplayValidated: true,
			},
		}),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	req.Header.Set("X-API-Token", "admin-token")

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/audit status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status string `json:"status"`
		Report struct {
			Ready               bool     `json:"ready"`
			MissingCapabilities []string `json:"missing_capabilities"`
		} `json:"report"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal audit returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want OK", body.Status)
	}
	if body.Report.Ready {
		t.Fatal("expected report.Ready to be false without shadow traffic")
	}
	if len(body.Report.MissingCapabilities) == 0 {
		t.Fatal("expected report.MissingCapabilities to include pending prerequisites")
	}
}
