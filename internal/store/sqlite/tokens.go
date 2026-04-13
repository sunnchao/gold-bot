package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
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
		) VALUES (` + ph(1) + `, ` + ph(2) + `, ` + ph(3) + `, ` + ph(4) + `)
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

func (r *TokenRepository) Validate(ctx context.Context, token string) (bool, error) {
	if token == "" {
		return false, nil
	}

	for attempt := 0; attempt < 5; attempt++ {
		var count int
		err := r.db.QueryRowContext(ctx, `
			SELECT COUNT(1)
			FROM tokens
			WHERE token = ` + ph(5) + `
		`, token).Scan(&count)
		switch {
		case isSQLiteBusy(err):
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		case err != nil:
			return false, fmt.Errorf("validate token %s: %w", token, err)
		default:
			return count > 0, nil
		}
	}

	return false, fmt.Errorf("validate token %s: sqlite busy after retries", token)
}

func (r *TokenRepository) BindAccount(ctx context.Context, token, accountID string) error {
	if token == "" || accountID == "" {
		return nil
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO token_accounts (
			token,
			account_id
		) VALUES (` + ph(6) + `, ` + ph(7) + `)
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

	isAdmin, err := r.IsAdmin(ctx, token)
	if err != nil {
		return false, err
	}
	if isAdmin {
		return true, nil
	}

	exists, err := r.tokenExists(ctx, token)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}

	authorized, err := r.tokenAccountExists(ctx, token, accountID)
	if err != nil {
		return false, err
	}
	if authorized {
		return true, nil
	}

	bound, err := r.tokenHasAnyAccount(ctx, token)
	if err != nil {
		return false, err
	}
	if bound {
		return false, nil
	}

	inserted, err := r.bindFirstAccount(ctx, token, accountID)
	var lastBindBusyErr error
	if err == nil && inserted {
		return true, nil
	}
	if err != nil && !isSQLiteBusy(err) {
		return false, err
	}
	if err != nil {
		lastBindBusyErr = err
	}

	for attempt := 0; attempt < 5; attempt++ {
		if err != nil {
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
		}

		authorized, err = r.tokenAccountExists(ctx, token, accountID)
		if err != nil {
			return false, err
		}
		if authorized {
			return true, nil
		}

		bound, err = r.tokenHasAnyAccount(ctx, token)
		if err != nil {
			return false, err
		}
		if bound {
			return false, nil
		}

		inserted, err = r.bindFirstAccount(ctx, token, accountID)
		if err == nil && inserted {
			return true, nil
		}
		if err != nil && !isSQLiteBusy(err) {
			return false, err
		}
		if err != nil {
			lastBindBusyErr = err
		}
	}

	authorized, err = r.tokenAccountExists(ctx, token, accountID)
	if err != nil {
		return false, err
	}
	if authorized {
		return true, nil
	}

	bound, err = r.tokenHasAnyAccount(ctx, token)
	if err != nil {
		return false, err
	}
	if bound {
		return false, nil
	}
	if lastBindBusyErr != nil {
		return false, lastBindBusyErr
	}

	return false, nil
}

func (r *TokenRepository) tokenExists(ctx context.Context, token string) (bool, error) {
	for attempt := 0; attempt < 5; attempt++ {
		var matchedToken string
		err := r.db.QueryRowContext(ctx, `
			SELECT token
			FROM tokens
			WHERE token = ` + ph(8) + `
		`, token).Scan(&matchedToken)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return false, nil
		case isSQLiteBusy(err):
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		case err != nil:
			return false, fmt.Errorf("lookup token %s: %w", token, err)
		default:
			return true, nil
		}
	}

	return false, fmt.Errorf("lookup token %s: sqlite busy after retries", token)
}

func (r *TokenRepository) tokenAccountExists(ctx context.Context, token, accountID string) (bool, error) {
	for attempt := 0; attempt < 5; attempt++ {
		var matchedAccount string
		err := r.db.QueryRowContext(ctx, `
			SELECT account_id
			FROM token_accounts
			WHERE token = ` + ph(9) + ` AND account_id = ` + ph(10) + `
		`, token, accountID).Scan(&matchedAccount)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return false, nil
		case isSQLiteBusy(err):
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		case err != nil:
			return false, fmt.Errorf("check token account binding: %w", err)
		default:
			return true, nil
		}
	}

	return false, fmt.Errorf("check token account binding: sqlite busy after retries")
}

func (r *TokenRepository) tokenHasAnyAccount(ctx context.Context, token string) (bool, error) {
	for attempt := 0; attempt < 5; attempt++ {
		var matchedAccount string
		err := r.db.QueryRowContext(ctx, `
			SELECT account_id
			FROM token_accounts
			WHERE token = ` + ph(11) + `
			LIMIT 1
		`, token).Scan(&matchedAccount)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return false, nil
		case isSQLiteBusy(err):
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		case err != nil:
			return false, fmt.Errorf("check token bindings for %s: %w", token, err)
		default:
			return true, nil
		}
	}

	return false, fmt.Errorf("check token bindings for %s: sqlite busy after retries", token)
}

func (r *TokenRepository) bindFirstAccount(ctx context.Context, token, accountID string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO token_accounts (
			token,
			account_id
		)
		SELECT ` + ph(12) + `, ` + ph(13) + `
		WHERE EXISTS (
			SELECT 1
			FROM tokens
			WHERE token = ` + ph(14) + `
		)
		AND NOT EXISTS (
			SELECT 1
			FROM token_accounts
			WHERE token = ` + ph(15) + `
		)
	`, token, accountID, token, token)
	if err != nil {
		return false, fmt.Errorf("bind first account %s to token: %w", accountID, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect first account binding result: %w", err)
	}

	return rowsAffected == 1, nil
}

func isSQLiteBusy(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLITE_BUSY")
}

func (r *TokenRepository) AccountsForToken(ctx context.Context, token string) ([]string, error) {
	// PostgreSQL needs explicit type cast for text parameters
	whereClause := "WHERE token = " + ph(16)
	if Dialect() == "postgres" {
		whereClause = "WHERE token = " + ph(16) + "::text"
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT account_id
		FROM token_accounts
		` + whereClause + `
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
