package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"gold-bot/internal/domain"
)

type DecisionRepository struct {
	db *sql.DB
}

type decisionEventExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func NewDecisionRepository(db *sql.DB) *DecisionRepository {
	return &DecisionRepository{db: db}
}

func (r *DecisionRepository) Record(ctx context.Context, event domain.DecisionEvent) error {
	return retrySQLiteBusy(func() error {
		return r.record(ctx, r.db, event)
	}, func() error {
		return fmt.Errorf("record decision event %s/%s: sqlite busy after retries", event.DecisionID, event.Stage)
	})
}

func (r *DecisionRepository) record(ctx context.Context, execer decisionEventExecutor, event domain.DecisionEvent) error {
	reasonCodesJSON, err := json.Marshal(event.ReasonCodes)
	if err != nil {
		return fmt.Errorf("marshal decision reason codes %s: %w", event.DecisionID, err)
	}
	summaryJSON, err := json.Marshal(event.Summary)
	if err != nil {
		return fmt.Errorf("marshal decision summary %s: %w", event.DecisionID, err)
	}

	query := `
			INSERT INTO decision_events (
				decision_id,
				account_id,
				symbol,
				stage,
				status,
				reason_codes_json,
				summary_json,
				related_command_id,
				created_at
			) VALUES (` + ph(1) + pgText() + `, ` + ph(2) + pgText() + `, ` + ph(3) + pgText() + `, ` + ph(4) + pgText() + `, ` + ph(5) + pgText() + `, ` + ph(6) + `, ` + ph(7) + `, ` + ph(8) + pgText() + `, ` + ph(9) + `)
		`
	if _, err := execer.ExecContext(ctx, query,
		event.DecisionID,
		event.AccountID,
		event.Symbol,
		string(event.Stage),
		string(event.Status),
		string(reasonCodesJSON),
		string(summaryJSON),
		event.RelatedCommandID,
		formatTime(normalizeTime(event.CreatedAt)),
	); err != nil {
		return fmt.Errorf("record decision event %s/%s: %w", event.DecisionID, event.Stage, err)
	}
	return nil
}

func (r *DecisionRepository) List(ctx context.Context, filter domain.DecisionEventFilter) ([]domain.DecisionEvent, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	clauses := []string{"account_id = " + ph(1) + pgText()}
	args := []any{filter.AccountID}
	argIndex := 2
	if filter.Symbol != "" {
		clauses = append(clauses, "symbol = "+ph(argIndex)+pgText())
		args = append(args, filter.Symbol)
		argIndex++
	}
	if filter.Status != "" {
		clauses = append(clauses, "status = "+ph(argIndex)+pgText())
		args = append(args, string(filter.Status))
		argIndex++
	}
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, `
		SELECT
			id,
			decision_id,
			account_id,
			symbol,
			stage,
			status,
			reason_codes_json,
			summary_json,
			related_command_id,
			created_at
		FROM decision_events
		WHERE `+strings.Join(clauses, " AND ")+`
		ORDER BY created_at DESC, id DESC
		LIMIT `+ph(argIndex)+`
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("list decision events for %s/%s: %w", filter.AccountID, filter.Symbol, err)
	}
	defer rows.Close()

	events := make([]domain.DecisionEvent, 0)
	for rows.Next() {
		event, err := scanDecisionEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate decision events for %s/%s: %w", filter.AccountID, filter.Symbol, err)
	}
	return events, nil
}

func scanDecisionEvent(scanner rowScanner) (domain.DecisionEvent, error) {
	var event domain.DecisionEvent
	var stage string
	var status string
	var reasonCodesJSON string
	var summaryJSON string
	var createdAt string
	if err := scanner.Scan(
		&event.ID,
		&event.DecisionID,
		&event.AccountID,
		&event.Symbol,
		&stage,
		&status,
		&reasonCodesJSON,
		&summaryJSON,
		&event.RelatedCommandID,
		&createdAt,
	); err != nil {
		return domain.DecisionEvent{}, err
	}

	event.Stage = domain.DecisionStage(stage)
	event.Status = domain.DecisionStatus(status)
	event.CreatedAt = parseTime(createdAt)
	if reasonCodesJSON != "" {
		if err := json.Unmarshal([]byte(reasonCodesJSON), &event.ReasonCodes); err != nil {
			return domain.DecisionEvent{}, fmt.Errorf("unmarshal decision reason codes %s: %w", event.DecisionID, err)
		}
	}
	if summaryJSON != "" {
		if err := json.Unmarshal([]byte(summaryJSON), &event.Summary); err != nil {
			return domain.DecisionEvent{}, fmt.Errorf("unmarshal decision summary %s: %w", event.DecisionID, err)
		}
	}
	if event.ReasonCodes == nil {
		event.ReasonCodes = []string{}
	}
	if event.Summary == nil {
		event.Summary = map[string]any{}
	}
	return event, nil
}
