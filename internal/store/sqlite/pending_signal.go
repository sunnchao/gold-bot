package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"gold-bot/internal/domain"
)

// PendingSignalRepository handles database operations for pending signals.
type PendingSignalRepository struct {
	db *sql.DB
}

// NewPendingSignalRepository creates a new pending signal repository.
func NewPendingSignalRepository(db *sql.DB) *PendingSignalRepository {
	return &PendingSignalRepository{db: db}
}

// SavePendingSignal inserts or updates a pending signal.
func (r *PendingSignalRepository) SavePendingSignal(ctx context.Context, signal *domain.PendingSignal) error {
	if signal.ID == 0 {
		query, args := buildPendingSignalInsert(signal)

		if isPg() {
			if err := r.db.QueryRowContext(ctx, query, args...).Scan(&signal.ID); err != nil {
				return fmt.Errorf("insert pending signal: %w", err)
			}
			return nil
		}

		result, err := r.db.ExecContext(ctx, query, args...)
		if err != nil {
			return fmt.Errorf("insert pending signal: %w", err)
		}

		id, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("get last insert id: %w", err)
		}
		signal.ID = id
		return nil
	}

	// Update existing signal
	_, err := r.db.ExecContext(ctx, `
		UPDATE pending_signal SET
			account_id = `+ph(1)+pgText()+`,
			symbol = `+ph(2)+pgText()+`,
			side = `+ph(3)+pgText()+`,
			score = `+ph(4)+`,
			strategy = `+ph(5)+pgText()+`,
			indicators = `+ph(6)+pgText()+`,
			status = `+ph(7)+pgText()+`,
			created_at = `+ph(8)+`,
			expires_at = `+ph(9)+`,
			arbitration_result = `+ph(10)+pgText()+`,
			arbitration_reason = `+ph(11)+pgText()+`
		WHERE id = `+ph(12)+`
	`,
		signal.AccountID,
		signal.Symbol,
		signal.Side,
		signal.Score,
		signal.Strategy,
		signal.Indicators,
		signal.Status,
		formatTime(signal.CreatedAt),
		formatTime(signal.ExpiresAt),
		signal.ArbitrationResult,
		signal.ArbitrationReason,
		signal.ID,
	)
	if err != nil {
		return fmt.Errorf("update pending signal %d: %w", signal.ID, err)
	}
	return nil
}

func buildPendingSignalInsert(signal *domain.PendingSignal) (string, []any) {
	query := `
		INSERT INTO pending_signal (
			account_id, symbol, side, score, strategy, indicators,
			status, created_at, expires_at
		) VALUES (
			` + ph(1) + pgText() + `, ` + ph(2) + pgText() + `, ` + ph(3) + pgText() + `,
			` + ph(4) + `, ` + ph(5) + pgText() + `, ` + ph(6) + pgText() + `,
			` + ph(7) + pgText() + `, ` + ph(8) + `, ` + ph(9) + `
		)
	`
	if isPg() {
		query += ` RETURNING id`
	}

	return query, []any{
		signal.AccountID,
		signal.Symbol,
		signal.Side,
		signal.Score,
		signal.Strategy,
		signal.Indicators,
		signal.Status,
		formatTime(signal.CreatedAt),
		formatTime(signal.ExpiresAt),
	}
}

// GetPendingSignals retrieves pending signals for a specific account and symbol.
// If both accountID and symbol are empty, returns all signals.
func (r *PendingSignalRepository) GetPendingSignals(ctx context.Context, accountID, symbol string) ([]domain.PendingSignal, error) {
	var query string
	var args []interface{}

	if accountID == "" && symbol == "" {
		query = `
			SELECT id, account_id, symbol, side, score, strategy, indicators,
				   status, created_at, expires_at, arbitration_result, arbitration_reason
			FROM pending_signal
			ORDER BY created_at DESC
		`
		args = []interface{}{}
	} else if accountID != "" && symbol != "" {
		query = `
			SELECT id, account_id, symbol, side, score, strategy, indicators,
				   status, created_at, expires_at, arbitration_result, arbitration_reason
			FROM pending_signal
			WHERE account_id = ` + ph(1) + pgText() + ` AND symbol = ` + ph(2) + pgText() + ` AND status = 'pending'
			ORDER BY created_at DESC
		`
		args = []interface{}{accountID, symbol}
	} else if accountID != "" {
		query = `
			SELECT id, account_id, symbol, side, score, strategy, indicators,
				   status, created_at, expires_at, arbitration_result, arbitration_reason
			FROM pending_signal
			WHERE account_id = ` + ph(1) + pgText() + ` AND status = 'pending'
			ORDER BY created_at DESC
		`
		args = []interface{}{accountID}
	} else {
		query = `
			SELECT id, account_id, symbol, side, score, strategy, indicators,
				   status, created_at, expires_at, arbitration_result, arbitration_reason
			FROM pending_signal
			WHERE status = 'pending'
			ORDER BY created_at DESC
		`
		args = []interface{}{}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query pending signals: %w", err)
	}
	defer rows.Close()

	var signals []domain.PendingSignal
	for rows.Next() {
		var s domain.PendingSignal
		var createdAt, expiresAt string
		var arbitrationResult, arbitrationReason sql.NullString

		err := rows.Scan(
			&s.ID,
			&s.AccountID,
			&s.Symbol,
			&s.Side,
			&s.Score,
			&s.Strategy,
			&s.Indicators,
			&s.Status,
			&createdAt,
			&expiresAt,
			&arbitrationResult,
			&arbitrationReason,
		)
		if err != nil {
			return nil, fmt.Errorf("scan pending signal: %w", err)
		}

		s.CreatedAt = parseTime(createdAt)
		s.ExpiresAt = parseTime(expiresAt)
		if arbitrationResult.Valid {
			s.ArbitrationResult = arbitrationResult.String
		}
		if arbitrationReason.Valid {
			s.ArbitrationReason = arbitrationReason.String
		}

		signals = append(signals, s)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending signals: %w", err)
	}

	return signals, nil
}

// UpdateArbitration updates the arbitration result for a signal.
func (r *PendingSignalRepository) UpdateArbitration(ctx context.Context, id int64, result, reason string) error {
	status := "approved"
	if result == "rejected" {
		status = "rejected"
	}

	res, err := r.db.ExecContext(ctx, `
		UPDATE pending_signal SET
			status = `+ph(1)+pgText()+`,
			arbitration_result = `+ph(2)+pgText()+`,
			arbitration_reason = `+ph(3)+pgText()+`
		WHERE id = `+ph(4)+`
	`,
		status,
		result,
		reason,
		id,
	)
	if err != nil {
		return fmt.Errorf("update arbitration for signal %d: %w", id, err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update arbitration for signal %d rows affected: %w", id, err)
	}
	if rows == 0 {
		return fmt.Errorf("update arbitration for signal %d: not found", id)
	}

	return nil
}

// ExpireStaleSignals marks expired signals as timeout.
func (r *PendingSignalRepository) ExpireStaleSignals(ctx context.Context) (int64, error) {
	now := formatTime(time.Now().UTC())

	result, err := r.db.ExecContext(ctx, `
		UPDATE pending_signal SET
			status = 'timeout',
			arbitration_result = 'timeout',
			arbitration_reason = 'expired'
		WHERE status = 'pending' AND expires_at < `+ph(1)+`
	`, now)
	if err != nil {
		return 0, fmt.Errorf("expire stale signals: %w", err)
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("expire stale signals rows affected: %w", err)
	}

	return count, nil
}

// GetPendingSignalByID retrieves a pending signal by ID.
func (r *PendingSignalRepository) GetPendingSignalByID(ctx context.Context, id int64) (*domain.PendingSignal, error) {
	var s domain.PendingSignal
	var createdAt, expiresAt string
	var arbitrationResult, arbitrationReason sql.NullString

	err := r.db.QueryRowContext(ctx, `
		SELECT id, account_id, symbol, side, score, strategy, indicators,
			   status, created_at, expires_at, arbitration_result, arbitration_reason
		FROM pending_signal
		WHERE id = `+ph(1)+`
	`, id).Scan(
		&s.ID,
		&s.AccountID,
		&s.Symbol,
		&s.Side,
		&s.Score,
		&s.Strategy,
		&s.Indicators,
		&s.Status,
		&createdAt,
		&expiresAt,
		&arbitrationResult,
		&arbitrationReason,
	)
	if err != nil {
		return nil, fmt.Errorf("get pending signal %d: %w", id, err)
	}

	s.CreatedAt = parseTime(createdAt)
	s.ExpiresAt = parseTime(expiresAt)
	if arbitrationResult.Valid {
		s.ArbitrationResult = arbitrationResult.String
	}
	if arbitrationReason.Valid {
		s.ArbitrationReason = arbitrationReason.String
	}

	return &s, nil
}
