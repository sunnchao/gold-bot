package legacy

import (
	"context"
	"net/http"
)

type tokenKey struct{}

type AuthMiddleware struct {
	tokens TokenStore
}

func NewAuthMiddleware(tokens TokenStore) *AuthMiddleware {
	return &AuthMiddleware{tokens: tokens}
}

func (m *AuthMiddleware) RequireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" || !m.tokens.Validate(r.Context(), token) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"status":  "ERROR",
				"message": "invalid token",
			})
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tokenKey{}, token)))
	})
}

func extractToken(r *http.Request) string {
	token := r.Header.Get("X-API-Token")
	if token == "" {
		token = r.Header.Get("X-API-Key")
	}
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	return token
}

func tokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(tokenKey{}).(string)
	return token
}
