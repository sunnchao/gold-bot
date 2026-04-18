package contracts

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAnalysisPayloadMarksTradeableFalseWhenLastTickStale(t *testing.T) {
	ts, db := newAdminServer(t)
	seedAnalysisFixture(t, ts, "user-token")

	staleTick := time.Now().UTC().Add(-11 * time.Minute).Format(time.RFC3339Nano)
	if _, err := db.Exec(`UPDATE account_runtime SET last_tick_at = ? WHERE account_id = ?`, staleTick, "90011087"); err != nil {
		t.Fatalf("UPDATE account_runtime last_tick_at returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/analysis_payload/90011087", nil)
	req.Header.Set("X-API-Token", "admin-token")

	ts.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/analysis_payload status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		MarketStatus map[string]any `json:"market_status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal analysis payload returned error: %v", err)
	}

	if got := body.MarketStatus["tradeable"]; got != false {
		t.Fatalf("market_status.tradeable = %v, want false", got)
	}
}