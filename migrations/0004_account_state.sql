CREATE TABLE IF NOT EXISTS account_state (
  account_id TEXT PRIMARY KEY,
  tick_json TEXT NOT NULL DEFAULT '{}',
  bars_json TEXT NOT NULL DEFAULT '{}',
  positions_json TEXT NOT NULL DEFAULT '[]',
  strategy_mapping_json TEXT NOT NULL DEFAULT '{}',
  ai_result_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
