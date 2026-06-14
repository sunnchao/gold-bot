package scheduler

import (
	"context"
	"errors"
	"testing"
	"time"

	"gold-bot/internal/domain"
)

func TestWaitForArbitrationPollsBySignalID(t *testing.T) {
	store := &stubPendingSignalStore{
		signalByID: map[int64]*domain.PendingSignal{
			42: {
				ID:                42,
				Status:            "approved",
				ArbitrationReason: "mao ok",
			},
		},
	}
	manager := NewArbitrationManager(store, ArbitrationConfig{
		MaxWaitTime:          100 * time.Millisecond,
		TimeoutAutoPassScore: 8,
		PollInterval:         10 * time.Millisecond,
	})

	result := manager.waitForArbitration(context.Background(), 42, 9)

	if result.Status != "approved" {
		t.Fatalf("result.Status = %q, want %q", result.Status, "approved")
	}
	if result.Reason != "mao ok" {
		t.Fatalf("result.Reason = %q, want %q", result.Reason, "mao ok")
	}
	if store.getByIDCalls == 0 {
		t.Fatal("GetPendingSignalByID was not called")
	}
	if store.getPendingSignalsCalls != 0 {
		t.Fatalf("GetPendingSignals calls = %d, want 0", store.getPendingSignalsCalls)
	}
}

type stubPendingSignalStore struct {
	signalByID             map[int64]*domain.PendingSignal
	getByIDCalls           int
	getPendingSignalsCalls int
}

func (s *stubPendingSignalStore) SavePendingSignal(context.Context, *domain.PendingSignal) error {
	return nil
}

func (s *stubPendingSignalStore) GetPendingSignalByID(_ context.Context, id int64) (*domain.PendingSignal, error) {
	s.getByIDCalls++
	signal, ok := s.signalByID[id]
	if !ok {
		return nil, errors.New("not found")
	}
	return signal, nil
}

func (s *stubPendingSignalStore) GetPendingSignals(context.Context, string, string) ([]domain.PendingSignal, error) {
	s.getPendingSignalsCalls++
	return nil, nil
}

func (s *stubPendingSignalStore) UpdateArbitration(context.Context, int64, string, string) error {
	return nil
}

func (s *stubPendingSignalStore) ExpireStaleSignals(context.Context) (int64, error) {
	return 0, nil
}
