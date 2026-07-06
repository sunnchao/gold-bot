# Gold Bot — Go to Node.js Monorepo Rewrite

## What This Is

将 Go 1.24 交易引擎完整重写为 Node.js/TypeScript monorepo。目标是在生产环境中用 Node.js app-server 完全替代 Go engine，同时保持与所有现有 EA 客户端（MT4/MT5）的向后兼容。

Core Value: 统一技术栈为 TypeScript，消除 Go/Node 双语言运维负担，实现生产级功能对等。

## Current State

- **已完成 ~70% 功能对等**：核心 HTTP 服务、EA 兼容路由、Admin API、AI 集成、持久层、6 策略交易核心、风控门、仓位管理、Shadow/Cutover
- **25 个测试文件**通过
- **Shadow 模式**可运行，用于对比 Go 和 Node.js 输出

## Requirements

### Validated (Already Shipped in Node.js)

- EA 兼容路由 (`/register`, `/heartbeat`, `/tick`, `/bars`, `/positions`, `/poll`, `/order_result`)
- Admin API (账户列表/详情、overview、token CRUD、决策事件、审计)
- AI 结果处理 (v1/v2 分析载荷 + AI 结果接收 + trade plan 验证)
- 指标告警 (store/poll + TTL 去重)
- Visual poll (tick + AI 摘要 + 告警)
- SSE 事件流
- EA 版本/下载端点
- 市场过滤器
- Replay 引擎 (6 策略 + 仓位管理 + AI SL/TP 覆盖)
- 风控门 (市场状态/点差/SL 距离/仓位冲突/手数限制)
- 仓位管理 (BE/TP1/TP2/关键位/趋势反转/动态追踪/momentum_scalp 退出)
- 持久层 (内存 + SQLite，覆盖全部 CRUD)
- Shadow/Cutover 基础设施
- AI Approve 流水线 (trade plan 验证 + pending gate + command 构建)
- 技术指标 (EMA/ATR/RSI/MACD/ADX/BB/Stoch/Fib/Pivot/背离检测)
- 认证中间件

### Active (Missing — Must Build)

- [ ] **REWRITE-01**: scale_in 策略信号生成器 + 统一 SL 计算
- [ ] **REWRITE-02**: SMC 检测 (摆动点/BOS/CHoCH/订单块/FVG/流动性扫荡)
- [ ] **REWRITE-03**: 谐波形态检测 (Gartley/Bat/Butterfly/Crab/ABCD)
- [ ] **REWRITE-04**: K 线形态检测 (10 种形态)
- [ ] **REWRITE-05**: 逐品种策略配置 (全部 6 策略 × 9 品种)
- [ ] **REWRITE-06**: 趋势上下文补全 (手数乘数 + 可配置开关)
- [ ] **REWRITE-07**: Prometheus 真实指标 (20+ 指标 + HTTP 中间件 + DB 采集器)
- [ ] **REWRITE-08**: Discord 通知集成
- [ ] **REWRITE-09**: Feishu 通知集成
- [ ] **REWRITE-10**: DB 迁移框架 (版本化 SQL 迁移)
- [ ] **REWRITE-11**: Token 引导补全 (环境变量种子 + legacy JSON 导入)
- [ ] **REWRITE-12**: 仲裁管理器自动轮询循环
- [ ] **REWRITE-13**: Redis Breakout Cache (可选)
- [ ] **REWRITE-14**: PostgreSQL 支持 (可选)

### Out of Scope

| Feature | Reason |
|---------|--------|
| 全量重写 agents/ | 独立 NestJS 服务，不在本次重写范围 |
| Dashboard 前端重写 | Next.js 静态导出，Go/Node 均只做静态文件服务 |
| EA MQL 客户端改动 | 必须保持向后兼容，零改动 |
| Legacy Python 脚本 | 已弃用，不迁移 |

## Constraints

- **技术栈**: Node.js 20+, TypeScript strict, pnpm monorepo + Turborepo
- **无外部 HTTP 框架**: 继续使用 `node:http`，与现有代码风格一致
- **向后兼容**: 所有 EA 端点 API 合约不可变
- **测试要求**: 每个新模块必须附带测试
- **Shadow 优先**: 新功能先在 shadow 模式验证，再 cutover
- **SQLite 优先**: PostgreSQL 为可选项，不影响核心功能

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 策略核心放在 `packages/trading-core/` | 独立包可被 app-server 和未来工具共用 | ✓ Good |
| SMC/谐波形态作为 trading-core 子模块 | 与 indicators 同级，策略引擎消费 | — Pending |
| Prometheus 用 `prom-client` npm 包 | Node.js 生态标准，与 Go 的 prometheus/client_golang 对等 | — Pending |
| DB 迁移用内联版本化 SQL | 轻量级，不引入额外依赖 | — Pending |
| Redis breakout cache 可选降级 | 与 Go 行为一致，Redis 不可用时回退到内存 | — Pending |

---
*Created: 2026-07-03*
