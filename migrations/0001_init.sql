CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  broker TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  leverage INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
