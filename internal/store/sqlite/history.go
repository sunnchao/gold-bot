package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"gold-bot/internal/domain"
)

type HistoryRepository struct {
	db *sql.DB
}

func NewHistoryRepository(db *sql.DB) *HistoryRepository {
	return &HistoryRepository{db: db}
}

func (r *HistoryRepository) SaveCommandResult(ctx context.Context, result domain.CommandResult) error {
	return retrySQLiteBusy(func() error {
		_, err := r.db.ExecContext(ctx, `
			INSERT INTO command_results (
				command_id,
				account_id,
				result,
				ticket,
				error_text,
				created_at
			) VALUES (` + ph(1) + `, ` + ph(2) + `, ` + ph(3) + `, ` + ph(4) + `, ` + ph(5) + `, ` + ph(6) + `)
		`,
			result.CommandID,
			result.AccountID,
			result.Result,
			result.Ticket,
			result.ErrorText,
			formatTime(normalizeTime(result.CreatedAt)),
		)
		if err != nil {
			return fmt.Errorf("save command result %s: %w", result.CommandID, err)
		}
		return nil
	}, func() error {
		return fmt.Errorf("save command result %s: sqlite busy after retries", result.CommandID)
	})
}
