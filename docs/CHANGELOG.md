# 更新日志

## 2026-04-15

### v1.5.0

- Go 服务端补齐 `pending_signal` / arbitration 存储接线，新增 App 级 API wiring 与多 symbol 迁移校验
- SQLite/PG 待仲裁信号仓储增强：支持 `RETURNING id`、全量查询、超时过期计数与更新命中校验
- 持仓状态持久化改为按 `account + symbol` 隔离，回放快照与仓位管理分析链路增加 `symbol`
- MT4/MT5 EA 强化 symbol policy：限制可交易品种、按品种计算 spread/volume，并补充 `close_all`/保护挂单相关回归测试
- 同步 AI 风控命令契约与 replay 基线夹具到当前策略输出

## 2026-04-13

### v1.1.1

- 全面增加服务端日志输出，覆盖所有 Legacy/API 接口的请求/响应生命周期
- Legacy 接口日志：register、heartbeat、tick、bars、positions、poll、order_result
  - 每个请求记录：账户ID、关键参数、授权状态、操作结果
  - 错误场景详细记录：解析失败、授权拒绝、数据库错误
- 策略引擎日志：技术面分析全流程
  - 市场状态：Price、ATR、RSI、ADX、EMA趋势、H4趋势、MACD柱
  - 四种策略逐一输出：pullback、breakout_retest、divergence、breakout_pyramid
  - H4 趋势过滤结果
  - 防重复持仓检查
  - 最终信号输出：方向、入场、止损、止盈、策略名、评分
- 持仓管理器日志：
  - 每个持仓的状态：入场价、浮盈ATR、最大利润、保本状态
  - 每个管理决策：保本、TP1分批止盈、关键位止损、TP2止盈、趋势反转、动态追踪止损
- AI 分析日志：
  - analysis_payload 请求记录
  - ai_result 接收：bias、confidence、exit_suggestion
  - 风险警报触发详情
- App 启动日志增强：DB路径、HTTP地址、路由注册清单

### v1.0.10

- 修复 Legacy `/bars` 接口与 MQL 客户端的时间字段兼容性，接受 Unix 时间戳整数 `time`
- 修复 EA 注册成功后因 `/bars` 返回 `400 invalid JSON` 导致的连续断连
- 新增 `/bars` 整数时间戳回归测试，并通过本地 Docker 构建与容器验收验证

### v1.0.7

- Web 控制台测试工具链显式升级到 `Vite 8.0.8` + `Vitest 4.1.4`
- 保持 `Next.js 15` 生产构建入口不变，`npm run build` 继续使用 `next build`
- 新增前端工具链契约测试，锁定 `Vite 8`、`Vitest 4` 和 Docker Node 基线
- Docker 前端构建镜像升级到 `node:22-bookworm-slim`，满足 `Vite 8` 的 Node 版本要求

### Go Rewrite Milestone

- 完成 Go 服务端主干迁移，MQL4/MQL5 EA 协议保持兼容
- 开发与生产统一切到 SQLite，并通过 `database/sql` 保留 PostgreSQL 迁移准备
- 新增 Next.js + Tailwind CSS 控制台，静态导出后由 Go 统一托管
- 新增 Admin API v1：
  - `/api/v1/overview`
  - `/api/v1/accounts`
  - `/api/v1/accounts/{account_id}`
  - `/api/v1/audit`
  - `/api/v1/events/stream`
- 新增 SSE 事件流，当前 `ai_result` 已发布事件 envelope
- 新增 cutover readiness 聚合：
  - replay parity
  - protocol error rate
  - signal drift
  - command drift
- 完成 replay fixture 校验与 shadow readiness 基础服务
- 新增 Token Admin API、EA 版本查询与下载接口
- AI 兼容链路迁移完成，`analysis_payload` / `ai_result` 行为已对齐当前 Python 基线

### 当前切换状态

- Legacy EA 兼容接口：已落地到 Go
- 策略与持仓管理：已落地到 Go
- 通知与 AI 兼容：已落地到 Go
- 新控制台：已落地到 Go + Next.js
- Cutover readiness：基础能力已就位，默认仍显示 `Baseline Only`

## 2026-04-12

### v1.0.5

#### Bug 修复

- 修复飞书签名算法：改为直接 SHA256 哈希，对齐飞书规范

#### 测试

- 新增 `tests/test_feishu_webhook.py`：飞书 Webhook 连通性测试，无外部依赖

## 2026-03-30

### 既有 Python 版本里程碑

- 飞书推送通知
- AI 分析整点触发
- 市场状态检测
- Discord 推送修复
- divergence `atr_mult` 输出
- 断线重连与 H4/D1 数据补齐
