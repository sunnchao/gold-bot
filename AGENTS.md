# Gold Bolt - Agent 开发指南

## 项目概述

**Gold Bolt** 是黄金+多品种自动化交易系统。Go 1.24 服务端 + MQL4 EA 客户端。

## ⚠️ AI Agent 约束规则

**1. 版本发布前必须询问用户意见。** 禁止未授权 push。

**2. 策略名与 Magic 号映射是 EA 端的事。** Go 端 signal.Strategy 必须是 EA 认识的策略名（pullback/breakout_retest/divergence/breakout_pyramid/counter_pullback/range/momentum_scalp/ai_signal），不能随意发明新名字。子类型标识用 paylaod 字段传递，不影响 strategy 字段。

## 快速开始

### 构建与测试
```bash
cd /root/gold-bot
go build ./...
go test ./internal/... -count=1
```

### Docker 部署
```bash
docker compose build app && docker rm -f gold-bot && docker compose up -d app
```

## 项目结构

```
gold-bot/
├── internal/
│   ├── domain/        # 领域模型（Signal, Position, Bar, Command 等）
│   ├── strategy/
│   │   ├── engine/    # 策略引擎（checkPullback, checkBreakout 等）
│   │   ├── indicator/ # 技术指标计算
│   │   ├── positionmgr/  # 持仓管理
│   │   └── riskgate/     # 风控 Gate
│   ├── legacy/        # EA 接口层（handlers, live_trading）
│   ├── store/         # 数据层（PostgreSQL）
│   ├── api/           # HTTP API
│   └── scheduler/     # 信号仲裁调度器
├── mt4_ea/            # MQL4 EA 客户端
├── docs/              # 文档
└── .planning/         # GSD 规划文档
```

## EA 端点

| 端点 | 说明 |
|------|------|
| `/register` | EA 注册账户 |
| `/heartbeat` | 心跳（余额/净值） |
| `/tick` | 实时报价 |
| `/bars` | K 线数据 |
| `/positions` | 持仓信息 |
| `/poll` | 轮询指令 |
| `/order_result` | 下单回报 |

## 策略引擎

策略引擎核心文件：`internal/strategy/engine/engine.go`

| 策略 | Magic | 说明 |
|------|-------|------|
| `pullback` | 20250231 | 趋势回调 |
| `breakout_retest` | 20250232 | 突破回踩 |
| `divergence` | 20250233 | RSI 背离 |
| `breakout_pyramid` | 20250234 | 突破加仓 |
| `counter_pullback` | 20250235 | 反向回调 |
| `range` | 20250236 | 震荡市区间 |
| `momentum_scalp` | 20250237 | 动量剥头皮 |
| `ai_signal` | 20250238 | AI 信号 |

## 数据库

PostgreSQL（通过 DSN 环境变量连接）。表结构见 `internal/store/` 下的 migration 文件。

## 日志标签

- `[STRATEGY]` — 策略引擎分析
- `[STRATEGY-SCALP]` — 动量剥头皮日志
- `[POSMGR]` — 持仓管理
- `[AI]` — AI 分析结果
- `[RISK]` — 风控 Gate