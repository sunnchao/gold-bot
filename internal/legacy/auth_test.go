package legacy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequireTokenReturnsServerErrorOnTokenStoreFailure(t *testing.T) {
	auth := NewAuthMiddleware(validateErrorTokenStore{})

	req := httptest.NewRequest(http.MethodPost, "/heartbeat", nil)
	req.Header.Set("X-API-Token", "test-token")
	rec := httptest.NewRecorder()

	auth.RequireToken(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("RequireToken status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

type validateErrorTokenStore struct{}

func (validateErrorTokenStore) Validate(context.Context, string) (bool, error) {
	return false, errors.New("database is locked")
}

func (validateErrorTokenStore) AuthorizeAccount(context.Context, string, string) (bool, error) {
	return false, nil
}

func (validateErrorTokenStore) BindAccount(context.Context, string, string) error {
	return nil
}
