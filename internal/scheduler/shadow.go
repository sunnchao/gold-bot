package scheduler

import (
	"context"
	"fmt"
	"time"
)

type ShadowStats struct {
	ReplayValidated   bool
	ProtocolErrorRate float64
	SignalDriftRate   float64
	CommandDriftRate  float64
	LastSeenAt        time.Time
}

type ShadowStatsSource interface {
	LoadShadowStats(ctx context.Context) (ShadowStats, error)
}

type StaticShadowStatsSource struct {
	Stats ShadowStats
}

func (s StaticShadowStatsSource) LoadShadowStats(context.Context) (ShadowStats, error) {
	return s.Stats, nil
}

type CutoverCheck struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Detail string `json:"detail"`
	Tone   string `json:"tone"`
}

type CutoverReport struct {
	Ready               bool           `json:"ready"`
	ProtocolErrorRate   float64        `json:"protocol_error_rate"`
	SignalDriftRate     float64        `json:"signal_drift_rate"`
	CommandDriftRate    float64        `json:"command_drift_rate"`
	LastShadowEventAt   time.Time      `json:"last_shadow_event_at"`
	MissingCapabilities []string       `json:"missing_capabilities"`
	Checks              []CutoverCheck `json:"checks"`
}

type CutoverService struct {
	source ShadowStatsSource
}

func NewCutoverService(source ShadowStatsSource) CutoverService {
	if source == nil {
		source = StaticShadowStatsSource{}
	}
	return CutoverService{source: source}
}

func (s CutoverService) BuildReport(ctx context.Context) (CutoverReport, error) {
	stats, err := s.source.LoadShadowStats(ctx)
	if err != nil {
		return CutoverReport{}, fmt.Errorf("load shadow stats: %w", err)
	}

	missing := make([]string, 0, 2)
	if !stats.ReplayValidated {
		missing = append(missing, "replay_validation")
	}
	if stats.LastSeenAt.IsZero() {
		missing = append(missing, "shadow_traffic")
	}

	report := CutoverReport{
		Ready:               stats.ReplayValidated && !stats.LastSeenAt.IsZero() && stats.ProtocolErrorRate == 0 && stats.SignalDriftRate <= 0.02 && stats.CommandDriftRate <= 0.02,
		ProtocolErrorRate:   stats.ProtocolErrorRate,
		SignalDriftRate:     stats.SignalDriftRate,
		CommandDriftRate:    stats.CommandDriftRate,
		LastShadowEventAt:   stats.LastSeenAt.UTC(),
		MissingCapabilities: missing,
	}

	report.Checks = []CutoverCheck{
		buildReplayCheck(stats),
		buildDriftCheck(stats),
		buildProtocolCheck(stats),
	}
	return report, nil
}

func buildReplayCheck(stats ShadowStats) CutoverCheck {
	if stats.ReplayValidated {
		return CutoverCheck{
			Label:  "Replay Parity",
			Value:  "validated",
			Detail: "Replay fixture matched Python baseline",
			Tone:   "green",
		}
	}
	return CutoverCheck{
		Label:  "Replay Parity",
		Value:  "pending",
		Detail: "Replay fixture has not been approved yet",
		Tone:   "orange",
	}
}

func buildDriftCheck(stats ShadowStats) CutoverCheck {
	if stats.LastSeenAt.IsZero() {
		return CutoverCheck{
			Label:  "Shadow Drift",
			Value:  "pending",
			Detail: "Waiting for mirrored production traffic",
			Tone:   "orange",
		}
	}
	if stats.SignalDriftRate <= 0.02 && stats.CommandDriftRate <= 0.02 {
		return CutoverCheck{
			Label:  "Shadow Drift",
			Value:  "within threshold",
			Detail: fmt.Sprintf("Signal %s, command %s", formatRate(stats.SignalDriftRate), formatRate(stats.CommandDriftRate)),
			Tone:   "green",
		}
	}
	return CutoverCheck{
		Label:  "Shadow Drift",
		Value:  "review required",
		Detail: fmt.Sprintf("Signal %s, command %s (limit 2.00%%)", formatRate(stats.SignalDriftRate), formatRate(stats.CommandDriftRate)),
		Tone:   "red",
	}
}

func buildProtocolCheck(stats ShadowStats) CutoverCheck {
	tone := "green"
	detail := "No contract mismatches observed in replay mode"
	if stats.LastSeenAt.IsZero() {
		tone = "amber"
		detail = "Live shadow traffic has not started yet"
	} else if stats.ProtocolErrorRate > 0 {
		tone = "red"
		detail = "Legacy contract mismatches detected in mirrored traffic"
	}
	return CutoverCheck{
		Label:  "Protocol Errors",
		Value:  formatRate(stats.ProtocolErrorRate),
		Detail: detail,
		Tone:   tone,
	}
}

func formatRate(rate float64) string {
	return fmt.Sprintf("%.2f%%", rate*100)
}
