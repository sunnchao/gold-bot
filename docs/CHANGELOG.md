# 更新日志

## 2026-04-12

### v1.0.3

### 功能增强

#### 1. 服务端安全加固与配置整理
- 收敛服务端配置入口并整理启动参数
- 调整通知与工具模块结构，减少运行时隐患

#### 2. 多品种支持修复
- 修复 `symbol` 依赖硬编码的问题
- 改为按运行时品种动态获取并处理信号

#### 3. 发布与开发流程调整
- 更新 `.gitignore`，忽略 git worktree 相关目录
- 补充 Docker 发布流程设计与执行文档

---

## 2026-03-30

### 新增功能

#### 1. 飞书推送通知
- 新增 `utils/feishu_notify.py`
- 支持 Discord + 飞书双渠道推送
- 冷却时间：10 分钟
- Webhook: `https://open.feishu.cn/open-apis/bot/v2/hook/8ecc6b90-aba4-49e5-bcfe-b8779af28e15`

#### 2. AI 分析整点触发
- 修改 `ai_analysis_loop()`
- 触发时间：每小时 0/15/30/45 分
- 移除固定 60 秒间隔

#### 3. 市场状态检测
- EA 发送 `server_time`, `is_trade_allowed`, `market_open`
- 服务端存储并返回 `market_status`
- 市场关闭时跳过 AI 分析

#### 4. Discord 推送修复
- 部署 `utils/discord_notify.py` 到服务器
- 集成到 `ai_analysis_loop()`

### 功能增强

#### 5. 按策略追踪胜率
- 账户初始化包含 `strategy_accuracy` 统计
- 持仓更新时检测平仓并更新胜率

#### 6. divergence 信号 ATR 倍数
- `engine.py` divergence 信号添加 `atr_mult` 字段
- 信号输出包含 `all_strategies` 列表

#### 7. 净持仓方向冲突检查
- `app.py` 添加 `_check_net_position_conflict()`
- 同策略多空冲突时跳过信号

### Bug 修复

#### 8. EA 断线重连
- `SendHeartbeat()` 成功后确认 `gbConnected = true`
- HTTP 请求失败 3 次后标记断线
- 断线后每 10 秒尝试重连

#### 9. DataManager H4/D1 支持
- `get_dataframe()` 添加 H4/D1 时间框架

### 配置变更

| 参数 | 旧值 | 新值 |
|------|------|------|
| AI 分析周期 | 60秒 | 整点触发 |
| 推送冷却 | - | 10分钟 |
| H4 K线数 | - | 150根 |
| D1 K线数 | - | 60根 |

### 待处理

- [ ] EA K 线数据发送问题（历史数据不足）
- [ ] spread_trade 服务端策略实现
- [ ] 策略胜率数据验证

---

## 2026-03-28

### EA v2.8 发布

- 自动重连机制
- 市场状态推送
- HTTP 重试机制
- K 线数据诊断

---

## 早期版本

见 Git 提交历史
