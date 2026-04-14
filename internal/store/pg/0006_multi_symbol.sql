-- ============================================================
-- PostgreSQL migration: multi-symbol support
-- ============================================================

-- 表 1: account_state — 重建为 (account_id, symbol) 复合主键
-- PostgreSQL 不支持 ALTER TABLE ADD PRIMARY KEY on existing table easily,
-- so we rebuild via rename + rename pattern.

CREATE TABLE account_state_v2 (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT 'XAUUSD',
    tick_json TEXT NOT NULL DEFAULT '{}',
    bars_json TEXT NOT NULL DEFAULT '{}',
    positions_json TEXT NOT NULL DEFAULT '[]',
    strategy_mapping_json TEXT NOT NULL DEFAULT '{}',
    ai_result_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, symbol)
);

-- 81124211 组
INSERT INTO account_state_v2
SELECT '81124211', 'GOLDm#', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '81124211';

INSERT INTO account_state_v2
SELECT '81124211', 'GBPJPYm#', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '811242112';

-- 90011087 组
INSERT INTO account_state_v2
SELECT '90011087', 'XAUUSD', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '90011087';

INSERT INTO account_state_v2
SELECT '90011087', 'GBPJPY', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state WHERE account_id = '900110872';

-- 兜底: 其他未映射的旧记录
INSERT INTO account_state_v2 (account_id, symbol, tick_json, bars_json, positions_json, strategy_mapping_json, ai_result_json, updated_at)
SELECT account_id, 'XAUUSD', tick_json, bars_json, positions_json,
       strategy_mapping_json, ai_result_json, updated_at
FROM account_state
WHERE account_id NOT IN ('81124211', '811242112', '90011087', '900110872')
ON CONFLICT (account_id, symbol) DO NOTHING;

DROP TABLE account_state;
ALTER TABLE account_state_v2 RENAME TO account_state;

-- 表 2: position_states — 合并 + 加 symbol 列

UPDATE position_states SET account_id = '81124211' WHERE account_id = '811242112';
UPDATE position_states SET account_id = '90011087' WHERE account_id = '900110872';

CREATE TABLE position_states_v2 (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT 'XAUUSD',
    ticket INTEGER NOT NULL,
    tp1_hit INTEGER NOT NULL DEFAULT 0,
    tp2_hit INTEGER NOT NULL DEFAULT 0,
    max_profit_atr DOUBLE PRECISION NOT NULL DEFAULT 0,
    be_moved INTEGER NOT NULL DEFAULT 0,
    be_trigger_atr DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    open_time TEXT NOT NULL DEFAULT '',
    last_modify_time TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (account_id, symbol, ticket)
);

INSERT INTO position_states_v2
SELECT account_id, 'GOLDm#', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states WHERE account_id = '81124211';

INSERT INTO position_states_v2
SELECT account_id, 'XAUUSD', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states WHERE account_id = '90011087';

-- 兜底
INSERT INTO position_states_v2 (account_id, symbol, ticket, tp1_hit, tp2_hit, max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time)
SELECT account_id, 'XAUUSD', ticket, tp1_hit, tp2_hit,
       max_profit_atr, be_moved, be_trigger_atr, open_time, last_modify_time
FROM position_states
WHERE account_id NOT IN ('81124211', '90011087')
ON CONFLICT (account_id, symbol, ticket) DO NOTHING;

DROP TABLE position_states;
ALTER TABLE position_states_v2 RENAME TO position_states;

-- 表 3: pending_signal（新增）

CREATE TABLE IF NOT EXISTS pending_signal (
    id SERIAL PRIMARY KEY,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    score INTEGER NOT NULL,
    strategy TEXT NOT NULL DEFAULT '',
    indicators TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    expires_at TEXT NOT NULL,
    arbitration_result TEXT DEFAULT '',
    arbitration_reason TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pending_active
    ON pending_signal(account_id, symbol, status, expires_at);
