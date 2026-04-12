package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type TokenRepository struct {
	db *sql.DB
}

func NewTokenRepository(db *sql.DB) *TokenRepository {
	return &TokenRepository{db: db}
}

func (r *TokenRepository) PutToken(ctx context.Context, token, name string, isAdmin bool, createdAt time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO tokens (
			token,
			name,
			is_admin,
			created_at
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(token) DO UPDATE SET
			name = excluded.name,
			is_admin = excluded.is_admin
	`,
		token,
		name,
		boolToInt(isAdmin),
		formatTime(normalizeTime(createdAt)),
	)
	if err != nil {
		return fmt.Errorf("put token: %w", err)
	}

	return nil
}

func (r *TokenRepository) Validate(ctx context.Context, token string) bool {
	if token == "" {
		return false
	}

	var count int
	if err := r.db.QueryRowContext(ctx, `
		SELECT COUNT(1)
		FROM tokens
		WHERE token = ?
	`, token).Scan(&count); err != nil {
		return false
	}

	return count > 0
}

func (r *TokenRepository) BindAccount(ctx context.Context, token, accountID string) error {
	if token == "" || accountID == "" {
		return nil
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO token_accounts (
			token,
			account_id
		) VALUES (?, ?)
		ON CONFLICT(token, account_id) DO NOTHING
	`, token, accountID)
	if err != nil {
		return fmt.Errorf("bind account %s to token: %w", accountID, err)
	}

	return nil
}

func (r *TokenRepository) AccountsForToken(ctx context.Context, token string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT account_id
		FROM token_accounts
		WHERE token = ?
		ORDER BY account_id
	`, token)
	if err != nil {
		return nil, fmt.Errorf("accounts for token: %w", err)
	}
	defer rows.Close()

	var accounts []string
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			return nil, fmt.Errorf("scan token account: %w", err)
		}
		accounts = append(accounts, accountID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate token accounts: %w", err)
	}

	return accounts, nil
}
