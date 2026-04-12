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

CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT '',
  acked_at TEXT NOT NULL DEFAULT '',
  failed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS command_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  result TEXT NOT NULL,
  ticket INTEGER NOT NULL DEFAULT 0,
  error_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commands_account_status_created_at
ON commands(account_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_command_results_command_id_created_at
ON command_results(command_id, created_at);
