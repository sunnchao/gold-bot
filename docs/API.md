# API 文档

## 认证

所有受保护接口支持以下任一方式传递 Token：

- `X-API-Token: <token>`
- `X-API-Key: <token>`
- 查询参数 `?token=<token>`：主要给浏览器和 SSE 使用

权限模型：

- 普通 Token：仅允许访问已绑定账户
- Admin Token：可访问所有账户与 Admin API

## 1. Legacy EA 兼容接口

这些接口保持 MQL 端协议兼容，Go 侧以 SQLite 持久化当前状态。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/register` | 注册账户元数据与策略映射 |
| `POST` | `/heartbeat` | 写入余额、净值、市场开关、MT4 服务器时间 |
| `POST` | `/tick` | 写入最新 tick 快照 |
| `POST` | `/bars` | 写入指定 timeframe 的 K 线 |
| `POST` | `/positions` | 写入当前持仓列表 |
| `POST` | `/poll` | 拉取待执行命令 |
| `POST` | `/order_result` | 回报命令执行结果 |

### `POST /poll`

返回示例：

```json
{
  "status": "OK",
  "commands": [
    {
      "command_id": "sig_1740000000_90011087",
      "action": "SIGNAL",
      "type": "BUY",
      "symbol": "XAUUSD",
      "entry": 3335.75,
      "sl": 3331.78,
      "tp1": 3339.72,
      "tp2": 3343.68,
      "strategy": "pullback",
      "score": 6
    }
  ],
  "count": 1
}
```

### `POST /order_result`

请求示例：

```json
{
  "account_id": "90011087",
  "command_id": "sig_1740000000_90011087",
  "result": "SUCCESS",
  "ticket": 123456789,
  "error": ""
}
```

响应：

```json
{
  "status": "OK"
}
```

## 2. AI 兼容与运维接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/api/analysis_payload/{account_id}` | token | 返回 AI 分析所需兼容 payload |
| `GET` | `/api/v2/analysis_payload/{account_id}/{symbol}` | token | 返回指定 symbol 的 AI 分析 payload |
| `POST` | `/api/ai_result/{account_id}` | token | 写入 AI 分析结果，可触发风控平仓命令 |
| `POST` | `/api/v2/ai_result/{account_id}/{symbol}` | token | 写入指定 symbol 的 AI 结果，支持 `trade_plan.v1` |
| `POST` | `/api/trigger_ai` | token | 已废弃，占位返回 deprecated |
| `GET` | `/api/ea/version` | public | EA 版本元数据 |
| `GET` | `/api/ea/download` | token | 下载 EA 文件 |
| `GET` | `/api/tokens` | admin | 查看 Token 列表 |
| `POST` | `/api/tokens` | admin | 创建普通 Token 并绑定账户 |
| `DELETE` | `/api/tokens/{prefix}` | admin | 按前缀吊销 Token |

### `GET /api/analysis_payload/{account_id}`

返回字段聚合自：

- `accounts`
- `account_runtime`
- `account_state`
- 运行时指标计算

返回示例：

```json
{
  "status": "OK",
  "timestamp": "2026-04-13T08:00:00+08:00",
  "account": {
    "account_id": "90011087",
    "equity": 1100.25,
    "balance": 1000.5,
    "margin": 100,
    "free_margin": 1000.25,
    "currency": "USD",
    "leverage": 500,
    "broker": "Demo Broker",
    "server_name": "Demo-1",
    "connected": true
  },
  "market": {
    "symbol": "XAUUSD",
    "bid": 3335.55,
    "ask": 3335.75,
    "spread": 0.2,
    "time": "08:00:00"
  },
  "positions": [],
  "indicators": {
    "H1": {
      "close": 3335.75,
      "ema20": 3334.4,
      "ema50": 3330.2,
      "rsi": 52.1,
      "adx": 71.5,
      "atr": 2.64,
      "macd_hist": -0.82,
      "bb_upper": 3341.03,
      "bb_middle": 0,
      "bb_lower": 3330.8,
      "stoch_k": 61.4,
      "bars_count": 150
    }
  },
  "bars": {
    "H1": [
      {
        "time": "2026.04.13 08:00",
        "open": 3331.2,
        "high": 3336.1,
        "low": 3330.8,
        "close": 3335.75,
        "atr": 2.64,
        "rsi": 52.1,
        "adx": 71.5
      }
    ]
  },
  "market_status": {
    "market_open": true,
    "is_trade_allowed": true,
    "mt4_server_time": "2026.04.13 08:00",
    "tradeable": true
  }
}
```

注意：

- `bb_middle` 当前故意保持与 Python 现网行为兼容，返回 `0`
- 所有 `NaN` / `Inf` 会在 JSON 输出前被清洗为 `0`
- `bars` 返回 `M15` / `M30` / `H1` / `H4` 最近最多 200 根 K 线；字段与服务端 `Bar` 结构一致，供 AI 结构分析使用

### `POST /api/v2/ai_result/{account_id}/{symbol}`

请求会原样保存到 `account_state.ai_result_json`，用于审计和后续回放。旧字段仍保持兼容：

- `bias`
- `confidence`
- `exit_suggestion`
- `risk_alert`
- `alert_reason`
- `suggested_sl`
- `max_position_size`

当请求包含 `trade_plan` 时，服务端会解析并校验 `trade_plan.v1`。校验失败不会丢弃 raw payload，也不会阻止审计保存；响应会返回明确的 `trade_plan_validation`。

请求示例：

```json
{
  "bias": "bullish",
  "confidence": 82,
  "exit_suggestion": "hold",
  "risk_alert": false,
  "trade_plan": {
    "schema_version": "trade_plan.v1",
    "decision_id": "tpv1_abc123",
    "account_id": "90011087",
    "symbol": "XAUUSD",
    "mode": "approve",
    "side": "buy",
    "confidence": 82,
    "entry_zone": { "min": 3335.55, "max": 3335.75 },
    "stop_loss": 3328,
    "take_profit": [3350],
    "max_lots": 0.02,
    "expires_at": "2099-06-06T09:15:00Z",
    "reason_codes": ["mode.approve", "side.buy"],
    "conflicts": [],
    "narrative": "多周期看多，等待 Go 风控确认"
  }
}
```

成功响应示例：

```json
{
  "status": "OK",
  "received": true,
  "trade_plan_validation": { "valid": true },
  "decision": {
    "decision_id": "tpv1_abc123",
    "mode": "approve",
    "symbol": "XAUUSD",
    "confidence": 82
  },
  "risk_gate": {
    "decision_id": "tpv1_abc123",
    "mode": "approve",
    "symbol": "XAUUSD",
    "status": "accepted",
    "audit_only": false,
    "reason_codes": ["lots.accepted"],
    "requested_lots": 0.02,
    "allowed_lots": 0.02
  }
}
```

当 `trade_plan` 校验通过时，服务端会先运行确定性风险门，再考虑任何 AI 影响的可执行命令。风险门检查包括：

- `market_open`、`is_trade_allowed`、tick 新鲜度、当前 spread、`trade_plan.expires_at`
- `approve` / `modify` 的 SL 缺失、SL 方向、SL 距离、最大手数、最小/最大 lot、lot step、净值风险和 free margin
- XAUUSD / GBPJPY 使用静态 symbol metadata；后续可替换为 broker metadata

`risk_gate.status` 取值：

- `accepted`: 确定性检查通过
- `clamped`: 请求手数被 Go 侧确定性上限压低；响应包含 `allowed_lots`
- `rejected`: 命令被阻止；`reason_codes` 给出机器可读原因，例如 `spread.too_wide`、`tick.stale`、`sl.missing`、`lots.clamped`

执行边界：

- `approve` / `modify` 在确定性风险门通过后可进入执行链路；仍必须满足 `risk_gate.status != rejected`、confidence gate、pending gate、禁用 stop-order 等保护，且 shadow mode 不会下发 live command。
- `observe` / `veto` 仍只返回 `risk_gate.audit_only=true`，不会下发开仓或改仓命令。
- `close` / `reduce` 仍走旧的 `risk_alert + exit_suggestion` 平仓/减仓兼容路径，但有 `trade_plan` 时命令 payload 会附带 `decision_id`、`trade_plan_mode` 和 `risk_gate`。
- 风险门 `rejected` 时，不会 enqueue EA command；raw AI payload 仍会保存用于审计。

畸形 `trade_plan` 响应示例：

```json
{
  "status": "OK",
  "received": true,
  "trade_plan_validation": {
    "valid": false,
    "error": "trade_plan.decision_id is required"
  }
}
```

注意：

- `approve` / `modify` 是可执行意图；服务端必须先通过确定性风险门和对应 pending gate，才可能创建命令。
- 本阶段不会因为 `trade_plan.mode=observe` 或 `veto` 自动下发命令。
- 旧的 `risk_alert + exit_suggestion` 平仓/减仓兼容逻辑保持不变。

## 3. Admin API v1

这些接口供新控制台直接消费。

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/api/v1/overview` | admin | 概览卡片 + 账户表 |
| `GET` | `/api/v1/accounts` | admin | 账户列表 |
| `GET` | `/api/v1/accounts/{account_id}` | admin | 账户详情，结构与 AI 兼容 payload 对齐 |
| `GET` | `/api/v1/audit` | admin | Cutover readiness 报告 |
| `GET` | `/api/v1/events/stream` | admin | SSE 事件流 |

### `GET /api/v1/overview`

```json
{
  "status": "OK",
  "generated_at": "2026-04-13T08:00:00Z",
  "cards": [
    {
      "title": "System Health",
      "value": "Healthy",
      "detail": "SQLite + Go API online",
      "tone": "green"
    },
    {
      "title": "Cutover Health",
      "value": "Baseline Only",
      "detail": "Replay validated, shadow diff pending",
      "tone": "orange"
    }
  ],
  "accounts": [
    {
      "account_id": "90011087",
      "broker": "Demo Broker",
      "server_name": "Demo-1",
      "connected": true,
      "balance": 1000.5,
      "equity": 1100.25,
      "positions": 1,
      "market_open": true,
      "is_trade_allowed": true
    }
  ]
}
```

### `GET /api/v1/accounts/{account_id}`

该接口返回：

- `account`
- `market`
- `positions`
- `indicators`
- `ai_result`

它适合控制台直接展示，也适合作为运维排障视图。

### `GET /api/v1/audit`

```json
{
  "status": "OK",
  "generated_at": "2026-04-13T08:00:00Z",
  "report": {
    "ready": false,
    "protocol_error_rate": 0,
    "signal_drift_rate": 0,
    "command_drift_rate": 0,
    "last_shadow_event_at": "0001-01-01T00:00:00Z",
    "missing_capabilities": ["shadow_traffic"],
    "checks": [
      {
        "label": "Replay Parity",
        "value": "validated",
        "detail": "Replay fixture matched Python baseline",
        "tone": "green"
      }
    ]
  },
  "summary": [],
  "events": []
}
```

`ready == true` 的条件：

- replay 已验证
- shadow 流量存在
- `protocol_error_rate == 0`
- `signal_drift_rate <= 0.02`
- `command_drift_rate <= 0.02`

## 4. SSE 事件流

端点：`GET /api/v1/events/stream?token=<admin-token>`

返回格式：

```text
data: {"event_id":"evt_ai_...","event_type":"ai_result","account_id":"90011087","source":"api.ai_result","timestamp":"2026-04-13T08:00:00Z","payload":{"bias":"bullish","trade_plan_summary":{"decision_id":"tpv1_abc123","mode":"approve","symbol":"XAUUSD","confidence":82},"risk_gate":{"status":"accepted","audit_only":false,"reason_codes":["lots.accepted"]}}}
```

事件 envelope 字段：

| 字段 | 说明 |
|------|------|
| `event_id` | 事件唯一 ID |
| `event_type` | 事件类型，例如 `ai_result` |
| `account_id` | 关联账户，可为空 |
| `source` | 事件来源 |
| `timestamp` | UTC 时间 |
| `payload` | 原始 JSON 负载；当 `trade_plan` 校验通过时额外包含 `trade_plan_summary` 和 `risk_gate` |
