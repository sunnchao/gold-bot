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
	"gold-bot/internal/store"
	sqlitestore "gold-bot/internal/store/sqlite"
)

func TestOverviewReturnsCutoverCard(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "api-overview.sqlite")
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
		AccountID:   "90011087",
		Broker:      "Demo Broker",
		ServerName:  "Demo-1",
		AccountName: "Primary",
		Currency:    "USD",
		Leverage:    500,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(context.Background(), domain.AccountRuntime{
		AccountID:       "90011087",
		Connected:       true,
		Balance:         1000.5,
		Equity:          1100.25,
		Margin:          100,
		FreeMargin:      1000.25,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		MT4ServerTime:   "2026.04.13 08:00",
		LastHeartbeatAt: now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(context.Background(), "90011087", "XAUUSD", domain.TickSnapshot{
		Symbol: "XAUUSD",
		Bid:    3335.55,
		Ask:    3335.75,
		Spread: 0.2,
		Time:   "08:00:00",
	}, now); err != nil {
		t.Fatalf("SaveTickSnapshot returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts: accounts,
		Tokens:   tokens,
		Commands: commands,
		Releases: ea.NewLocalReleaseSource("."),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
	req.Header.Set("X-API-Token", "admin-token")

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/overview status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status string `json:"status"`
		Cards  []struct {
			Title string `json:"title"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal overview returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want OK", body.Status)
	}

	found := false
	for _, card := range body.Cards {
		if card.Title == "Cutover Health" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("cards = %+v, want Cutover Health card", body.Cards)
	}
}

func TestAccountDecisionsReturnsNewestFirst(t *testing.T) {
	fixture := newAccountAPIFixture(t)
	ctx := context.Background()

	seedDecisionEvents(t, fixture.decisions, []domain.DecisionEvent{
		{
			DecisionID:  "tpv1_xau_old",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageAIResult,
			Status:      domain.DecisionStatusAccepted,
			ReasonCodes: []string{"mode.close"},
			Summary:     map[string]any{"mode": "close"},
			CreatedAt:   fixture.now.Add(-2 * time.Minute),
		},
		{
			DecisionID:  "tpv1_xau_rejected",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageRiskGate,
			Status:      domain.DecisionStatusRejected,
			ReasonCodes: []string{"risk.spread.wide"},
			Summary:     map[string]any{"max_lots": 0},
			CreatedAt:   fixture.now.Add(-1 * time.Minute),
		},
		{
			DecisionID: "tpv1_gbp_newest",
			AccountID:  "90011087",
			Symbol:     "GBPJPY",
			Stage:      domain.DecisionStageAIResult,
			Status:     domain.DecisionStatusAccepted,
			CreatedAt:  fixture.now,
		},
		{
			DecisionID: "tpv1_other_account",
			AccountID:  "90011088",
			Symbol:     "XAUUSD",
			Stage:      domain.DecisionStageAIResult,
			Status:     domain.DecisionStatusAccepted,
			CreatedAt:  fixture.now.Add(time.Minute),
		},
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/accounts/90011087/decisions", nil).WithContext(ctx)
	req.Header.Set("X-API-Token", "admin-token")

	fixture.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/accounts/90011087/decisions status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Status         string                 `json:"status"`
		DecisionEvents []domain.DecisionEvent `json:"decision_events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal decisions returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want OK", body.Status)
	}
	if len(body.DecisionEvents) != 3 {
		t.Fatalf("len(decision_events) = %d, want 3: %+v", len(body.DecisionEvents), body.DecisionEvents)
	}
	wantOrder := []string{"tpv1_gbp_newest", "tpv1_xau_rejected", "tpv1_xau_old"}
	for i, want := range wantOrder {
		if body.DecisionEvents[i].DecisionID != want {
			t.Fatalf("decision_events[%d].decision_id = %q, want %q", i, body.DecisionEvents[i].DecisionID, want)
		}
	}
}

func TestAccountDecisionsHonorsSymbolLimitAndStatusQuery(t *testing.T) {
	fixture := newAccountAPIFixture(t)

	seedDecisionEvents(t, fixture.decisions, []domain.DecisionEvent{
		{
			DecisionID: "tpv1_xau_old",
			AccountID:  "90011087",
			Symbol:     "XAUUSD",
			Stage:      domain.DecisionStageAIResult,
			Status:     domain.DecisionStatusAccepted,
			CreatedAt:  fixture.now.Add(-2 * time.Minute),
		},
		{
			DecisionID: "tpv1_xau_rejected",
			AccountID:  "90011087",
			Symbol:     "XAUUSD",
			Stage:      domain.DecisionStageRiskGate,
			Status:     domain.DecisionStatusRejected,
			CreatedAt:  fixture.now.Add(-time.Minute),
		},
		{
			DecisionID: "tpv1_gbp_newest",
			AccountID:  "90011087",
			Symbol:     "GBPJPY",
			Stage:      domain.DecisionStageAIResult,
			Status:     domain.DecisionStatusAccepted,
			CreatedAt:  fixture.now,
		},
	})

	cases := []struct {
		name       string
		path       string
		wantIDs    []string
		wantSymbol string
		wantStatus domain.DecisionStatus
	}{
		{
			name:       "symbol filters to XAUUSD",
			path:       "/api/v1/accounts/90011087/decisions?symbol=XAUUSD",
			wantIDs:    []string{"tpv1_xau_rejected", "tpv1_xau_old"},
			wantSymbol: "XAUUSD",
		},
		{
			name:    "limit caps newest results",
			path:    "/api/v1/accounts/90011087/decisions?limit=1",
			wantIDs: []string{"tpv1_gbp_newest"},
		},
		{
			name:       "status filters decisions",
			path:       "/api/v1/accounts/90011087/decisions?status=rejected",
			wantIDs:    []string{"tpv1_xau_rejected"},
			wantStatus: domain.DecisionStatusRejected,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("X-API-Token", "admin-token")

			fixture.mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("GET %s status = %d, want %d: %s", tc.path, rec.Code, http.StatusOK, rec.Body.String())
			}

			var body struct {
				DecisionEvents []domain.DecisionEvent `json:"decision_events"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("Unmarshal decisions returned error: %v", err)
			}
			if len(body.DecisionEvents) != len(tc.wantIDs) {
				t.Fatalf("len(decision_events) = %d, want %d: %+v", len(body.DecisionEvents), len(tc.wantIDs), body.DecisionEvents)
			}
			for i, wantID := range tc.wantIDs {
				got := body.DecisionEvents[i]
				if got.DecisionID != wantID {
					t.Fatalf("decision_events[%d].decision_id = %q, want %q", i, got.DecisionID, wantID)
				}
				if tc.wantSymbol != "" && got.Symbol != tc.wantSymbol {
					t.Fatalf("decision_events[%d].symbol = %q, want %q", i, got.Symbol, tc.wantSymbol)
				}
				if tc.wantStatus != "" && got.Status != tc.wantStatus {
					t.Fatalf("decision_events[%d].status = %q, want %q", i, got.Status, tc.wantStatus)
				}
			}
		})
	}
}

func TestAccountDetailIncludesRecentDecisionEvents(t *testing.T) {
	fixture := newAccountAPIFixture(t)
	seedAccountDetailState(t, fixture.accounts, fixture.now)
	seedDecisionEvents(t, fixture.decisions, []domain.DecisionEvent{
		{
			DecisionID:  "tpv1_old",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageAIResult,
			Status:      domain.DecisionStatusAccepted,
			ReasonCodes: []string{"mode.close"},
			Summary:     map[string]any{"mode": "close", "confidence": 0.72},
			CreatedAt:   fixture.now.Add(-time.Minute),
		},
		{
			DecisionID:  "tpv1_new",
			AccountID:   "90011087",
			Symbol:      "XAUUSD",
			Stage:       domain.DecisionStageRiskGate,
			Status:      domain.DecisionStatusClamped,
			ReasonCodes: []string{"risk.lot.clamped"},
			Summary:     map[string]any{"mode": "reduce", "max_lots": 0.2},
			CreatedAt:   fixture.now,
		},
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/accounts/90011087", nil)
	req.Header.Set("X-API-Token", "admin-token")

	fixture.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/accounts/90011087 status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Status         string                 `json:"status"`
		Account        map[string]any         `json:"account"`
		AIResult       map[string]any         `json:"ai_result"`
		DecisionEvents []domain.DecisionEvent `json:"decision_events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal account detail returned error: %v", err)
	}

	if body.Status != "OK" {
		t.Fatalf("status = %q, want OK", body.Status)
	}
	if body.Account["account_id"] != "90011087" {
		t.Fatalf("account.account_id = %#v, want 90011087", body.Account["account_id"])
	}
	if body.AIResult == nil {
		t.Fatal("ai_result is nil, want existing detail field preserved")
	}
	if len(body.DecisionEvents) != 2 {
		t.Fatalf("len(decision_events) = %d, want 2: %+v", len(body.DecisionEvents), body.DecisionEvents)
	}
	if body.DecisionEvents[0].DecisionID != "tpv1_new" {
		t.Fatalf("newest decision_id = %q, want tpv1_new", body.DecisionEvents[0].DecisionID)
	}
	if body.DecisionEvents[0].Summary["mode"] != "reduce" {
		t.Fatalf("newest summary.mode = %#v, want reduce", body.DecisionEvents[0].Summary["mode"])
	}
}

type accountAPIFixture struct {
	mux       *http.ServeMux
	accounts  *sqlitestore.AccountRepository
	decisions *sqlitestore.DecisionRepository
	now       time.Time
}

func newAccountAPIFixture(t *testing.T) accountAPIFixture {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "api-accounts.sqlite")
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
	decisions := sqlitestore.NewDecisionRepository(db)
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)

	if err := tokens.PutToken(context.Background(), "admin-token", "admin", true, now); err != nil {
		t.Fatalf("PutToken returned error: %v", err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.Dependencies{
		Accounts:  accounts,
		Tokens:    tokens,
		Commands:  commands,
		Decisions: decisions,
		Releases:  ea.NewLocalReleaseSource("."),
	})

	return accountAPIFixture{
		mux:       mux,
		accounts:  accounts,
		decisions: decisions,
		now:       now,
	}
}

func seedDecisionEvents(t *testing.T, decisions *sqlitestore.DecisionRepository, events []domain.DecisionEvent) {
	t.Helper()

	for _, event := range events {
		if err := decisions.Record(context.Background(), event); err != nil {
			t.Fatalf("Record(%s) returned error: %v", event.DecisionID, err)
		}
	}
}

func seedAccountDetailState(t *testing.T, accounts *sqlitestore.AccountRepository, now time.Time) {
	t.Helper()

	if err := accounts.UpsertAccount(context.Background(), domain.Account{
		AccountID:   "90011087",
		Broker:      "Demo Broker",
		ServerName:  "Demo-1",
		AccountName: "Primary",
		Currency:    "USD",
		Leverage:    500,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertAccount returned error: %v", err)
	}
	if err := accounts.SaveHeartbeat(context.Background(), domain.AccountRuntime{
		AccountID:       "90011087",
		Connected:       true,
		Balance:         1000.5,
		Equity:          1100.25,
		Margin:          100,
		FreeMargin:      1000.25,
		MarketOpen:      true,
		IsTradeAllowed:  true,
		MT4ServerTime:   "2026.06.06 12:00",
		LastHeartbeatAt: now,
		LastTickAt:      now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("SaveHeartbeat returned error: %v", err)
	}
	if err := accounts.SaveTickSnapshot(context.Background(), "90011087", "XAUUSD", domain.TickSnapshot{
		Symbol: "XAUUSD",
		Bid:    3335.55,
		Ask:    3335.75,
		Spread: 0.2,
		Time:   "12:00:00",
	}, now); err != nil {
		t.Fatalf("SaveTickSnapshot returned error: %v", err)
	}
}
