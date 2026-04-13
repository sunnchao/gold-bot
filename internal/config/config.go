package config

import "os"

type Config struct {
	HTTPAddr   string
	DBPath     string
	AdminToken string
}

func MustLoad() Config {
	return Config{
		HTTPAddr:   getenv("GB_HTTP_ADDR", ":8880"),
		DBPath:     getenv("GB_DB_PATH", "data/gold_bolt.sqlite"),
		AdminToken: getenv("GB_ADMIN_TOKEN", getenv("ADMIN_TOKEN", "")),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
