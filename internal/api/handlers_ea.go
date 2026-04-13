package api

import (
	"net/http"
	"os"

	"gold-bot/internal/ea"
)

type eaHandler struct {
	tokens   TokenStore
	releases ea.ReleaseSource
}

func (h eaHandler) version(w http.ResponseWriter, _ *http.Request) {
	info, err := h.releases.Current()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "OK",
		"version":   info.Version,
		"build":     info.Build,
		"changelog": info.Changelog,
	})
}

func (h eaHandler) download(w http.ResponseWriter, r *http.Request) {
	info, err := h.releases.Current()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if _, err := os.Stat(info.FilePath); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"status": "ERROR", "message": "file not found"})
		return
	}

	w.Header().Set("Content-Disposition", `attachment; filename="GoldBolt_Client.mq4"`)
	http.ServeFile(w, r, info.FilePath)
}
