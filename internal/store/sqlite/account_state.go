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

func (r *AccountRepository) SaveTickSnapshot(ctx context.Context, accountID, symbol string, tick domain.TickSnapshot, updatedAt time.Time) error {
	payload, err := json.Marshal(tick)
	if err != nil {
		return fmt.Errorf("marshal tick snapshot %s/%s: %w", accountID, symbol, err)
	}

	return r.updateStateColumn(ctx, accountID, symbol, "tick_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveBars(ctx context.Context, accountID, symbol, timeframe string, bars []domain.Bar, updatedAt time.Time) error {
	payload, err := json.Marshal(bars)
	if err != nil {
		return fmt.Errorf("marshal bars %s/%s/%s: %w", accountID, symbol, timeframe, err)
	}

	r.stateWriteMu.Lock()
	defer r.stateWriteMu.Unlock()

	return retrySQLiteBusy(func() error {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin save bars %s/%s/%s: %w", accountID, symbol, timeframe, err)
		}
		defer func() {
			if tx != nil {
				_ = tx.Rollback()
			}
		}()

		barsJSON, err := loadStateJSON(ctx, tx, accountID, symbol, "bars_json", "{}")
		if err != nil {
			return err
		}

		current := make(map[string]json.RawMessage)
		if barsJSON != "" {
			if err := json.Unmarshal([]byte(barsJSON), &current); err != nil {
				return fmt.Errorf("decode bars state %s/%s: %w", accountID, symbol, err)
			}
		}
		current[timeframe] = payload

		merged, err := json.Marshal(current)
		if err != nil {
			return fmt.Errorf("merge bars state %s/%s/%s: %w", accountID, symbol, timeframe, err)
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE account_state
			SET bars_json = `+ph(1)+`, updated_at = `+ph(2)+`
			WHERE account_id = `+ph(3)+pgText()+` AND symbol = `+ph(4)+pgText()+`
		`,
			string(merged),
			formatTime(normalizeTime(updatedAt)),
			accountID,
			symbol,
		); err != nil {
			return fmt.Errorf("update bars state %s/%s/%s: %w", accountID, symbol, timeframe, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit bars state %s/%s/%s: %w", accountID, symbol, timeframe, err)
		}
		tx = nil
		return nil
	}, func() error {
		return fmt.Errorf("save bars %s/%s/%s: sqlite busy after retries", accountID, symbol, timeframe)
	})
}

func (r *AccountRepository) SavePositions(ctx context.Context, accountID, symbol string, positions []domain.Position, updatedAt time.Time) error {
	payload, err := json.Marshal(positions)
	if err != nil {
		return fmt.Errorf("marshal positions %s/%s: %w", accountID, symbol, err)
	}

	return r.updateStateColumn(ctx, accountID, symbol, "positions_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveStrategyMapping(ctx context.Context, accountID, symbol string, mapping map[string]string, updatedAt time.Time) error {
	payload, err := json.Marshal(mapping)
	if err != nil {
		return fmt.Errorf("marshal strategy mapping %s/%s: %w", accountID, symbol, err)
	}

	return r.updateStateColumn(ctx, accountID, symbol, "strategy_mapping_json", string(payload), updatedAt)
}

func (r *AccountRepository) SaveAIResult(ctx context.Context, accountID, symbol string, payload json.RawMessage, updatedAt time.Time) error {
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	return r.updateStateColumn(ctx, accountID, symbol, "ai_result_json", string(payload), updatedAt)
}

// GetState returns the account state for the default symbol (XAUUSD) for backward compatibility.
func (r *AccountRepository) GetState(ctx context.Context, accountID string) (domain.AccountState, error) {
	return r.GetStateSymbol(ctx, accountID, "XAUUSD")
}

// GetStateSymbol returns the account state for a specific (account_id, symbol) pair.
func (r *AccountRepository) GetStateSymbol(ctx context.Context, accountID, symbol string) (domain.AccountState, error) {
	return retrySQLiteBusyValue(func() (domain.AccountState, error) {
		row := r.db.QueryRowContext(ctx, `
			SELECT
				account_id,
				symbol,
				tick_json,
				bars_json,
				positions_json,
				strategy_mapping_json,
				ai_result_json
			FROM account_state
			WHERE account_id = `+ph(1)+pgText()+` AND symbol = `+ph(2)+pgText()+`
		`, accountID, symbol)

		var state domain.AccountState
		var tickJSON string
		var barsJSON string
		var positionsJSON string
		var mappingJSON string
		var aiResultJSON string
		err := row.Scan(
			&state.AccountID,
			&state.Symbol,
			&tickJSON,
			&barsJSON,
			&positionsJSON,
			&mappingJSON,
			&aiResultJSON,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.AccountState{
				AccountID:       accountID,
				Symbol:          symbol,
				Bars:            map[string][]domain.Bar{},
				Positions:       []domain.Position{},
				StrategyMapping: map[string]string{},
				AIResultJSON:    json.RawMessage(`{}`),
			}, nil
		}
		if err != nil {
			return domain.AccountState{}, fmt.Errorf("get account state %s/%s: %w", accountID, symbol, err)
		}

		if err := json.Unmarshal([]byte(tickJSON), &state.Tick); err != nil {
			return domain.AccountState{}, fmt.Errorf("decode tick state %s/%s: %w", accountID, symbol, err)
		}
		state.Bars = map[string][]domain.Bar{}
		if barsJSON != "" {
			if err := json.Unmarshal([]byte(barsJSON), &state.Bars); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode bars state %s/%s: %w", accountID, symbol, err)
			}
		}
		if positionsJSON != "" {
			if err := json.Unmarshal([]byte(positionsJSON), &state.Positions); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode positions state %s/%s: %w", accountID, symbol, err)
			}
		}
		if mappingJSON != "" {
			if err := json.Unmarshal([]byte(mappingJSON), &state.StrategyMapping); err != nil {
				return domain.AccountState{}, fmt.Errorf("decode strategy mapping %s/%s: %w", accountID, symbol, err)
			}
		}
		if aiResultJSON == "" {
			aiResultJSON = "{}"
		}
		state.AIResultJSON = json.RawMessage(aiResultJSON)
		return state, nil
	}, func() error {
		return fmt.Errorf("get account state %s/%s: sqlite busy after retries", accountID, symbol)
	})
}

// ListSymbols returns all symbols stored for a given account_id.
func (r *AccountRepository) ListSymbols(ctx context.Context, accountID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT symbol FROM account_state
		WHERE account_id = `+ph(1)+pgText()+`
		ORDER BY symbol
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list symbols for %s: %w", accountID, err)
	}
	defer rows.Close()

	var symbols []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("scan symbol: %w", err)
		}
		symbols = append(symbols, s)
	}
	return symbols, rows.Err()
}

func (r *AccountRepository) updateStateColumn(ctx context.Context, accountID, symbol, column, value string, updatedAt time.Time) error {
	query := fmt.Sprintf(`
		UPDATE account_state
		SET %s = `+ph(1)+`, updated_at = `+ph(2)+`
		WHERE account_id = `+ph(3)+pgText()+` AND symbol = `+ph(4)+pgText()+`
	`, column)

	r.stateWriteMu.Lock()
	defer r.stateWriteMu.Unlock()

	return retrySQLiteBusy(func() error {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin update account state %s/%s/%s: %w", accountID, symbol, column, err)
		}
		defer func() {
			if tx != nil {
				_ = tx.Rollback()
			}
		}()

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO account_state (
				account_id,
				symbol,
				updated_at
			) VALUES (`+ph(1)+pgText()+`, `+ph(2)+pgText()+`, `+ph(3)+`)
			ON CONFLICT(account_id, symbol) DO NOTHING
		`,
			accountID,
			symbol,
			formatTime(normalizeTime(updatedAt)),
		); err != nil {
			return fmt.Errorf("ensure account state %s/%s: %w", accountID, symbol, err)
		}

		if _, err := tx.ExecContext(ctx, query, value, formatTime(normalizeTime(updatedAt)), accountID, symbol); err != nil {
			return fmt.Errorf("update account state %s/%s/%s: %w", accountID, symbol, column, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit account state %s/%s/%s: %w", accountID, symbol, column, err)
		}
		tx = nil
		return nil
	}, func() error {
		return fmt.Errorf("update account state %s/%s/%s: sqlite busy after retries", accountID, symbol, column)
	})
}

func loadStateJSON(ctx context.Context, tx *sql.Tx, accountID, symbol, column, fallback string) (string, error) {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO account_state (
			account_id,
			symbol,
			updated_at
		) VALUES (`+ph(1)+pgText()+`, `+ph(2)+pgText()+`, `+ph(3)+`)
		ON CONFLICT(account_id, symbol) DO NOTHING
	`,
		accountID,
		symbol,
		formatTime(time.Now().UTC()),
	); err != nil {
		return "", fmt.Errorf("ensure account state %s/%s: %w", accountID, symbol, err)
	}

	query := fmt.Sprintf("SELECT %s FROM account_state WHERE account_id = "+ph(1)+pgText()+" AND symbol = "+ph(2)+pgText(), column)
	var raw string
	if err := tx.QueryRowContext(ctx, query, accountID, symbol).Scan(&raw); err != nil {
		return "", fmt.Errorf("load account state %s/%s/%s: %w", accountID, symbol, column, err)
	}
	if raw == "" {
		return fallback, nil
	}
	return raw, nil
}
