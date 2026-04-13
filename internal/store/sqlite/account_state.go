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

func (r *AccountRepository) SaveTickSnapshot(ctx context.Context, accountID string, tick domain.TickSnapshot, updatedAt time.Time) error {
	payload, err := json.Marshal(tick)
	if err != nil {
		return fmt.Errorf("marshal tick snapshot %s: %w", accountID, err)
	}

	return r.updateStateColumn(ctx, accountID, "tick_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveBars(ctx context.Context, accountID, timeframe string, bars []domain.Bar, updatedAt time.Time) error {
	payload, err := json.Marshal(bars)
	if err != nil {
		return fmt.Errorf("marshal bars %s/%s: %w", accountID, timeframe, err)
	}

	r.stateWriteMu.Lock()
	defer r.stateWriteMu.Unlock()

	return retrySQLiteBusy(func() error {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin save bars %s/%s: %w", accountID, timeframe, err)
		}
		defer func() {
			if tx != nil {
				_ = tx.Rollback()
			}
		}()

		barsJSON, err := loadStateJSON(ctx, tx, accountID, "bars_json", "{}")
		if err != nil {
			return err
		}

		current := make(map[string]json.RawMessage)
		if barsJSON != "" {
			if err := json.Unmarshal([]byte(barsJSON), &current); err != nil {
				return fmt.Errorf("decode bars state %s: %w", accountID, err)
			}
		}
		current[timeframe] = payload

		merged, err := json.Marshal(current)
		if err != nil {
			return fmt.Errorf("merge bars state %s/%s: %w", accountID, timeframe, err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE account_state
			SET bars_json = ` + ph(1) + `, updated_at = ` + ph(2) + `
			WHERE account_id = ` + ph(3) + `
		`,
			string(merged),
			formatTime(normalizeTime(updatedAt)),
			accountID,
		); err != nil {
			return fmt.Errorf("update bars state %s/%s: %w", accountID, timeframe, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit bars state %s/%s: %w", accountID, timeframe, err)
		}
		tx = nil
		return nil
	}, func() error {
		return fmt.Errorf("save bars %s/%s: sqlite busy after retries", accountID, timeframe)
	})
}

func (r *AccountRepository) SavePositions(ctx context.Context, accountID string, positions []domain.Position, updatedAt time.Time) error {
	payload, err := json.Marshal(positions)
	if err != nil {
		return fmt.Errorf("marshal positions %s: %w", accountID, err)
	}

	return r.updateStateColumn(ctx, accountID, "positions_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveStrategyMapping(ctx context.Context, accountID string, mapping map[string]string, updatedAt time.Time) error {
	payload, err := json.Marshal(mapping)
	if err != nil {
		return fmt.Errorf("marshal strategy mapping %s: %w", accountID, err)
	}

	return r.updateStateColumn(ctx, accountID, "strategy_mapping_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveAIResult(ctx context.Context, accountID string, payload json.RawMessage, updatedAt time.Time) error {
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	return r.updateStateColumn(ctx, accountID, "ai_result_json", string(payload), updatedAt)
}

func (r *AccountRepository) GetState(ctx context.Context, accountID string) (domain.AccountState, error) {
	return retrySQLiteBusyValue(func() (domain.AccountState, error) {
		row := r.db.QueryRowContext(ctx, `
			SELECT
				account_id,
				tick_json,
				bars_json,
				positions_json,
				strategy_mapping_json,
				ai_result_json
			FROM account_state
			WHERE account_id = ` + ph(4) + `
		`, accountID)

		var state domain.AccountState
		var tickJSON string
		var barsJSON string
		var positionsJSON string
		var mappingJSON string
		var aiResultJSON string
		err := row.Scan(
			&state.AccountID,
			&tickJSON,
			&barsJSON,
			&positionsJSON,
			&mappingJSON,
			&aiResultJSON,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.AccountState{
				AccountID:       accountID,
				Bars:            map[string][]domain.Bar{},
				Positions:       []domain.Position{},
				StrategyMapping: map[string]string{},
				AIResultJSON:    json.RawMessage(`{}`),
			}, nil
		}
		if err != nil {
			return domain.AccountState{}, fmt.Errorf("get account state %s: %w", accountID, err)
		}

		if err := json.Unmarshal([]byte(tickJSON), &state.Tick); err != nil {
			return domain.AccountState{}, fmt.Errorf("decode tick state %s: %w", accountID, err)
		}
		state.Bars = map[string][]domain.Bar{}
		if barsJSON != "" {
			if err := json.Unmarshal([]byte(barsJSON), &state.Bars); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode bars state %s: %w", accountID, err)
			}
		}
		if positionsJSON != "" {
			if err := json.Unmarshal([]byte(positionsJSON), &state.Positions); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode positions state %s: %w", accountID, err)
			}
		}
		if mappingJSON != "" {
			if err := json.Unmarshal([]byte(mappingJSON), &state.StrategyMapping); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode strategy mapping %s: %w", accountID, err)
			}
		}
		if aiResultJSON == "" {
			aiResultJSON = "{}"
		}
		state.AIResultJSON = json.RawMessage(aiResultJSON)
		return state, nil
	}, func() error {
		return fmt.Errorf("get account state %s: sqlite busy after retries", accountID)
	})
}

func (r *AccountRepository) updateStateColumn(ctx context.Context, accountID, column, value string, updatedAt time.Time) error {
	query := fmt.Sprintf(`
		UPDATE account_state
		SET %s = ` + ph(5) + `, updated_at = ` + ph(6) + `
		WHERE account_id = ` + ph(7) + `
	`, column)

	r.stateWriteMu.Lock()
	defer r.stateWriteMu.Unlock()

	return retrySQLiteBusy(func() error {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin update account state %s/%s: %w", accountID, column, err)
		}
		defer func() {
			if tx != nil {
				_ = tx.Rollback()
			}
		}()

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO account_state (
				account_id,
				updated_at
			) VALUES (` + ph(8) + `, ` + ph(9) + `)
			ON CONFLICT(account_id) DO NOTHING
		`,
			accountID,
			formatTime(normalizeTime(updatedAt)),
		); err != nil {
			return fmt.Errorf("ensure account state %s: %w", accountID, err)
		}

		if _, err := tx.ExecContext(ctx, query, value, formatTime(normalizeTime(updatedAt)), accountID); err != nil {
			return fmt.Errorf("update account state %s/%s: %w", accountID, column, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit account state %s/%s: %w", accountID, column, err)
		}
		tx = nil
		return nil
	}, func() error {
		return fmt.Errorf("update account state %s/%s: sqlite busy after retries", accountID, column)
	})
}

func loadStateJSON(ctx context.Context, tx *sql.Tx, accountID, column, fallback string) (string, error) {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO account_state (
			account_id,
			updated_at
		) VALUES (` + ph(10) + `, ` + ph(11) + `)
		ON CONFLICT(account_id) DO NOTHING
	`,
		accountID,
		formatTime(time.Now().UTC()),
	); err != nil {
		return "", fmt.Errorf("ensure account state %s: %w", accountID, err)
	}

	query := fmt.Sprintf("SELECT %s FROM account_state WHERE account_id = ?", column)
	var raw string
	if err := tx.QueryRowContext(ctx, query, accountID).Scan(&raw); err != nil {
		return "", fmt.Errorf("load account state %s/%s: %w", accountID, column, err)
	}
	if raw == "" {
		return fallback, nil
	}
	return raw, nil
}
