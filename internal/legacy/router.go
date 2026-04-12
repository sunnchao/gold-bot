package legacy

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"gold-bot/internal/domain"
)

type AccountStore interface {
	UpsertAccount(ctx context.Context, account domain.Account) error
	EnsureAccount(ctx context.Context, accountID string, updatedAt time.Time) error
	SaveHeartbeat(ctx context.Context, runtime domain.AccountRuntime) error
	SaveTick(ctx context.Context, accountID string, updatedAt time.Time) error
	TouchRuntime(ctx context.Context, accountID string, updatedAt time.Time) error
}

type TokenStore interface {
	Validate(ctx context.Context, token string) (bool, error)
	AuthorizeAccount(ctx context.Context, token, accountID string) (bool, error)
	BindAccount(ctx context.Context, token, accountID string) error
}

type Dependencies struct {
	Accounts AccountStore
	Tokens   TokenStore
}

func NewRouter(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux
}

func RegisterRoutes(mux *http.ServeMux, deps Dependencies) {
	auth := NewAuthMiddleware(deps.Tokens)

	mux.Handle("/register", auth.RequireToken(&RegisterHandler{
		accounts: deps.Accounts,
		tokens:   deps.Tokens,
		now:      time.Now,
	}))
	mux.Handle("/heartbeat", auth.RequireToken(&HeartbeatHandler{
		accounts: deps.Accounts,
		tokens:   deps.Tokens,
		now:      time.Now,
	}))
	mux.Handle("/tick", auth.RequireToken(&TickHandler{
		accounts: deps.Accounts,
		tokens:   deps.Tokens,
		now:      time.Now,
	}))
	mux.Handle("/bars", auth.RequireToken(&BarsHandler{
		accounts: deps.Accounts,
		tokens:   deps.Tokens,
		now:      time.Now,
	}))
	mux.Handle("/positions", auth.RequireToken(&PositionsHandler{
		accounts: deps.Accounts,
		tokens:   deps.Tokens,
		now:      time.Now,
	}))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
