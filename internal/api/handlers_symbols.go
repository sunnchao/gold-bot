package api

import (
	"encoding/json"
	"net/http"
	"time"
)

type symbolHandler struct {
	deps Dependencies
	now  func() time.Time
}

func (h *symbolHandler) listSymbols(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	accountID, ok := accountIDFromPath(r.URL.Path, "/api/symbols/")
	if !ok {
		http.Error(w, "invalid account_id", http.StatusBadRequest)
		return
	}

	symbols, err := h.deps.Accounts.ListSymbols(r.Context(), accountID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(symbols)
}
