package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	"gold-bot/internal/domain"
)

type AccountRepository struct {
	db           *sql.DB
	stateWriteMu sync.Mutex
}

func NewAccountRepository(db *sql.DB) *AccountRepository {
	return &AccountRepository{db: db}
}

func (r *AccountRepository) UpsertAccount(ctx context.Context, account domain.Account) error {
	updatedAt := normalizeTime(account.UpdatedAt)
	createdAt := normalizeTime(account.CreatedAt)
	if createdAt.IsZero() {
		createdAt = updatedAt
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO accounts (
			account_id,
			broker,
			server_name,
			account_name,
			account_type,
			currency,
			leverage,
			created_at,
			updated_at
		) VALUES (`+ph(1)+`, `+ph(2)+`, `+ph(3)+`, `+ph(4)+`, `+ph(5)+`, `+ph(6)+`, `+ph(7)+`, `+ph(8)+`, `+ph(9)+`)
		ON CONFLICT(account_id) DO UPDATE SET
			broker = excluded.broker,
			server_name = excluded.server_name,
			account_name = excluded.account_name,
			account_type = excluded.account_type,
			currency = excluded.currency,
			leverage = excluded.leverage,
			updated_at = excluded.updated_at
	`,
		account.AccountID,
		account.Broker,
		account.ServerName,
		account.AccountName,
		account.AccountType,
		account.Currency,
		account.Leverage,
		formatTime(createdAt),
		formatTime(updatedAt),
	)
	if err != nil {
		return fmt.Errorf("upsert account %s: %w", account.AccountID, err)
	}

	return nil
}

func (r *AccountRepository) EnsureAccount(ctx context.Context, accountID string, updatedAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO accounts (
			account_id,
			created_at,
			updated_at
		) VALUES (`+ph(1)+pgText()+`, `+ph(2)+`, `+ph(3)+`)
		ON CONFLICT(account_id) DO UPDATE SET
			updated_at = excluded.updated_at
	`,
		accountID,
		formatTime(normalizeTime(updatedAt)),
		formatTime(normalizeTime(updatedAt)),
	)
	if err != nil {
		return fmt.Errorf("ensure account %s: %w", accountID, err)
	}

	return nil
}

func (r *AccountRepository) SaveHeartbeat(ctx context.Context, runtime domain.AccountRuntime) error {
	updatedAt := normalizeTime(runtime.UpdatedAt)
	lastHeartbeat := normalizeTime(runtime.LastHeartbeatAt)

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO account_runtime (
			account_id,
			connected,
			balance,
			equity,
			margin,
			free_margin,
			market_open,
			is_trade_allowed,
			mt4_server_time,
			last_heartbeat_at,
			last_tick_at,
			updated_at
		) VALUES (`+ph(1)+pgText()+`, `+ph(2)+`, `+ph(3)+`, `+ph(4)+`, `+ph(5)+`, `+ph(6)+`, `+ph(7)+`, `+ph(8)+`, `+ph(9)+`, `+ph(10)+`, '', `+ph(11)+`)
		ON CONFLICT(account_id) DO UPDATE SET
			connected = excluded.connected,
			balance = excluded.balance,
			equity = excluded.equity,
			margin = excluded.margin,
			free_margin = excluded.free_margin,
			market_open = excluded.market_open,
			is_trade_allowed = excluded.is_trade_allowed,
			mt4_server_time = excluded.mt4_server_time,
			last_heartbeat_at = excluded.last_heartbeat_at,
			updated_at = excluded.updated_at
	`,
		runtime.AccountID,
		boolToInt(runtime.Connected),
		runtime.Balance,
		runtime.Equity,
		runtime.Margin,
		runtime.FreeMargin,
		boolToInt(runtime.MarketOpen),
		boolToInt(runtime.IsTradeAllowed),
		runtime.MT4ServerTime,
		formatTime(lastHeartbeat),
		formatTime(updatedAt),
	)
	if err != nil {
		return fmt.Errorf("save heartbeat %s: %w", runtime.AccountID, err)
	}

	return nil
}

func (r *AccountRepository) SaveTick(ctx context.Context, accountID string, updatedAt time.Time) error {
	ts := normalizeTime(updatedAt)

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO account_runtime (
			account_id,
			last_tick_at,
			updated_at
		) VALUES (`+ph(1)+pgText()+`, `+ph(2)+`, `+ph(3)+`)
		ON CONFLICT(account_id) DO UPDATE SET
			last_tick_at = excluded.last_tick_at,
			updated_at = excluded.updated_at
	`,
		accountID,
		formatTime(ts),
		formatTime(ts),
	)
	if err != nil {
		return fmt.Errorf("save tick %s: %w", accountID, err)
	}

	return nil
}

func (r *AccountRepository) TouchRuntime(ctx context.Context, accountID string, updatedAt time.Time) error {
	ts := normalizeTime(updatedAt)

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO account_runtime (
			account_id,
			updated_at
		) VALUES (`+ph(1)+pgText()+`, `+ph(2)+`)
		ON CONFLICT(account_id) DO UPDATE SET
			updated_at = excluded.updated_at
	`,
		accountID,
		formatTime(ts),
	)
	if err != nil {
		return fmt.Errorf("touch runtime %s: %w", accountID, err)
	}

	return nil
}

func (r *AccountRepository) GetAccount(ctx context.Context, accountID string) (domain.Account, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			account_id,
			broker,
			server_name,
			account_name,
			account_type,
			currency,
			leverage,
			created_at,
			updated_at
		FROM accounts
		WHERE account_id = `+ph(1)+pgText()+`
	`, accountID)

	var account domain.Account
	var createdAt string
	var updatedAt string
	if err := row.Scan(
		&account.AccountID,
		&account.Broker,
		&account.ServerName,
		&account.AccountName,
		&account.AccountType,
		&account.Currency,
		&account.Leverage,
		&createdAt,
		&updatedAt,
	); err != nil {
		return domain.Account{}, fmt.Errorf("get account %s: %w", accountID, err)
	}

	account.CreatedAt = parseTime(createdAt)
	account.UpdatedAt = parseTime(updatedAt)
	return account, nil
}

func (r *AccountRepository) ListAccounts(ctx context.Context) ([]domain.Account, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			account_id,
			broker,
			server_name,
			account_name,
			account_type,
			currency,
			leverage,
			created_at,
			updated_at
		FROM accounts
		ORDER BY account_id
	`)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	accounts := make([]domain.Account, 0)
	for rows.Next() {
		var account domain.Account
		var createdAt string
		var updatedAt string
		if err := rows.Scan(
			&account.AccountID,
			&account.Broker,
			&account.ServerName,
			&account.AccountName,
			&account.AccountType,
			&account.Currency,
			&account.Leverage,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan account row: %w", err)
		}
		account.CreatedAt = parseTime(createdAt)
		account.UpdatedAt = parseTime(updatedAt)
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate accounts: %w", err)
	}
	return accounts, nil
}

func (r *AccountRepository) GetRuntime(ctx context.Context, accountID string) (domain.AccountRuntime, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			account_id,
			connected,
			balance,
			equity,
			margin,
			free_margin,
			market_open,
			is_trade_allowed,
			mt4_server_time,
			last_heartbeat_at,
			last_tick_at,
			updated_at
		FROM account_runtime
		WHERE account_id = `+ph(1)+pgText()+`
	`, accountID)

	var runtime domain.AccountRuntime
	var connected int
	var marketOpen int
	var isTradeAllowed int
	var lastHeartbeat string
	var lastTick string
	var updatedAt string
	if err := row.Scan(
		&runtime.AccountID,
		&connected,
		&runtime.Balance,
		&runtime.Equity,
		&runtime.Margin,
		&runtime.FreeMargin,
		&marketOpen,
		&isTradeAllowed,
		&runtime.MT4ServerTime,
		&lastHeartbeat,
		&lastTick,
		&updatedAt,
	); err != nil {
		return domain.AccountRuntime{}, fmt.Errorf("get runtime %s: %w", accountID, err)
	}

	runtime.Connected = connected != 0
	runtime.MarketOpen = marketOpen != 0
	runtime.IsTradeAllowed = isTradeAllowed != 0
	runtime.LastHeartbeatAt = parseTime(lastHeartbeat)
	runtime.LastTickAt = parseTime(lastTick)
	runtime.UpdatedAt = parseTime(updatedAt)
	return runtime, nil
}

func normalizeTime(ts time.Time) time.Time {
	if ts.IsZero() {
		return time.Now().UTC()
	}

	return ts.UTC()
}

func formatTime(ts time.Time) string {
	if ts.IsZero() {
		return ""
	}

	return ts.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}

	ts, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}

	return ts.UTC()
}

func boolToInt(value bool) int {
	if value {
		return 1
	}

	return 0
}