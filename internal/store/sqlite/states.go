package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"gold-bot/internal/domain"
)

// SavePositionState persists a single PositionState to the database.
func (r *AccountRepository) SavePositionState(ctx context.Context, accountID, symbol string, state domain.PositionState) error {
	tp1Hit := boolToInt(state.TP1Hit)
	tp2Hit := boolToInt(state.TP2Hit)
	beMoved := boolToInt(state.BEMoved)
	openTime := formatTime(normalizeTime(state.OpenTime))
	lastModify := formatTime(normalizeTime(state.LastModifyTime))
	if lastModify == "" {
		lastModify = time.Now().UTC().Format(time.RFC3339Nano)
	}

	return retrySQLiteBusy(func() error {
		_, err := r.db.ExecContext(ctx, `
			INSERT INTO position_states (
				account_id, symbol, ticket, tp1_hit, tp2_hit, max_profit_atr,
				be_moved, be_trigger_atr, open_time, last_modify_time
			) VALUES (`+ph(1)+pgText()+`, `+ph(2)+pgText()+`, `+ph(3)+`, `+ph(4)+`, `+ph(5)+`, `+ph(6)+`, `+ph(7)+`, `+ph(8)+`, `+ph(9)+`, `+ph(10)+`)
			ON CONFLICT(account_id, symbol, ticket) DO UPDATE SET
				tp1_hit = excluded.tp1_hit,
				tp2_hit = excluded.tp2_hit,
				max_profit_atr = excluded.max_profit_atr,
				be_moved = excluded.be_moved,
				be_trigger_atr = excluded.be_trigger_atr,
				open_time = excluded.open_time,
				last_modify_time = excluded.last_modify_time
		`,
			accountID,
			symbol,
			state.Ticket,
			tp1Hit,
			tp2Hit,
			state.MaxProfitATR,
			beMoved,
			state.BETriggerATR,
			openTime,
			lastModify,
		)
		if err != nil {
			return fmt.Errorf("save position state %s/%s/%d: %w", accountID, symbol, state.Ticket, err)
		}
		return nil
	}, func() error {
		return fmt.Errorf("save position state %s/%s/%d: sqlite busy after retries", accountID, symbol, state.Ticket)
	})
}

// LoadPositionStates loads all position states for an account+symbol from the database.
func (r *AccountRepository) LoadPositionStates(ctx context.Context, accountID, symbol string) (map[int64]domain.PositionState, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT ticket, tp1_hit, tp2_hit, max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
		FROM position_states
		WHERE account_id = `+ph(1)+pgText()+` AND symbol = `+ph(2)+pgText()+`
	`, accountID, symbol)
	if err != nil {
		return nil, fmt.Errorf("load position states for %s/%s: %w", accountID, symbol, err)
	}
	defer rows.Close()

	states := make(map[int64]domain.PositionState)
	for rows.Next() {
		var state domain.PositionState
		var tp1Hit, tp2Hit, beMoved int
		var maxProfitATR, beTriggerATR float64
		var openTime, lastModifyTime string
		if err := rows.Scan(
			&state.Ticket,
			&tp1Hit,
			&tp2Hit,
			&maxProfitATR,
			&beMoved,
			&beTriggerATR,
			&openTime,
			&lastModifyTime,
		); err != nil {
			return nil, fmt.Errorf("scan position state row: %w", err)
		}
		state.TP1Hit = tp1Hit != 0
		state.TP2Hit = tp2Hit != 0
		state.MaxProfitATR = maxProfitATR
		state.BEMoved = beMoved != 0
		state.BETriggerATR = beTriggerATR
		state.OpenTime = parseTime(openTime)
		state.LastModifyTime = parseTime(lastModifyTime)
		states[state.Ticket] = state
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate position states for %s/%s: %w", accountID, symbol, err)
	}
	return states, nil
}

// DeleteStalePositionStates removes position states for tickets no longer in the given list.
func (r *AccountRepository) DeleteStalePositionStates(ctx context.Context, accountID, symbol string, activeTickets []int64) error {
	return retrySQLiteBusy(func() error {
		if len(activeTickets) == 0 {
			_, err := r.db.ExecContext(ctx, `DELETE FROM position_states WHERE account_id = `+ph(1)+pgText()+` AND symbol = `+ph(2)+pgText(), accountID, symbol)
			return err
		}

		placeholders := phsFrom(3, len(activeTickets))
		args := make([]any, 0, len(activeTickets)+2)
		args = append(args, accountID, symbol)
		for _, t := range activeTickets {
			args = append(args, t)
		}

		query := fmt.Sprintf(`DELETE FROM position_states WHERE account_id = %s AND symbol = %s AND ticket NOT IN (%s)`, ph(1)+pgText(), ph(2)+pgText(), placeholders)
		_, err := r.db.ExecContext(ctx, query, args...)
		return err
	}, func() error {
		return fmt.Errorf("delete stale position states for %s/%s: sqlite busy after retries", accountID, symbol)
	})
}

var _ sql.Scanner = (*sql.NullString)(nil) // ensure sql import is used
