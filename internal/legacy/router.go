package legacy

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"gold-bot/internal/domain"
	sqlitestore "gold-bot/internal/store/sqlite"
)

type AccountStore interface {
	UpsertAccount(ctx context.Context, account domain.Account) error
	EnsureAccount(ctx context.Context, accountID string, updatedAt time.Time) error
	SaveHeartbeat(ctx context.Context, runtime domain.AccountRuntime) error
	SaveTick(ctx context.Context, accountID string, updatedAt time.Time) error
	SaveTickSnapshot(ctx context.Context, accountID, symbol string, tick domain.TickSnapshot, updatedAt time.Time) error
	SaveBars(ctx context.Context, accountID, symbol, timeframe string, bars []domain.Bar, updatedAt time.Time) error
	SavePositions(ctx context.Context, accountID, symbol string, positions []domain.Position, updatedAt time.Time) error
	SaveStrategyMapping(ctx context.Context, accountID, symbol string, mapping map[string]string, updatedAt time.Time) error
	GetStateSymbol(ctx context.Context, accountID, symbol string) (domain.AccountState, error)
	GetRuntime(ctx context.Context, accountID string) (domain.AccountRuntime, error)
	TouchRuntime(ctx context.Context, accountID string, updatedAt time.Time) error
}

type TokenStore interface {
	Validate(ctx context.Context, token string) (bool, error)
	AuthorizeAccount(ctx context.Context, token, accountID string) (bool, error)
	BindAccount(ctx context.Context, token, accountID string) error
}

type CommandStore interface {
	Enqueue(ctx context.Context, command domain.Command) error
	Get(ctx context.Context, commandID string) (domain.Command, error)
	TakePending(ctx context.Context, accountID string, deliveredAt time.Time) ([]domain.Command, error)
	ApplyResult(ctx context.Context, result domain.CommandResult) error
}

type LiveTrading interface {
	OnBars(ctx context.Context, accountID, symbol, timeframe string) error
	OnPositions(ctx context.Context, accountID, symbol string) error
}

type Dependencies struct {
	Accounts    AccountStore
	Tokens      TokenStore
	Commands    CommandStore
	LiveTrading LiveTrading
}

func NewRouter(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	RegisterRoutes(mux, deps)
	return mux
}

func RegisterRoutes(mux *http.ServeMux, deps Dependencies) {
	auth := NewAuthMiddleware(deps.Tokens)
	commands := resolveLegacyStores(deps)
	liveTrading := resolveLiveTrading(deps, commands)

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
		accounts:    deps.Accounts,
		tokens:      deps.Tokens,
		liveTrading: liveTrading,
		now:         time.Now,
	}))
	mux.Handle("/positions", auth.RequireToken(&PositionsHandler{
		accounts:    deps.Accounts,
		tokens:      deps.Tokens,
		liveTrading: liveTrading,
		now:         time.Now,
	}))
	mux.Handle("/poll", auth.RequireToken(&PollHandler{
		tokens:   deps.Tokens,
		commands: commands,
		now:      time.Now,
	}))
	mux.Handle("/order_result", auth.RequireToken(&OrderResultHandler{
		tokens:   deps.Tokens,
		commands: commands,
		now:      time.Now,
	}))
}

func resolveLegacyStores(deps Dependencies) CommandStore {
	commands := deps.Commands
	if commands != nil {
		return commands
	}

	dbProvider, ok := deps.Accounts.(interface{ DB() *sql.DB })
	if !ok {
		return commands
	}

	db := dbProvider.DB()
	return sqlitestore.NewCommandRepository(db)
}

func resolveLiveTrading(deps Dependencies, _ CommandStore) LiveTrading {
	return deps.LiveTrading
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
