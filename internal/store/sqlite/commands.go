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
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

func (r *CommandRepository) TakePending(ctx context.Context, accountID string, deliveredAt time.Time) ([]domain.Command, error) {
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
		WHERE account_id = ? AND status = ?
		ORDER BY created_at, command_id
	`, accountID, string(domain.CommandStatusPending))
	if err != nil {
		return nil, fmt.Errorf("query pending commands for %s: %w", accountID, err)
	}
	defer rows.Close()

	ts := normalizeTime(deliveredAt)
	commands := make([]domain.Command, 0)
	for rows.Next() {
		command, err := scanCommand(rows)
		if err != nil {
			return nil, err
		}

		result, err := tx.ExecContext(ctx, `
			UPDATE commands
			SET status = ?, delivered_at = ?
			WHERE command_id = ? AND status = ?
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
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending commands for %s: %w", accountID, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit take pending for %s: %w", accountID, err)
	}
	tx = nil

	return commands, nil
}

func (r *CommandRepository) MarkFromResult(ctx context.Context, commandID, result string, ts time.Time) error {
	status := domain.CommandStatusFailed
	column := "failed_at"
	if result == "OK" {
		status = domain.CommandStatusAcked
		column = "acked_at"
	}

	res, err := r.db.ExecContext(ctx, fmt.Sprintf(`
		UPDATE commands
		SET status = ?, %s = ?
		WHERE command_id = ?
	`, column),
		string(status),
		formatTime(normalizeTime(ts)),
		commandID,
	)
	if err != nil {
		return fmt.Errorf("mark command %s from result: %w", commandID, err)
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for command %s: %w", commandID, err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func (r *CommandRepository) Get(ctx context.Context, commandID string) (domain.Command, error) {
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
		WHERE command_id = ?
	`, commandID)

	command, err := scanCommand(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Command{}, err
		}
		return domain.Command{}, fmt.Errorf("get command %s: %w", commandID, err)
	}
	return command, nil
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
