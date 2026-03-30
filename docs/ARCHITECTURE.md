# 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      MT4 终端 (Windows)                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Gold Bolt EA (MQL4)                   │    │
│  │  - 风控参数执行                                   │    │
│  │  - 下单/改单/平仓                                │    │
│  │  - K线/持仓/心跳推送                             │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  GB Server (Linux/OpenClaw)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  数据管理器  │  │  策略引擎    │  │  AI 分析器   │    │
│  │  manager.py │  │  engine.py   │  │ai_analyzer  │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │              │
│         └────────────────┴────────────────┘              │
│                          │                               │
│                   ┌──────┴──────┐                       │
│                   │  app.py    │                       │
│                   │ (Flask+)   │                       │
│                   └──────┬──────┘                       │
│                          │                               │
│         ┌───────────────┼───────────────┐               │
│         ▼               ▼               ▼               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │  Discord   │  │   飞书    │  │   Web     │      │
│  │  推送     │  │   推送    │  │   面板    │      │
│  └────────────┘  └────────────┘  └────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

### 1. EA → Server (推送)

```
MT4 OnTick()
  ├── SendTick()        → /tick      (实时报价)
  ├── SendHeartbeat()    → /heartbeat (账户+市场状态)
  ├── SendPositions()    → /positions (持仓)
  ├── SendAllBars()      → /bars      (K线)
  └── PollAndExecute()   ← /poll     (指令轮询)
```

### 2. Server 内部处理

```
/bars 接收
  └── DataManager.update_from_bars()
        ├── 存储 K线数据
        └── 计算技术指标 (EMA/RSI/ADX/MACD)

/heartbeat 接收
  ├── 账户状态更新
  └── 市场状态 (server_time/market_open)

analysis_loop (30秒)
  ├── 技术面分析 → strategy_engine.analyze()
  └── 信号生成

ai_analysis_loop (整点 0/15/30/45)
  ├── AI 分析 → ai_analyzer.analyze_with_technicals()
  └── 推送通知 → Discord/飞书
```

### 3. Server → EA (指令)

```
strategy_engine.analyze()
  └── signal → pending_commands

EA poll /poll
  └── 返回 pending_commands
      ├── SIGNAL  → OrderSend()
      ├── MODIFY  → OrderModify()
      ├── CLOSE   → OrderClose()
      └── CLOSE_ALL → OrderClose()
```

## 核心组件

### 数据管理器 (data/manager.py)

| 时间框架 | 数量 | 用途 |
|----------|------|------|
| M30 | 300根 | 短期信号 |
| H1 | 200根 | 基准周期 |
| H4 | 150根 | 主趋势 |
| D1 | 60根 | 长周期结构 |

指标计算：
- EMA (20, 50)
- RSI (14)
- ADX (14)
- MACD (12, 26, 9)
- 布林带 (20, 2σ)
- ATR (14)

### 策略引擎 (strategy/engine.py)

| 策略 | Magic | 描述 |
|------|-------|------|
| pullback | 20250231 | 趋势回调 |
| breakout_retest | 20250232 | 突破回踩 |
| divergence | 20250233 | RSI 背离 |
| breakout_pyramid | 20250234 | 突破加仓 |
| counter_pullback | 20250235 | 反向回调 |
| range | 20250236 | 震荡市区间 |

信号评分机制：
- 基础分 5-6 分
- 技术指标加成
- AI 确认/否定调整
- 最低阈值 5 分

### AI 分析器 (strategy/ai_analyzer.py)

调用外部 AI API，多周期综合分析：
- M15/M30/H1/H4 分周期输出
- 综合 bias (bullish/bearish/neutral)
- confidence (0-100%)
- exit_suggestion (hold/tighten/close_partial/close_all)

### 持仓管理器 (strategy/position_mgr.py)

自动风控处理：
- 止损移动（跟踪）
- 浮亏超限减仓
- 日亏损限制

## 通信协议

### Heartbeat 字段

```json
{
  "account_id": "90011087",
  "symbol": "XAUUSD",
  "server_time": "2026.03.30 12:00",
  "is_trade_allowed": true,
  "market_open": true,
  "balance": 113893.72,
  "equity": 88000.00,
  "strategies": {
    "pullback": {"enabled": true, "magic": 20250231, "positions": 2}
  }
}
```

### Bars 字段

```json
{
  "account_id": "90011087",
  "symbol": "XAUUSD",
  "timeframe": "H4",
  "bars": [
    {"time": 1740000000, "open": 4430.00, "high": 4440.00, "low": 4420.00, "close": 4435.00, "volume": 1000}
  ]
}
```

### Signal 指令

```json
{
  "command_id": "sig_1740000000_90011087",
  "action": "SIGNAL",
  "type": "BUY",
  "symbol": "XAUUSD",
  "entry": 4435.00,
  "sl": 4410.00,
  "tp1": 4460.00,
  "tp2": 4490.00,
  "score": 7,
  "strategy": "pullback",
  "atr_mult": 1.5
}
```

## 部署拓扑

```
Internet
   │
   ├── Discord Webhook ──────→ Discord 频道
   │
   ├── 飞书 Webhook ─────────→ 飞书群
   │
   └── 用户浏览器 ──────────→ GB Server :8880
                                │
                                └── MT4 EA ──→ MT4 经纪商
```

## 服务端口

| 端口 | 服务 | 说明 |
|------|------|------|
| 8880 | GB Server | Web + API |
| 80/443 | 可选 | Nginx 反向代理 |

## 相关文档

- [API 端点](API.md)
- [策略描述](STRATEGIES.md)
- [部署指南](DEPLOYMENT.md)
