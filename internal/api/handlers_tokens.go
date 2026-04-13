package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type tokenHandler struct {
	tokens TokenStore
	now    func() time.Time
}

func (h tokenHandler) handle(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.list(w, r)
	case http.MethodPost:
		h.create(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h tokenHandler) list(w http.ResponseWriter, r *http.Request) {
	records, err := h.tokens.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}

	response := make(map[string]any, len(records))
	for _, record := range records {
		if record.IsAdmin {
			continue
		}
		response[maskToken(record.Token)] = map[string]any{
			"accounts":   record.Accounts,
			"name":       record.Name,
			"full_token": record.Token,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "tokens": response})
}

func (h tokenHandler) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string   `json:"name"`
		Accounts []string `json:"accounts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"status": "ERROR", "message": "invalid JSON"})
		return
	}

	token, err := generateToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	now := h.now().UTC()
	if err := h.tokens.PutToken(r.Context(), token, req.Name, false, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	for _, accountID := range req.Accounts {
		if err := h.tokens.BindAccount(r.Context(), token, accountID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "token": token, "name": req.Name, "accounts": req.Accounts})
}

func (h tokenHandler) delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	prefix := strings.TrimPrefix(r.URL.Path, "/api/tokens/")
	if prefix == "" {
		http.NotFound(w, r)
		return
	}

	token, err := h.tokens.FindByPrefix(r.Context(), prefix)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]any{"status": "ERROR", "message": "token not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	if err := h.tokens.Delete(r.Context(), token); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "OK", "revoked": maskToken(token)})
}

func maskToken(token string) string {
	if len(token) <= 8 {
		return token
	}
	return token[:4] + "..." + token[len(token)-4:]
}
