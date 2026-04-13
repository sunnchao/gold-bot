package api

import (
	"net/http"
	"time"

	"gold-bot/internal/scheduler"
)

type cutoverHandler struct {
	deps Dependencies
	now  func() time.Time
}

func (h cutoverHandler) audit(w http.ResponseWriter, r *http.Request) {
	report := scheduler.CutoverReport{
		MissingCapabilities: []string{"shadow_traffic"},
		Checks: []scheduler.CutoverCheck{
			{Label: "Replay Parity", Value: "pending", Detail: "Replay fixture has not been approved yet", Tone: "orange"},
			{Label: "Shadow Drift", Value: "pending", Detail: "Waiting for mirrored production traffic", Tone: "orange"},
			{Label: "Protocol Errors", Value: "0.00%", Detail: "Live shadow traffic has not started yet", Tone: "amber"},
		},
	}
	if h.deps.Cutover != nil {
		var err error
		report, err = h.deps.Cutover.BuildReport(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "OK",
		"generated_at": h.now().UTC().Format(time.RFC3339),
		"report":       report,
		"summary":      report.Checks,
		"events":       []any{},
	})
}
