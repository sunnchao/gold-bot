package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"gold-bot/internal/domain"
	"gold-bot/internal/ea"
)

type AccountStore interface {
	GetAccount(ctx context.Context, accountID string) (domain.Account, error)
	GetRuntime(ctx context.Context, accountID string) (domain.AccountRuntime, error)
	GetState(ctx context.Context, accountID string) (domain.AccountState, error)
	SaveAIResult(ctx context.Context, accountID string, payload json.RawMessage, updatedAt time.Time) error
}

type TokenStore interface {
	Validate(ctx context.Context, token string) (bool, error)
	IsAdmin(ctx context.Context, token string) (bool, error)
	AccountsForToken(ctx context.Context, token string) ([]string, error)
	PutToken(ctx context.Context, token, name string, isAdmin bool, createdAt time.Time) error
	BindAccount(ctx context.Context, token, accountID string) error
	List(ctx context.Context) ([]domain.TokenRecord, error)
	FindByPrefix(ctx context.Context, prefix string) (string, error)
	Delete(ctx context.Context, token string) error
}

type CommandStore interface {
	Enqueue(ctx context.Context, command domain.Command) error
}

type Dependencies struct {
	Accounts AccountStore
	Tokens   TokenStore
	Commands CommandStore
	Releases ea.ReleaseSource
}

func RegisterRoutes(mux *http.ServeMux, deps Dependencies) {
	auth := middleware{tokens: deps.Tokens}
	aiHandler := aiHandler{deps: deps, now: time.Now}
	tokenHandler := tokenHandler{tokens: deps.Tokens, now: time.Now}
	eaHandler := eaHandler{tokens: deps.Tokens, releases: deps.Releases}

	mux.Handle("/api/analysis_payload/", auth.requireToken(http.HandlerFunc(aiHandler.analysisPayload)))
	mux.Handle("/api/ai_result/", auth.requireToken(http.HandlerFunc(aiHandler.aiResult)))
	mux.Handle("/api/trigger_ai", auth.requireToken(http.HandlerFunc(aiHandler.triggerAI)))
	mux.Handle("/api/tokens", auth.requireAdmin(http.HandlerFunc(tokenHandler.handle)))
	mux.Handle("/api/tokens/", auth.requireAdmin(http.HandlerFunc(tokenHandler.delete)))
	mux.Handle("/api/ea/version", http.HandlerFunc(eaHandler.version))
	mux.Handle("/api/ea/download", auth.requireToken(http.HandlerFunc(eaHandler.download)))
}

type middleware struct {
	tokens TokenStore
}

func (m middleware) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		valid, err := m.tokens.Validate(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
			return
		}
		if !valid {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"status": "ERROR", "message": "invalid token"})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tokenContextKey{}, token)))
	})
}

func (m middleware) requireAdmin(next http.Handler) http.Handler {
	return m.requireToken(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := tokenFromContext(r.Context())
		isAdmin, err := m.tokens.IsAdmin(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"status": "ERROR", "message": err.Error()})
			return
		}
		if !isAdmin {
			writeJSON(w, http.StatusForbidden, map[string]any{"status": "ERROR", "message": "admin only"})
			return
		}
		next.ServeHTTP(w, r)
	}))
}

type tokenContextKey struct{}

func tokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(tokenContextKey{}).(string)
	return token
}

func extractToken(r *http.Request) string {
	if token := r.Header.Get("X-API-Token"); token != "" {
		return token
	}
	if token := r.Header.Get("X-API-Key"); token != "" {
		return token
	}
	return r.URL.Query().Get("token")
}

func accountIDFromPath(path, prefix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	value := strings.TrimPrefix(path, prefix)
	value = strings.Trim(value, "/")
	if value == "" {
		return "", false
	}
	return value, true
}

func authorizeAccount(ctx context.Context, tokens TokenStore, token, accountID string) (bool, error) {
	isAdmin, err := tokens.IsAdmin(ctx, token)
	if err != nil {
		return false, err
	}
	if isAdmin {
		return true, nil
	}

	accounts, err := tokens.AccountsForToken(ctx, token)
	if err != nil {
		return false, err
	}
	for _, allowed := range accounts {
		if allowed == accountID {
			return true, nil
		}
	}
	return false, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func generateToken() (string, error) {
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(secret), nil
}

func isNotFound(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
