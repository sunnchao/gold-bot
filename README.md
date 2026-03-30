# Gold Bolt Server

服务端黄金交易策略系统。

## 架构

```
MT4 EA (Windows)  ──HTTP──→  Gold Bolt Server (Linux/OpenClaw)
                  ←指令──┘         │
                                   ├── 策略引擎（Python）
                                   └── Web 监控面板
```

## 职责划分

| 组件 | 职责 |
|------|------|
| **EA（客户端）** | 风控参数、下单执行、止损止盈、账户安全 |
| **Server（服务端）** | 策略分析、信号生成、数据展示 |

## EA 参数

- `ServerURL` — 服务器地址
- `AccountID` — 账户标识
- `MagicNumber` — 魔术号
- `ApiToken` — 接口认证 Token
- `MaxRiskPercent` — 单笔最大风险%
- `MaxPositions` — 最大持仓数
- `MaxDailyLoss` — 日最大亏损%
- `MaxSpread` — 最大点差

## 启动

```bash
cd gold_bolt_server
pip install -r requirements.txt
python -m gold_bolt_server.app
# 默认 http://0.0.0.0:8880
```

## 前端

访问 `http://服务器IP:8880/` 查看实时监控面板
# gold-bot
