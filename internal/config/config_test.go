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
	t.Setenv("GB_ADMIN_TOKEN", "gb-admin-token")

	cfg := MustLoad()

	if cfg.HTTPAddr != "127.0.0.1:9000" {
		t.Fatalf("HTTPAddr = %q, want %q", cfg.HTTPAddr, "127.0.0.1:9000")
	}

	if cfg.DBPath != "/tmp/gold-bolt.sqlite" {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, "/tmp/gold-bolt.sqlite")
	}
	if cfg.AdminToken != "gb-admin-token" {
		t.Fatalf("AdminToken = %q, want %q", cfg.AdminToken, "gb-admin-token")
	}
}

func TestMustLoadSupportsLegacyAdminTokenEnv(t *testing.T) {
	t.Setenv("GB_HTTP_ADDR", "")
	t.Setenv("GB_DB_PATH", "")
	t.Setenv("GB_ADMIN_TOKEN", "")
	t.Setenv("ADMIN_TOKEN", "legacy-admin-token")

	cfg := MustLoad()

	if cfg.AdminToken != "legacy-admin-token" {
		t.Fatalf("AdminToken = %q, want %q", cfg.AdminToken, "legacy-admin-token")
	}
}
