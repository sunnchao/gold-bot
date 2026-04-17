package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gold-bot/internal/domain"
)

type CommandRepository struct {
	db *sql.DB
}

func NewCommandRepository(db *sql.DB) *CommandRepository {
	return &CommandRepository{db: db}
}

func (r *CommandRepository) Enqueue(ctx context.Context, command domain.Command) error {
	status := command.Status
	if status == "" {
		status = domain.CommandStatusPending
	}

	payloadJSON, err := command.PayloadJSON()
	if err != nil {
		return fmt.Errorf("marshal command payload %s: %w", command.CommandID, err)
	}

	return retrySQLiteBusy(func() error {
		_, err = r.db.ExecContext(ctx, `
			INSERT INTO commands (
				command_id,
				account_id,
				action,
				payload_json,
				status,
				created_at,
				delivered_at,
				acked_at,
				failed_at
			) VALUES (`+ph(1)+`, `+ph(2)+pgText()+`, `+ph(3)+pgText()+`, `+ph(4)+`, `+ph(5)+pgText()+`, `+ph(6)+`, `+ph(7)+`, `+ph(8)+`, `+ph(9)+`)
		`,
			command.CommandID,
			command.AccountID,
			string(command.Action),
			string(payloadJSON),
			string(status),
			formatTime(normalizeTime(command.CreatedAt)),
			formatTime(command.DeliveredAt),
			formatTime(command.AckedAt),
			formatTime(command.FailedAt),
		)
		if err != nil {
			return fmt.Errorf("enqueue command %s: %w", command.CommandID, err)
		}
		return nil
	}, func() error {
		return fmt.Errorf("enqueue command %s: sqlite busy after retries", command.CommandID)
	})
}

func (r *CommandRepository) TakePending(ctx context.Context, accountID string, deliveredAt time.Time) ([]domain.Command, error) {
	return retrySQLiteBusyValue(func() ([]domain.Command, error) {
		return r.takePendingOnce(ctx, accountID, deliveredAt)
	}, func() error {
		return fmt.Errorf("take pending for %s: sqlite busy after retries", accountID)
	})
}

func (r *CommandRepository) takePendingOnce(ctx context.Context, accountID string, deliveredAt time.Time) ([]domain.Command, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin take pending for %s: %w", accountID, err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	rows, err := tx.QueryContext(ctx, `
		SELECT
			command_id,
			account_id,
			action,
			payload_json,
			status,
			created_at,
			delivered_at,
			acked_at,
			failed_at
		FROM commands
		WHERE account_id = `+ph(1)+pgText()+` AND status = `+ph(2)+pgText()+`
		ORDER BY created_at, command_id
	`, accountID, string(domain.CommandStatusPending))
	if err != nil {
		return nil, fmt.Errorf("query pending commands for %s: %w", accountID, err)
	}

	ts := normalizeTime(deliveredAt)
	pending := make([]domain.Command, 0)
	for rows.Next() {
		command, err := scanCommand(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		pending = append(pending, command)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate pending commands for %s: %w", accountID, err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close pending commands rows for %s: %w", accountID, err)
	}

	commands := make([]domain.Command, 0, len(pending))
	for _, command := range pending {
		result, err := tx.ExecContext(ctx, `
			UPDATE commands
			SET status = `+ph(1)+pgText()+`, delivered_at = `+ph(2)+`
			WHERE command_id = `+ph(3)+pgText()+` AND status = `+ph(4)+pgText()+`
		`,
			string(domain.CommandStatusDelivered),
			formatTime(ts),
			command.CommandID,
			string(domain.CommandStatusPending),
		)
		if err != nil {
			return nil, fmt.Errorf("mark delivered %s: %w", command.CommandID, err)
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf("rows affected for %s: %w", command.CommandID, err)
		}
		if rowsAffected != 1 {
			continue
		}

		command.Status = domain.CommandStatusDelivered
		command.DeliveredAt = ts
		commands = append(commands, command)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit take pending for %s: %w", accountID, err)
	}
	tx = nil

	return commands, nil
}

func (r *CommandRepository) ApplyResult(ctx context.Context, result domain.CommandResult) error {
	status := domain.CommandStatusFailed
	column := "failed_at"
	if result.Result == "OK" {
		status = domain.CommandStatusAcked
		column = "acked_at"
	}

	return retrySQLiteBusy(func() error {
		return r.applyResultOnce(ctx, result, status, column)
	}, func() error {
		return fmt.Errorf("apply result for command %s: sqlite busy after retries", result.CommandID)
	})
}

func (r *CommandRepository) applyResultOnce(
	ctx context.Context,
	result domain.CommandResult,
	status domain.CommandStatus,
	column string,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin apply result for command %s: %w", result.CommandID, err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	res, err := tx.ExecContext(ctx, fmt.Sprintf(`
		UPDATE commands
		SET status = `+ph(1)+pgText()+`, %s = `+ph(2)+`
		WHERE command_id = `+ph(3)+pgText()+` AND account_id = `+ph(4)+pgText()+` AND status = `+ph(5)+pgText()+`
	`, column),
		string(status),
		formatTime(normalizeTime(result.CreatedAt)),
		result.CommandID,
		result.AccountID,
		string(domain.CommandStatusDelivered),
	)
	if err != nil {
		return fmt.Errorf("transition command %s from delivered: %w", result.CommandID, err)
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for command %s: %w", result.CommandID, err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO command_results (
			command_id,
			account_id,
			result,
			ticket,
			error_text,
			created_at
		) VALUES (`+ph(1)+`, `+ph(2)+pgText()+`, `+ph(3)+`, `+ph(4)+`, `+ph(5)+`, `+ph(6)+`)
	`,
		result.CommandID,
		result.AccountID,
		result.Result,
		result.Ticket,
		result.ErrorText,
		formatTime(normalizeTime(result.CreatedAt)),
	); err != nil {
		return fmt.Errorf("save command result %s: %w", result.CommandID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit apply result for command %s: %w", result.CommandID, err)
	}
	tx = nil
	return nil
}

func (r *CommandRepository) Get(ctx context.Context, commandID string) (domain.Command, error) {
	return retrySQLiteBusyValue(func() (domain.Command, error) {
		row := r.db.QueryRowContext(ctx, `
			SELECT
				command_id,
				account_id,
				action,
				payload_json,
				status,
				created_at,
				delivered_at,
				acked_at,
				failed_at
			FROM commands
			WHERE command_id = `+ph(1)+pgText()+`
		`, commandID)

		command, err := scanCommand(row)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.Command{}, err
			}
			return domain.Command{}, fmt.Errorf("get command %s: %w", commandID, err)
		}
		return command, nil
	}, func() error {
		return fmt.Errorf("get command %s: sqlite busy after retries", commandID)
	})
}

func (r *AccountRepository) DB() *sql.DB {
	return r.db
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanCommand(scanner rowScanner) (domain.Command, error) {
	var command domain.Command
	var payloadJSON string
	var status string
	var action string
	var createdAt string
	var deliveredAt string
	var ackedAt string
	var failedAt string
	if err := scanner.Scan(
		&command.CommandID,
		&command.AccountID,
		&action,
		&payloadJSON,
		&status,
		&createdAt,
		&deliveredAt,
		&ackedAt,
		&failedAt,
	); err != nil {
		return domain.Command{}, err
	}

	command.Action = domain.CommandAction(action)
	command.Status = domain.CommandStatus(status)
	command.CreatedAt = parseTime(createdAt)
	command.DeliveredAt = parseTime(deliveredAt)
	command.AckedAt = parseTime(ackedAt)
	command.FailedAt = parseTime(failedAt)
	if payloadJSON != "" {
		if err := json.Unmarshal([]byte(payloadJSON), &command.Payload); err != nil {
			return domain.Command{}, fmt.Errorf("unmarshal command payload %s: %w", command.CommandID, err)
		}
	}
	if command.Payload == nil {
		command.Payload = map[string]any{}
	}
	return command, nil
}

func retrySQLiteBusy(fn func() error, busyErr func() error) error {
	_, err := retrySQLiteBusyValue(func() (struct{}, error) {
		return struct{}{}, fn()
	}, busyErr)
	return err
}

func retrySQLiteBusyValue[T any](fn func() (T, error), busyErr func() error) (T, error) {
	var zero T
	for attempt := 0; attempt < 5; attempt++ {
		value, err := fn()
		if !isSQLiteBusy(err) {
			return value, err
		}
		time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
	}
	if busyErr == nil {
		return zero, nil
	}
	return zero, busyErr()
}
