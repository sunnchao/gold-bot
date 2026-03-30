# API 端点文档

## 认证

所有 API 需要 `X-API-Token` header：
```
X-API-Token: your_token_here
```

管理员 Token：
```
RbIzdutbQYFR_cAdZv1jZrN0MyKoLpyf0jb0vSqzhGI
```

---

## EA 端点（MT4 → Server）

### POST `/register`

EA 初始化时注册账户信息。

**Request:**
```json
{
  "account_id": "90011087",
  "broker": "Valutrades Limited",
  "server": "MT4-Demo",
  "account_name": "Demo Account",
  "account_type": "standard",
  "leverage": 500,
  "currency": "USD"
}
```

**Response:**
```json
{"status": "OK", "message": "registered"}
```

---

### POST `/heartbeat`

EA 定期发送心跳，包含账户状态和市场状态。

**Request:**
```json
{
  "account_id": "90011087",
  "symbol": "XAUUSD",
  "server_time": "2026.03.30 12:00",
  "is_trade_allowed": true,
  "market_open": true,
  "balance": 113893.72,
  "equity": 88000.00,
  "margin": 250.00,
  "free_margin": 87750.00,
  "strategies": {
    "pullback": {"enabled": true, "magic": 20250231, "positions": 2},
    "breakout_retest": {"enabled": true, "magic": 20250232, "positions": 0},
    "divergence": {"enabled": true, "magic": 20250233, "positions": 0},
    "breakout_pyramid": {"enabled": true, "magic": 20250234, "positions": 0},
    "counter_pullback": {"enabled": false, "magic": 20250235, "positions": 0},
    "range": {"enabled": false, "magic": 20250236, "positions": 0}
  }
}
```

**Response:**
```json
{"status": "OK", "server_time": 1740000000}
```

---

### POST `/tick`

EA 发送实时报价。

**Request:**
```json
{
  "account_id": "90011087",
  "symbol": "XAUUSD",
  "bid": 4431.40,
  "ask": 4431.59,
  "spread": 0.19,
  "symbols": {}
}
```

**Response:**
```json
{"status": "OK"}
```

---

### POST `/bars`

EA 发送 K 线数据。

**Request:**
```json
{
  "account_id": "90011087",
  "symbol": "XAUUSD",
  "timeframe": "H4",
  "bars": [
    {
      "time": 1740000000,
      "open": 4430.00,
      "high": 4440.00,
      "low": 4420.00,
      "close": 4435.00,
      "volume": 1000
    }
  ]
}
```

**Response:**
```json
{"status": "OK", "received": 150}
```

---

### POST `/positions`

EA 发送当前持仓列表。

**Request:**
```json
{
  "account_id": "90011087",
  "positions": [
    {
      "ticket": 123456,
      "symbol": "XAUUSD",
      "type": "BUY",
      "lots": 0.10,
      "open_price": 4400.00,
      "sl": 4350.00,
      "tp": 4500.00,
      "profit": 150.00,
      "open_time": 1739900000,
      "comment": "GB_pullback_S7",
      "magic": 20250231
    }
  ]
}
```

**Response:**
```json
{"status": "OK", "count": 1}
```

---

### POST `/poll`

EA 轮询获取待执行指令。

**Request:**
```json
{"account_id": "90011087"}
```

**Response:**
```json
{
  "commands": [
    {
      "command_id": "sig_1740000000_90011087",
      "action": "SIGNAL",
      "type": "BUY",
      "symbol": "XAUUSD",
      "entry": 4435.00,
      "sl": 4410.00,
      "tp1": 4460.00,
      "score": 7,
      "strategy": "pullback"
    }
  ]
}
```

---

## 管理端点

### GET `/api/status`

全局状态概览。

**Response:**
```json
{
  "status": "OK",
  "server_time": "2026-03-30 12:00:00",
  "is_admin": true,
  "accounts": {
    "90011087": {
      "account_name": "amazing",
      "connected": true,
      "balance": 113893.72,
      "equity": 88000.00,
      "positions": 2,
      "market_open": true,
      "is_trade_allowed": true
    }
  },
  "strategies": {
    "pullback": "趋势回调",
    "breakout_retest": "突破回踩",
    "divergence": "RSI背离",
    "breakout_pyramid": "突破加仓"
  }
}
```

---

### GET `/api/analysis_payload/<account_id>`

获取 AI 分析所需数据。

**Response:**
```json
{
  "status": "OK",
  "account": {
    "account_id": "90011087",
    "balance": 113893.72,
    "equity": 88000.00
  },
  "market_status": {
    "market_open": true,
    "is_trade_allowed": true,
    "mt4_server_time": "2026.03.30 12:00",
    "tradeable": true
  },
  "indicators": {
    "H4": {
      "close": 4435.00,
      "ema20": 4450.00,
      "rsi": 55.0,
      "adx": 25.0,
      "bars_count": 150
    }
  },
  "positions": [...],
  "timestamp": "2026-03-30T12:00:00+08:00"
}
```

---

### POST `/api/trigger_ai`

手动触发 AI 分析（绕过整点调度）。

**Response:**
```json
{
  "status": "OK",
  "triggered_accounts": ["90011087", "90974574"]
}
```

---

### GET `/api/debug/dm/<account_id>`

调试：检查 DataManager 状态。

**Response:**
```json
{
  "account_id": "90011087",
  "bars_keys": ["M30", "H1", "H4", "D1"],
  "market_open": true,
  "dm_exists": true,
  "dm_data": {
    "H4": {"rows": 150, "has_ema20": true, "has_rsi": true}
  }
}
```

---

### POST `/api/market_status/<account_id>`

获取交易时段状态。

**Response:**
```json
{
  "account_id": "90011087",
  "market_open": true,
  "is_trade_allowed": true,
  "mt4_server_time": "2026.03.30 12:00",
  "local_time": "12:00:00",
  "in_skip_hours": false,
  "is_trading_time": true,
  "status": "OPEN"
}
```

---

## WebSocket 事件

### `account_update`

账户状态更新（心跳响应）。

### `analysis_log`

技术/AI 分析日志。

```json
{
  "account_id": "90011087",
  "time": "12:00:00",
  "logs": [
    {"level": "info", "strategy": "H4", "msg": "EMA20 > EMA50 多头排列"},
    {"level": "signal", "strategy": "汇总", "msg": "✅ BUY @ 4435.00 | SL=4410.00 | pullback | 评分=7"}
  ],
  "source": "technical"
}
```

### `position_action`

持仓操作（止损/平仓）。

### `new_signal`

新信号通知。

### `ai_result`

AI 分析结果。

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 401 | Token 无效 |
| 403 | 无权访问该账户 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
