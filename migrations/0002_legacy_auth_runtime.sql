CREATE TABLE IF NOT EXISTS account_runtime (
  account_id TEXT PRIMARY KEY,
  connected INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  equity REAL NOT NULL DEFAULT 0,
  margin REAL NOT NULL DEFAULT 0,
  free_margin REAL NOT NULL DEFAULT 0,
  market_open INTEGER NOT NULL DEFAULT 1,
  is_trade_allowed INTEGER NOT NULL DEFAULT 1,
  mt4_server_time TEXT NOT NULL DEFAULT '',
  last_heartbeat_at TEXT NOT NULL DEFAULT '',
  last_tick_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_accounts (
  token TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (token, account_id)
);
