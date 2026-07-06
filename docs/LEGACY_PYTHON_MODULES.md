# Legacy Python 模块功能清单

**状态：** 已废弃（2026-07-06 删除）  
**历史：** Python Flask 原始实现 → Go 重写 → Node.js 重写  
**代码行数：** ~1,521 LOC

---

## 目录结构

```
legacy/python/
├── app.py                          # Flask + SocketIO 主服务器 (~400 LOC)
├── config.py                       # 策略配置和环境变量 (~150 LOC)
├── token_manager.py                # Token 权限管理 (~120 LOC)
├── requirements.txt                # Python 依赖
├── start.sh                        # 启动脚本
├── agents/                         # AI 分析脚本
│   ├── post_result.py             # AI 结果上报通用脚本 (~200 LOC)
│   ├── post_result-81124211.py    # 账户专用软链接
│   ├── post_result-90011087.py    # 账户专用软链接
│   └── post_result-90974574.py    # 账户专用软链接
├── strategy/                       # 策略引擎
│   ├── engine.py                  # 策略分析引擎 (~450 LOC)
│   └── position_mgr.py            # 持仓管理器 (~180 LOC)
└── utils/                          # 工具模块
    ├── discord_notify.py          # Discord 推送 (~80 LOC)
    ├── feishu_notify.py           # 飞书推送 (~150 LOC)
    └── hermes_notify.py           # Hermes 多通道推送 (~150 LOC)
```

---

## 核心模块

### 1. `app.py` - Flask 主服务器

**功能：** Flask + SocketIO 提供 HTTP API 和实时 WebSocket 通信

**核心组件：**
- `AccountStore` - 账户状态内存存储
  - 账户信息：equity, balance, margin, free_margin
  - 持仓状态：positions (ticket → position data)
  - 市场数据：tick, bars (symbol → OHLCV)
  - 信号管理：last_signal, pending_commands
  - 策略统计：strategy_accuracy (wins/losses per strategy)
  - Broker 信息：broker, server_name, account_name, leverage

**HTTP 路由：**
1. **EA Legacy Routes (7)**
   - `POST /register` - EA 客户端注册
   - `POST /heartbeat` - EA 心跳更新（账户状态）
   - `POST /tick` - 实时 tick 数据
   - `POST /bars` - K线数据（H4/H1/M30/M15）
   - `POST /positions` - 持仓同步
   - `GET /poll` - 轮询交易指令
   - `POST /order_result` - 订单执行结果回调

2. **Admin Routes (~10)**
   - `GET /api/accounts` - 账户列表
   - `GET /api/accounts/{id}` - 账户详情
   - `GET /api/overview` - 全局总览
   - `GET /api/tokens` - Token 列表（管理员）
   - `POST /api/tokens` - 创建 Token
   - `DELETE /api/tokens/{token}` - 撤销 Token
   - `POST /api/arbitration/{signal_id}` - 人工审批信号
   - `POST /api/trigger_ai` - 触发 AI 分析

3. **AI Routes (~2)**
   - `GET /api/analysis_payload/{account}` - 生成 AI 分析负载
   - `POST /api/ai_result/{account}` - 接收 AI 研判结果

**SocketIO 事件：**
- `connect` / `disconnect` - 客户端连接管理
- `request_accounts` - Web 端请求账户列表
- `subscribe_account` - 订阅账户实时更新
- 自动推送：账户状态变更、新信号生成、订单执行

**后台服务：**
- 分析调度器 - 每 5 分钟触发 AI 分析
- 心跳监控 - 检测 EA 断线
- 信号仲裁 - 人工审批/超时处理

**已替代为：** `apps/app-server/src/app.ts` (Node.js)

---

### 2. `config.py` - 配置模块

**功能：** 策略配置和环境变量管理

**配置项：**

**服务器配置 (`SERVER`)**
```python
host: "0.0.0.0"
port: 8880
debug: False
```

**Token 管理**
- `ADMIN_TOKEN` - 管理员 Token（环境变量）
- `ACCOUNT_TOKENS` - Token → 账户绑定映射（动态）

**策略配置 (`STRATEGY`)**
1. **pullback (趋势回调)**
   - `enabled`: True
   - `min_adx`: 20 - 最小 ADX 趋势强度
   - `rsi_oversold`: 35 - RSI 超卖阈值
   - `rsi_overbought`: 65 - RSI 超买阈值
   - `min_score`: 5 - 最低信号评分

2. **breakout_retest (突破回踩)**
   - `enabled`: True
   - `lookback`: 20 - 回溯周期
   - `min_score`: 5

3. **divergence (RSI 背离)**
   - `enabled`: True
   - `lookback`: 14 - 背离检测周期
   - `min_score`: 6

4. **breakout_pyramid (突破加仓)**
   - `enabled`: True
   - `entry1_ratio`: 0.4 - 首次仓位比例
   - `entry2_ratio`: 0.6 - 加仓仓位比例
   - `min_score`: 6

**信号参数 (`SIGNAL`)**
```python
min_score: 5              # 最低信号评分
min_reward_risk: 1.5      # 最低盈亏比
duplicate_atr_filter: 1.0 # 同方向 N ATR 内去重
min_signal_interval: 300  # 信号最小间隔（秒）
tp1_atr_multi: 1.5        # TP1 倍数
tp2_atr_multi: 3.0        # TP2 倍数
trailing_atr: 1.5         # 追踪止损 ATR 倍数
```

**策略 Magic 映射**
```python
STRATEGY_MAGIC_MAP = {
    "pullback": 111,
    "breakout_retest": 222,
    "divergence": 333,
    "breakout_pyramid": 444,
    "counter_pullback": 555,
    "range": 666,
}
```

**已替代为：** `packages/config/src/env.ts` + `packages/trading-core/src/engine/config.ts`

---

### 3. `strategy/engine.py` - 策略引擎

**功能：** 技术分析和交易信号生成

**核心类：** `StrategyEngine`

**主方法：** `analyze(dm: DataManager, account: dict) -> (signal, logs)`

**策略实现：**

**1. Pullback (趋势回调)**
- **条件：**
  - H1 EMA20 > EMA50（多头） / H1 EMA20 < EMA50（空头）
  - ADX > 20（趋势强度）
  - RSI < 35（超卖做多） / RSI > 65（超买做空）
  - MACD 柱背离确认
  - 价格回调到 EMA20 附近
- **评分：** ADX/10 + (RSI偏离/10) + MACD确认
- **止损：** 最近摆动低点 - 0.5 ATR
- **止盈：** TP1=1.5 ATR, TP2=3.0 ATR

**2. Breakout Retest (突破回踩)**
- **条件：**
  - 突破 20 周期高点/低点
  - 回踩突破位（tolerance: 0.3 ATR）
  - ADX > 25（强趋势）
  - 成交量确认
- **评分：** ADX/10 + 回踩质量评分
- **止损：** 突破位 ± 0.5 ATR
- **止盈：** TP1=2.0 ATR, TP2=4.0 ATR

**3. Divergence (RSI 背离)**
- **条件：**
  - 价格创新高/新低
  - RSI 未创新高/新低（背离）
  - 背离跨度 ≥ 5 根 K 线
  - MACD 柱背离确认
- **评分：** 背离跨度/5 + MACD确认
- **止损：** 背离起点 ± 0.5 ATR
- **止盈：** TP1=1.5 ATR, TP2=3.0 ATR

**4. Breakout Pyramid (突破加仓)**
- **条件：**
  - 突破关键阻力/支撑
  - 盘整区间 ≥ 10 根 K 线
  - ADX > 30（强趋势）
  - 分两次建仓：40% + 60%
- **评分：** 盘整时长/10 + ADX/10
- **止损：** 盘整区底部 ± 0.5 ATR
- **止盈：** TP1=2.0 ATR, TP2=4.0 ATR

**H4 主趋势过滤：**
- **强多头：** H4 EMA20 > EMA50 且 ADX > 25 → 只做多
- **强空头：** H4 EMA20 < EMA50 且 ADX > 25 → 只做空
- **震荡：** ADX < 25 → 不过滤

**信号去重：**
- 同方向信号在 1.0 ATR 范围内去重
- 两次信号间隔 ≥ 300 秒

**已替代为：** `packages/trading-core/src/` (SMC, harmonics, candlestick patterns)

---

### 4. `strategy/position_mgr.py` - 持仓管理

**功能：** 智能止损、止盈、追踪管理

**核心类：** `PositionManager`

**持仓状态：** `PositionState`
```python
ticket: int                 # 订单号
tp1_hit: bool               # TP1 是否触发
tp2_hit: bool               # TP2 是否触发
max_profit_atr: float       # 最大浮盈 ATR 数
open_time: float            # 开仓时间
be_moved: bool              # 是否已移至保本
be_trigger_atr: 1.0         # 保本触发阈值
best_sl: float              # 历史最优止损
```

**出场策略：**

**1. 分批止盈**
- TP1 触发（1.5 ATR）→ 平仓 50%，移 SL 至成本价
- TP2 触发（3.0 ATR）→ 平仓剩余 50%

**2. 波动率自适应**
```python
current_atr / avg_atr > 1.3  → 高波动 → TP1=2.0, TP2=4.0
current_atr / avg_atr < 0.7  → 低波动 → TP1=1.0, TP2=2.0
默认 → TP1=1.5, TP2=3.0
```

**3. 动态追踪止损**
- 浮盈 ≥ 1.0 ATR → 移止损至成本价
- 浮盈 ≥ 2.0 ATR → 追踪止损（距离当前价 1.0 ATR）
- 浮盈 ≥ 3.0 ATR → 收紧追踪（距离 0.5 ATR）

**4. 时间止损**
- 持仓 > 24 小时且浮盈 < 0.5 ATR → 平仓

**5. 关键价位目标**
- 黄金整数关口（2900, 2950, 3000...）
- 到达关口前 20 点 → 平仓 50%

**6. 反转信号平仓**
- MACD 柱反转
- RSI 过度延伸（> 80 或 < 20）
- 长上/下影线（影线 > 实体 2 倍）

**已替代为：** `packages/trading-core/src/positionmgr/` + `packages/trading-core/src/riskgate/`

---

### 5. `token_manager.py` - Token 管理

**功能：** Token 权限管理和持久化

**核心类：** `TokenManager`

**存储格式：** `data/tokens.json`
```json
{
  "token_abc123": {
    "accounts": ["90974574", "81124211"],
    "name": "Production EA",
    "created": "2026-05-01T10:00:00Z"
  }
}
```

**主要方法：**
- `validate(token)` - 验证 Token 有效性
- `is_admin(token)` - 检查管理员权限
- `get_allowed_accounts(token)` - 获取可访问账户列表
- `bind_account(token, account_id)` - EA 连接时绑定
- `generate_token(name, accounts)` - 生成新 Token
- `revoke_token(token)` - 撤销 Token
- `list_tokens()` - 列出所有 Token（脱敏）

**权限模型：**
- **Admin Token：** 可访问所有账户，不写入 tokens.json
- **Account Token：** 只能访问绑定的账户列表
- **自动绑定：** EA 首次连接时，Token 自动绑定到 account_id

**已替代为：** `apps/app-server/src/bootstrap/tokens.ts` + `packages/persistence/src/`

---

## 工具模块

### 6. `utils/discord_notify.py` - Discord 推送

**功能：** Discord Webhook 通知

**核心类：** `DiscordNotifier`

**功能：**
- `send(payload)` - 发送 Discord Embed 消息
- `can_send()` - 冷却检查（15 分钟）

**Payload 格式：**
```python
{
  "embeds": [{
    "title": "交易信号",
    "description": "XAUUSD 多头信号",
    "color": 0x00FF00,  # 绿色
    "fields": [
      {"name": "策略", "value": "趋势回调", "inline": True},
      {"name": "价格", "value": "2950.00", "inline": True},
    ],
    "timestamp": "2026-07-06T10:00:00Z"
  }]
}
```

**已替代为：** `packages/notifications/src/discord.ts`

---

### 7. `utils/feishu_notify.py` - 飞书推送

**功能：** 飞书机器人 Webhook 通知（带签名）

**核心类：** `FeishuNotifier`

**功能：**
- `send(content, title, template)` - 发送飞书卡片消息
- `send_ai_analysis(ai_result, acc_id, symbol)` - 格式化 AI 分析推送
- `_gen_sign(timestamp)` - HMAC-SHA256 签名
- `_build_card(content, title, template)` - 构建飞书卡片

**卡片模板：**
- `green` - 看多信号
- `red` - 看空信号
- `grey` - 中性/震荡
- `purple` - 风险警告
- `blue` - 信息通知

**卡片结构：**
```json
{
  "msg_type": "interactive",
  "card": {
    "header": {"title": "🤖 AI 智能研判", "template": "green"},
    "elements": [
      {"tag": "div", "text": {"tag": "lark_md", "content": "**综合判断**: 🟢 **偏多**"}},
      {"tag": "note", "elements": [{"tag": "plain_text", "content": "⏰ 2026-07-06 10:00:00"}]}
    ]
  },
  "timestamp": 1720238400,
  "sign": "abc123..."
}
```

**冷却时间：** 10 分钟

**已替代为：** `packages/notifications/src/feishu.ts`

---

### 8. `utils/hermes_notify.py` - Hermes 多通道推送

**功能：** 通过 Hermes Gateway 多通道并行推送（飞书 + Telegram + Discord）

**核心功能：**
- `send_multi(message, targets)` - 多通道并行推送
- `_post_to_route(route_name, message)` - 单通道推送
- `_sign_payload(body, secret)` - HMAC-SHA256 签名

**路由配置：**
```python
ROUTES = {
    "feishu": "gold-signal-feishu",
    "telegram": "gold-signal-telegram",
    "discord": "gold-signal-discord",
}
```

**环境变量：**
- `HERMES_WEBHOOK_HOST` - Hermes 地址（默认 127.0.0.1）
- `HERMES_WEBHOOK_PORT` - 端口（默认 8644）
- `HERMES_WEBHOOK_SECRET` - HMAC 签名密钥
- `HERMES_WEBHOOK_TARGETS` - 推送目标（逗号分隔）

**并行执行：**
- 使用 `ThreadPoolExecutor` 并行发送（3 workers）
- 单通道失败不影响其他通道
- 超时：10 秒/通道

**冷却时间：** 60 秒

**已替代为：** Node.js 版本直接调用各通道 notifier

---

## AI Agents 脚本

### 9. `agents/post_result.py` - AI 结果上报

**功能：** 将 AI 分析结果上报到 Gold Bot API 并推送通知

**用法：**
```bash
python post_result.py <account_id> <combined_bias> <confidence> \
  <reasoning> <exit_suggestion> <risk_alert> <alert_reason> [strategy_name]
```

**软链接模式：**
```bash
ln -s post_result.py post_result-90974574.py
python post_result-90974574.py bullish 80 "趋势向上" hold "" "" pullback
```

**账户 ID 解析：**
1. 环境变量 `ACCOUNT_ID`
2. 命令行参数
3. 文件名提取（`post_result-90974574.py` → `90974574`）

**API 请求：**
```python
POST {API_BASE}/api/ai_result/{account_id}
Authorization: Bearer {API_TOKEN}

{
  "combined": {
    "bias": "bullish",
    "confidence": 80,
    "analysis": "趋势向上",
    "exit_suggestion": "hold",
    "exit_reason": "",
    "risk_warning": ""
  },
  "strategy_name": "pullback",
  "timestamp": 1720238400
}
```

**推送通知：**
- **Feishu：** 飞书卡片（带签名）
- **Hermes：** 多通道推送（飞书 + Telegram + Discord）

**策略显示映射：**
```python
STRATEGY_DISPLAY_MAP = {
    "pullback": "趋势回调 PULLBACK",
    "breakout_retest": "突破回踩 BREAKOUT",
    "divergence": "RSI背离 DIVERGENCE",
    "breakout_pyramid": "突破加仓 PYRAMID",
}
```

**已替代为：** `agents/` (NestJS AI 服务) + `apps/app-server/src/routes/ai.ts`

---

## 依赖清单

### `requirements.txt`

```txt
flask==2.3.2
flask-socketio==5.3.4
python-socketio==5.9.0
python-engineio==4.7.1
requests==2.31.0
pandas==2.0.3
numpy==1.24.3
python-dotenv==1.0.0
```

**运行时：** Python 3.9+

---

## 启动脚本

### `start.sh`

```bash
#!/bin/bash
export FLASK_ENV=production
python -m gold_bolt_server.app
```

---

## 功能对照表

| Python 模块 | Node.js 替代 | 状态 |
|-------------|--------------|------|
| `app.py` (Flask) | `apps/app-server/src/app.ts` | ✅ 完全替代 |
| `config.py` | `packages/config/src/env.ts` + `packages/trading-core/src/engine/config.ts` | ✅ 完全替代 |
| `strategy/engine.py` | `packages/trading-core/src/` (SMC, harmonics, candlestick) | ✅ 功能升级 |
| `strategy/position_mgr.py` | `packages/trading-core/src/positionmgr/` + `packages/trading-core/src/riskgate/` | ✅ 完全替代 |
| `token_manager.py` | `apps/app-server/src/bootstrap/tokens.ts` + `packages/persistence/src/` | ✅ 功能增强 |
| `utils/discord_notify.py` | `packages/notifications/src/discord.ts` | ✅ 完全替代 |
| `utils/feishu_notify.py` | `packages/notifications/src/feishu.ts` | ✅ 完全替代 |
| `utils/hermes_notify.py` | Node.js 直接调用各通道 | ✅ 替代方案 |
| `agents/post_result.py` | `agents/` (NestJS) + `apps/app-server/src/routes/ai.ts` | ✅ 架构升级 |

---

## 删除原因

1. **功能完全替代：** 所有 Python 功能已在 Node.js 中重新实现
2. **测试覆盖：** Node.js 版本有 334 个测试用例（Python 版本无测试）
3. **架构升级：** 
   - Python: 单体 Flask 应用
   - Node.js: Monorepo + 微服务架构（app-server + agents + packages）
4. **可维护性：** TypeScript 强类型 + ESM + pnpm workspaces
5. **功能增强：**
   - Shadow validation & cutover gates
   - Automated migrations
   - Prometheus metrics (23 个指标)
   - SSE 实时事件流
   - Replay engine + coverage metric

---

## 历史归档

**Git 历史：** 所有 Python 代码保留在 git 历史中  
**删除 Commit：** `refactor: remove Go code, complete Node.js monorepo migration` (2026-07-06)  
**查看方式：**
```bash
# 查看删除前的 Python 代码
git show HEAD:legacy/python/app.py
git show HEAD:legacy/python/strategy/engine.py

# 恢复单个文件（如需参考）
git show HEAD:legacy/python/app.py > /tmp/app.py
```

---

**最后更新：** 2026-07-06  
**文档状态：** 归档参考
