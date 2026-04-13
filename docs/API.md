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
| `POST` | `/api/ai_result/{account_id}` | token | 写入 AI 分析结果，可触发风控平仓命令 |
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
data: {"event_id":"evt_ai_...","event_type":"ai_result","account_id":"90011087","source":"api.ai_result","timestamp":"2026-04-13T08:00:00Z","payload":{"bias":"bullish"}}
```

事件 envelope 字段：

| 字段 | 说明 |
|------|------|
| `event_id` | 事件唯一 ID |
| `event_type` | 事件类型，例如 `ai_result` |
| `account_id` | 关联账户，可为空 |
| `source` | 事件来源 |
| `timestamp` | UTC 时间 |
| `payload` | 原始 JSON 负载 |
