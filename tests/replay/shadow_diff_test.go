package replay_test

import (
	"context"
	"testing"
	"time"

	"gold-bot/internal/scheduler"
)

type stubShadowStatsSource struct {
	stats scheduler.ShadowStats
}

func (s stubShadowStatsSource) LoadShadowStats(context.Context) (scheduler.ShadowStats, error) {
	return s.stats, nil
}

func TestCutoverHealthSummarizesDriftAndReadiness(t *testing.T) {
	service := scheduler.NewCutoverService(stubShadowStatsSource{
		stats: scheduler.ShadowStats{
			ReplayValidated:   true,
			ProtocolErrorRate: 0,
			SignalDriftRate:   0.031,
			CommandDriftRate:  0.01,
			LastSeenAt:        time.Date(2026, 4, 13, 8, 0, 0, 0, time.UTC),
		},
	})

	report, err := service.BuildReport(context.Background())
	if err != nil {
		t.Fatalf("BuildReport returned error: %v", err)
	}

	if report.Ready {
		t.Fatal("expected report.Ready to be false when signal drift exceeds threshold")
	}
	if report.SignalDriftRate != 0.031 {
		t.Fatalf("SignalDriftRate = %.3f, want %.3f", report.SignalDriftRate, 0.031)
	}
	if len(report.MissingCapabilities) != 0 {
		t.Fatalf("MissingCapabilities = %#v, want empty list when only threshold is red", report.MissingCapabilities)
	}
	if len(report.Checks) == 0 {
		t.Fatal("expected cutover checks to be populated")
	}
}
