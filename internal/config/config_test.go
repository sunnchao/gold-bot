package config

import "testing"

func TestMustLoadUsesDefaults(t *testing.T) {
	t.Setenv("GB_HTTP_ADDR", "")
	t.Setenv("GB_DB_PATH", "")

	cfg := MustLoad()

	if cfg.HTTPAddr != ":8880" {
		t.Fatalf("HTTPAddr = %q, want %q", cfg.HTTPAddr, ":8880")
	}

	if cfg.DBPath != "data/gold_bolt.sqlite" {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, "data/gold_bolt.sqlite")
	}
}

func TestMustLoadUsesEnvOverrides(t *testing.T) {
	t.Setenv("GB_HTTP_ADDR", "127.0.0.1:9000")
	t.Setenv("GB_DB_PATH", "/tmp/gold-bolt.sqlite")

	cfg := MustLoad()

	if cfg.HTTPAddr != "127.0.0.1:9000" {
		t.Fatalf("HTTPAddr = %q, want %q", cfg.HTTPAddr, "127.0.0.1:9000")
	}

	if cfg.DBPath != "/tmp/gold-bolt.sqlite" {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, "/tmp/gold-bolt.sqlite")
	}
}
