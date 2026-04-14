package config

import (
	"fmt"
	"os"

	"gold-bot/internal/strategy/engine"
)

type Config struct {
	HTTPAddr       string
	DBPath         string
	DSN            string
	AdminToken     string
	StrategyConfig engine.StrategyConfig
}

func MustLoad() Config {
	cfg := Config{
		HTTPAddr:       getenv("GB_HTTP_ADDR", ":8880"),
		DBPath:         getenv("GB_DB_PATH", "data/gold_bolt.sqlite"),
		DSN:            getenv("DSN", ""),
		AdminToken:     getenv("GB_ADMIN_TOKEN", getenv("ADMIN_TOKEN", "")),
		StrategyConfig: engine.DefaultStrategyConfig(),
	}

	// Override strategy config from environment if set
	if v := getenvFloat("GB_PULLBACK_MIN_ADX", 0); v > 0 {
		cfg.StrategyConfig.PullbackMinADX = v
	}
	if v := getenvFloat("GB_PULLBACK_RSI_OVERSOLD", 0); v > 0 {
		cfg.StrategyConfig.PullbackRSIOversold = v
	}
	if v := getenvFloat("GB_PULLBACK_RSI_OVERBOUGHT", 0); v > 0 {
		cfg.StrategyConfig.PullbackRSIOverbought = v
	}
	if v := getenvFloat("GB_MIN_SCORE", 0); v > 0 {
		cfg.StrategyConfig.MinScore = int(v)
	}

	return cfg
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var f float64
	_, err := fmt.Sscanf(v, "%f", &f)
	if err != nil {
		return fallback
	}
	return f
}

// ParseFloat is a helper for parsing float from string.
func ParseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}

var _ = ParseFloat
