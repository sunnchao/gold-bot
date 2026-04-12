package app_test

import (
	"testing"

	"gold-bot/internal/app"
)

func TestNewAppLoadsConfigAndRoutes(t *testing.T) {
	cfg := app.TestConfig()
	_, err := app.New(cfg)
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
}
