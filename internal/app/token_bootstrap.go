package app

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"

	"gold-bot/internal/config"
	sqlitestore "gold-bot/internal/store/sqlite"
)

type legacyTokenRecord struct {
	Accounts []string `json:"accounts"`
	Name     string   `json:"name"`
}

func bootstrapTokens(ctx context.Context, repo *sqlitestore.TokenRepository, cfg config.Config, now time.Time) error {
	if cfg.AdminToken != "" {
		if err := repo.PutToken(ctx, cfg.AdminToken, "admin", true, now); err != nil {
			return err
		}
	}

	records, err := repo.List(ctx)
	if err != nil {
		return err
	}

	hasUserToken := false
	for _, record := range records {
		if !record.IsAdmin {
			hasUserToken = true
			break
		}
	}
	if hasUserToken {
		return nil
	}

	legacyTokensPath := filepath.Join(filepath.Dir(cfg.DBPath), "tokens.json")
	payload, err := os.ReadFile(legacyTokensPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	var legacyTokens map[string]legacyTokenRecord
	if err := json.Unmarshal(payload, &legacyTokens); err != nil {
		log.Printf("gold-bot: skip legacy token import from %s: %v", legacyTokensPath, err)
		return nil
	}

	importedCount := 0
	for token, record := range legacyTokens {
		if token == "" {
			continue
		}
		if err := repo.PutToken(ctx, token, record.Name, false, now); err != nil {
			return err
		}
		for _, accountID := range record.Accounts {
			if err := repo.BindAccount(ctx, token, accountID); err != nil {
				return err
			}
		}
		importedCount++
	}

	if importedCount > 0 {
		log.Printf("gold-bot: imported %d legacy token records from %s", importedCount, legacyTokensPath)
	}

	return nil
}
