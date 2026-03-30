# Gold Bolt Server - Agent 开发指南

## 项目概述

**Gold Bolt** 是一个 MT4/MT5 黄金交易自动化系统，包含：
- MT4 EA 客户端（Windows）
- GB Server 服务端（Linux）
- Web 监控面板
- Discord/飞书推送通知

## 快速开始

### 1. 服务端部署

```bash
cd /home/node/gold_bolt_server
pip install -r requirements.txt
python -m gold_bolt_server.app
# 默认 http://0.0.0.0:8880
```

### 2. 服务管理

```bash
systemctl restart gold-bolt-server  # 重启
systemctl status gold-bolt-server    # 状态
journalctl -u gold-bolt-server -f   # 日志
```

### 3. EA 配置

```mq4
ServerURL = "http://服务器IP:8880"
AccountID = "your_account_id"
ApiToken = "your_token"
```

## 项目结构

```
gold_bolt_server/
├── app.py              # 主应用（Flask + SocketIO）
├── config.py           # 配置文件
├── strategy/
│   ├── engine.py       # 策略引擎
│   ├── ai_analyzer.py  # AI 分析模块
│   └── position_mgr.py # 持仓管理
├── utils/
│   ├── discord_notify.py  # Discord 推送
│   └── feishu_notify.py  # 飞书推送
├── data/
│   └── manager.py     # 数据管理器
└── docs/              # 文档
```

## 核心模块

### 策略引擎 (strategy/engine.py)

负责技术指标计算和信号生成：
- `pullback` - 趋势回调
- `breakout_retest` - 突破回踩
- `divergence` - RSI 背离
- `breakout_pyramid` - 突破加仓
- `counter_pullback` - 反向回调
- `range` - 震荡市区间

### AI 分析 (strategy/ai_analyzer.py)

调用外部 AI API 进行多周期市场分析：
- 分周期输出（M15/M30/H1/H4）
- 综合判断（bias + confidence）
- 出场建议（hold/tighten/close_partial/close_all）

### 持仓管理 (strategy/position_mgr.py)

根据净值变化执行止损/止盈/保本逻辑。

### 数据管理器 (data/manager.py)

存储和管理多周期 K 线数据：
- M30/H1/H4/D1
- 自动计算 EMA/RSI/ADX/MACD 等指标

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/register` | POST | EA 注册账户 |
| `/heartbeat` | POST | EA 心跳（含市场状态） |
| `/tick` | POST | 实时报价 |
| `/bars` | POST | K 线数据 |
| `/positions` | POST | 持仓数据 |
| `/poll` | POST | 轮询指令 |
| `/api/analysis_payload/<acc_id>` | GET | AI 分析数据 |
| `/api/trigger_ai` | POST | 手动触发 AI 分析 |
| `/api/market_status/<acc_id>` | GET | 市场状态 |

## 推送通知

### Discord

Webhook 配置在 `utils/discord_notify.py`，触发条件：
- 整点触发（0/15/30/45分）
- AI 分析完成

### 飞书

Webhook 配置在 `utils/feishu_notify.py`，冷却时间 10 分钟。

## 重要规则

### 版本发布规则

1. 每次版本修改创建 CHANGELOG
2. push 前必须询问用户意见
3. 禁止未授权直接 push

### Git 操作

```bash
cd /home/node/gold_bolt_server
git add .
git commit -m "描述"
# 询问用户后再 push
git push origin main
```

## 常见问题

### EA 不发送 K 线数据

检查 MT4 图表历史数据是否足够（至少 150+ 根 H4）。EA 日志中搜索 `⚠️ 历史数据不足`。

### AI 分析不触发

检查：
1. `acc["bars"]` 是否有数据
2. `market_open` 是否为 true
3. 服务端日志中搜索 `整点触发`

### 服务启动失败

```bash
python3 -m py_compile app.py  # 检查语法
journalctl -u gold-bolt-server -n 50  # 查看错误日志
```

## 相关文档

- [架构文档](docs/ARCHITECTURE.md)
- [API 文档](docs/API.md)
- [策略文档](docs/STRATEGIES.md)
- [部署指南](docs/DEPLOYMENT.md)
- [更新日志](docs/CHANGELOG.md)
