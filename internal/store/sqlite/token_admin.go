package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"gold-bot/internal/domain"
)

func (r *TokenRepository) IsAdmin(ctx context.Context, token string) (bool, error) {
	for attempt := 0; attempt < 5; attempt++ {
		var isAdmin int
		err := r.db.QueryRowContext(ctx, `
			SELECT is_admin
			FROM tokens
			WHERE token = `+ph(1)+pgText()+`
		`, token).Scan(&isAdmin)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return false, nil
		case isSQLiteBusy(err):
			time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
			continue
		case err != nil:
			return false, fmt.Errorf("check admin token %s: %w", token, err)
		default:
			return isAdmin != 0, nil
		}
	}
	return false, fmt.Errorf("check admin token %s: sqlite busy after retries", token)
}

func (r *TokenRepository) List(ctx context.Context) ([]domain.TokenRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT token, name, is_admin
		FROM tokens
		ORDER BY created_at, token
	`)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()

	// Collect all records first, then close rows before calling
	// AccountsForToken to avoid SQLite connection pool deadlock.
	type pending struct {
		idx   int
		token string
	}
	records := make([]domain.TokenRecord, 0)
	var pendings []pending
	for rows.Next() {
		var record domain.TokenRecord
		var isAdmin int
		if err := rows.Scan(&record.Token, &record.Name, &isAdmin); err != nil {
			return nil, fmt.Errorf("scan token record: %w", err)
		}
		record.IsAdmin = isAdmin != 0
		pendings = append(pendings, pending{idx: len(records), token: record.Token})
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tokens: %w", err)
	}

	// rows is now exhausted (defer Close is fine) — safe to query again.
	for _, p := range pendings {
		accounts, err := r.AccountsForToken(ctx, p.token)
		if err != nil {
			return nil, err
		}
		records[p.idx].Accounts = accounts
	}
	return records, nil
}

func (r *TokenRepository) FindByPrefix(ctx context.Context, prefix string) (string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT token
		FROM tokens
		WHERE token = `+ph(1)+pgText()+` OR token LIKE `+ph(2)+pgText()+`
		ORDER BY token
	`, prefix, prefix+"%")
	if err != nil {
		return "", fmt.Errorf("find token by prefix %s: %w", prefix, err)
	}
	defer rows.Close()

	var token string
	if rows.Next() {
		if err := rows.Scan(&token); err != nil {
			return "", fmt.Errorf("scan token by prefix %s: %w", prefix, err)
		}
		return token, nil
	}
	return "", sql.ErrNoRows
}

func (r *TokenRepository) Delete(ctx context.Context, token string) error {
	return retrySQLiteBusy(func() error {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin delete token %s: %w", token, err)
		}
		defer func() {
			if tx != nil {
				_ = tx.Rollback()
			}
		}()

		if _, err := tx.ExecContext(ctx, `DELETE FROM token_accounts WHERE token = `+ph(1)+pgText(), token); err != nil {
			return fmt.Errorf("delete token accounts for %s: %w", token, err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM tokens WHERE token = `+ph(1)+pgText(), token); err != nil {
			return fmt.Errorf("delete token %s: %w", token, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit delete token %s: %w", token, err)
		}
		tx = nil
		return nil
	}, func() error {
		return fmt.Errorf("delete token %s: sqlite busy after retries", token)
	})
}