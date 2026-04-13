package realtime_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/realtime"
)

func TestSSEStreamWritesEventEnvelope(t *testing.T) {
	hub := realtime.NewHub()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		hub.ServeHTTP(rec, req)
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)

	hub.Publish(domain.Event{
		EventID:   "evt_1",
		EventType: "heartbeat",
		AccountID: "90011087",
		Source:    "test",
		Timestamp: time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC),
		Payload:   []byte(`{"status":"OK"}`),
	})
	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("ServeHTTP did not exit after context cancellation")
	}

	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"event_type":"heartbeat"`) {
		t.Fatalf("body = %q, want event envelope", body)
	}
}
