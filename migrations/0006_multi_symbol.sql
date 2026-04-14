-- ============================================================
-- 表 1: account_state — 加 symbol 列，合并虚假账户
-- ============================================================

CREATE TABLE account_state_v2 (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    tick_json TEXT NOT NULL DEFAULT '{}',
    bars_json TEXT NOT NULL DEFAULT '{}',
    positions_json TEXT NOT NULL DEFAULT '[]',
    strategy_mapping_json TEXT NOT NULL DEFAULT '{}',
    ai_result_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, symbol)
);

-- 81124211 组: 旧 account_id=81124211 → symbol GOLDm#
INSERT INTO account_state_v2
SELECT '81124211', 'GOLDm#', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '81124211';

-- 811242112 (虚假账户) → 合入 81124211, symbol GBPJPYm#
INSERT INTO account_state_v2
SELECT '81124211', 'GBPJPYm#', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '811242112';

-- 90011087 组: 旧 account_id=90011087 → symbol XAUUSD
INSERT INTO account_state_v2
SELECT '90011087', 'XAUUSD', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '90011087';

-- 900110872 (虚假账户) → 合入 90011087, symbol GBPJPY
INSERT INTO account_state_v2
SELECT '90011087', 'GBPJPY', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '900110872';

-- 兜底: 其他未映射的旧记录，symbol 默认 XAUUSD
INSERT OR IGNORE INTO account_state_v2
SELECT account_id, 'XAUUSD', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state
WHERE account_id NOT IN ('81124211', '811242112', '90011087', '900110872');

DROP TABLE account_state;
ALTER TABLE account_state_v2 RENAME TO account_state;

-- ============================================================
-- 表 2: position_states — 合并虚假账户 + 加 symbol 列
-- ============================================================

-- 先合并 account_id (虚假账户 → 真实账户)
UPDATE position_states SET account_id = '81124211' WHERE account_id = '811242112';
UPDATE position_states SET account_id = '90011087' WHERE account_id = '900110872';

CREATE TABLE position_states_v2 (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    ticket INTEGER NOT NULL,
    tp1_hit INTEGER NOT NULL DEFAULT 0,
    tp2_hit INTEGER NOT NULL DEFAULT 0,
    max_profit_atr REAL NOT NULL DEFAULT 0,
    be_moved INTEGER NOT NULL DEFAULT 0,
    be_trigger_atr REAL NOT NULL DEFAULT 1.0,
    open_time TEXT NOT NULL DEFAULT '',
    last_modify_time TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (account_id, symbol, ticket)
);

-- 81124211 的旧持仓归入 GOLDm#（主要货币对）
INSERT INTO position_states_v2
SELECT account_id, 'GOLDm#', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states WHERE account_id = '81124211';

-- 90011087 的旧持仓归入 XAUUSD（主要货币对）
INSERT INTO position_states_v2
SELECT account_id, 'XAUUSD', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states WHERE account_id = '90011087';

-- 兜底: 其他未映射的旧记录，symbol 默认 XAUUSD
INSERT OR IGNORE INTO position_states_v2
SELECT account_id, 'XAUUSD', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states
WHERE account_id NOT IN ('81124211', '90011087');

DROP TABLE position_states;
ALTER TABLE position_states_v2 RENAME TO position_states;

-- ============================================================
-- 表 3: pending_signal（新增 — 仲裁等待层）
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_signal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    score INTEGER NOT NULL,
    strategy TEXT NOT NULL DEFAULT '',
    indicators TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    arbitration_result TEXT DEFAULT '',
    arbitration_reason TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pending_active
    ON pending_signal(account_id, symbol, status, expires_at);
