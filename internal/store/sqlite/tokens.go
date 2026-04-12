package sqlite

import (
	"context"
	"database/sql"
	"errors"
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

func (r *TokenRepository) AuthorizeAccount(ctx context.Context, token, accountID string) (bool, error) {
	if token == "" || accountID == "" {
		return false, nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin authorize account transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	lockResult, err := tx.ExecContext(ctx, `
		UPDATE tokens
		SET name = name
		WHERE token = ?
	`, token)
	if err != nil {
		return false, fmt.Errorf("lock token row: %w", err)
	}
	rowsAffected, err := lockResult.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect token lock result: %w", err)
	}
	if rowsAffected == 0 {
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("commit missing token check: %w", err)
		}
		return false, nil
	}

	var existingCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(1)
		FROM token_accounts
		WHERE token = ?
	`, token).Scan(&existingCount); err != nil {
		return false, fmt.Errorf("count token accounts: %w", err)
	}

	if existingCount == 0 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO token_accounts (
				token,
				account_id
			) VALUES (?, ?)
			ON CONFLICT(token, account_id) DO NOTHING
		`, token, accountID); err != nil {
			return false, fmt.Errorf("bind first account %s to token: %w", accountID, err)
		}
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("commit first account binding: %w", err)
		}
		return true, nil
	}

	var matchedAccount string
	err = tx.QueryRowContext(ctx, `
		SELECT account_id
		FROM token_accounts
		WHERE token = ? AND account_id = ?
	`, token, accountID).Scan(&matchedAccount)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("commit rejected authorization check: %w", err)
		}
		return false, nil
	case err != nil:
		return false, fmt.Errorf("check token account binding: %w", err)
	default:
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("commit authorized account check: %w", err)
		}
		return true, nil
	}
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
