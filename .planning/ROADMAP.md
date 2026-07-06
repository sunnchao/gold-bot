# ROADMAP.md

**Project:** Go → Node.js Monorepo Rewrite
**Milestone:** Production Parity
**Created:** 2026-07-03

## Phase Overview

| # | Phase | Goal | Effort | Status |
|---|-------|------|--------|--------|
| 1 | Core Trading Logic Parity | SMC/Harmonic/Candlestick/ScaleIn/PerSymbolConfig/Trend | Large | 🔄 Next |
| 2 | Observability & Ops | Prometheus/Migrations/TokenBootstrap/Arbitration | Medium | Pending |
| 3 | Infrastructure Extensions | Discord/Feishu/Redis/PostgreSQL | Medium | Pending |

## Phase Details

### Phase 1 — Core Trading Logic Parity

**Goal:** 补齐所有直接影响信号质量的缺失模块，使 Node.js 策略引擎输出与 Go 引擎对等。

**Requirements:** REWRITE-01 ~ REWRITE-06

**Deliverables:**

| ID | Module | Description | Depends On |
|----|--------|-------------|------------|
| 1A | SMC Detection | `packages/trading-core/src/smc/` — 摆动点/BOS/CHoCH/订单块/FVG/流动性扫荡 | None |
| 1B | Harmonic Patterns | `packages/trading-core/src/harmonic/` — Gartley/Bat/Butterfly/Crab/ABCD | None |
| 1C | Candlestick Patterns | `packages/trading-core/src/indicators/candlestick.ts` — 10 种 K 线形态 | None |
| 1D | Scale-in Strategy | `packages/trading-core/src/replay/` — 加仓信号 + 统一 SL | 1A (SMC context) |
| 1E | Per-Symbol Configs | `packages/trading-core/src/engine/config.ts` — 9 品种 × 6 策略参数 | None |
| 1F | Trend Context Fix | `packages/trading-core/src/replay/` — 手数乘数 + 启用开关 | None |

**Execution Waves:**

```
Wave 1 (parallel):  1A SMC + 1B Harmonic + 1C Candlestick + 1E PerSymbolConfig + 1F TrendFix
Wave 2 (serial):    1D Scale-in (depends on SMC context from 1A)
```

**Files to create/modify:**

New files:
- `packages/trading-core/src/smc/types.ts`
- `packages/trading-core/src/smc/detector.ts`
- `packages/trading-core/src/smc/index.ts`
- `packages/trading-core/src/harmonic/types.ts`
- `packages/trading-core/src/harmonic/detector.ts`
- `packages/trading-core/src/harmonic/index.ts`
- `packages/trading-core/src/indicators/candlestick.ts`
- `packages/trading-core/src/engine/config.ts`
- `packages/trading-core/src/smc/detector.spec.ts`
- `packages/trading-core/src/harmonic/detector.spec.ts`
- `packages/trading-core/src/indicators/candlestick.spec.ts`
- `packages/trading-core/src/engine/config.spec.ts`

Modified files:
- `packages/trading-core/src/index.ts` — re-export new modules
- `packages/trading-core/src/replay/replay.ts` — integrate all new modules
- `packages/trading-core/src/indicators/index.ts` — re-export candlestick
- `packages/shared-contracts/src/strategy.ts` — add `scale_in`
- `apps/app-server/src/app.ts` — SMC/harmonic/candlestick in analysisPayload

**Success Criteria:**

- [ ] SMC 检测函数对 Go 测试用例输出一致
- [ ] 谐波形态检测对 Go 测试用例输出一致
- [ ] K 线形态检测对 Go 测试用例输出一致
- [ ] scale_in 策略产生信号，统一 SL 计算正确
- [ ] 9 个品种各有独立策略配置
- [ ] 趋势惩罚同时影响分数和手数
- [ ] 所有新模块有单元测试
- [ ] Shadow 模式下 Node.js 和 Go 对相同输入产生一致输出

**Risks:**

- SMC/谐波检测算法复杂，数值精度差异可能导致 shadow drift
- Go 的策略参数经过实战调优，Node.js 必须精确复制而非近似
- replay.ts 已有 ~2900 行，新增代码需注意可维护性

---

### Phase 2 — Observability & Ops

**Goal:** 补齐生产运维必需的可观测性和基础设施模块。

**Requirements:** REWRITE-07, REWRITE-10, REWRITE-11, REWRITE-12

**Deliverables:**

| ID | Module | Description | Depends On |
|----|--------|-------------|------------|
| 2A | Prometheus Metrics | 20+ 实时指标 + HTTP 中间件 + DB 采集器 | None |
| 2B | DB Migrations | 版本化 SQL 迁移框架 | None |
| 2C | Token Bootstrap | 环境变量种子 + legacy JSON 导入 | None |
| 2D | Arbitration Manager | 自动轮询等待 + 高分自动通过 | None |

**Execution Waves:**

```
Wave 1 (parallel):  2A + 2B + 2C + 2D (all independent)
```

**Files to create/modify:**

New files:
- `packages/observability/src/metrics.ts` — Prometheus 指标定义
- `packages/observability/src/metrics-middleware.ts` — HTTP 中间件
- `packages/observability/src/metrics-collector.ts` — DB 采集器
- `packages/persistence/src/migrations/` — SQL 迁移文件
- `packages/persistence/src/migrate.ts` — 迁移执行器
- `apps/app-server/src/services/arbitration/manager.ts` — 仲裁管理器

Modified files:
- `apps/app-server/src/app.ts` — 集成指标中间件、token 引导、仲裁管理器
- `apps/app-server/src/index.ts` — 启动迁移
- `packages/persistence/src/index.ts` — 迁移框架
- `packages/observability/src/index.ts` — re-export

**Success Criteria:**

- [ ] `/metrics` 返回 20+ 实时 Prometheus 指标
- [ ] HTTP 中间件记录请求耗时和状态码
- [ ] DB 迁移版本追踪正确
- [ ] `GB_ADMIN_TOKEN` 环境变量正确种子 admin token
- [ ] 仲裁管理器 30s 超时后高分自动通过
- [ ] 所有新模块有测试

---

### Phase 3 — Infrastructure Extensions

**Goal:** 补齐通知集成和数据库扩展支持。

**Requirements:** REWRITE-08, REWRITE-09, REWRITE-13, REWRITE-14

**Deliverables:**

| ID | Module | Description | Depends On |
|----|--------|-------------|------------|
| 3A | Discord Notifications | Webhook + 冷却 + 异步 | None |
| 3B | Feishu Notifications | Webhook + HMAC + 卡片 | None |
| 3C | Redis Breakout Cache | Redis 客户端 + 降级 | None |
| 3D | PostgreSQL Support | pg store + 方言切换 | 2B (migrations) |

**Execution Waves:**

```
Wave 1 (parallel):  3A + 3B + 3C (all independent)
Wave 2 (serial):    3D PostgreSQL (depends on 2B migrations)
```

**Success Criteria:**

- [ ] Discord webhook 正确发送通知，15min 冷却生效
- [ ] Feishu webhook 正确签名和发送卡片，10min 冷却生效
- [ ] Redis cache Set/Get/Del 正常，不可用时降级到内存
- [ ] PostgreSQL store 通过与 SQLite 相同的接口测试
- [ ] 所有新模块有测试

---

## Dependency Graph

```
Phase 1 (Core Trading Logic)
    ├── Wave 1 (parallel): 1A SMC, 1B Harmonic, 1C Candlestick, 1E PerSymbolConfig, 1F TrendFix
    └── Wave 2 (serial):   1D Scale-in ← depends on 1A SMC

Phase 2 (Observability & Ops)
    └── Wave 1 (parallel): 2A Prometheus, 2B Migrations, 2C TokenBootstrap, 2D Arbitration

Phase 3 (Infrastructure Extensions)
    ├── Wave 1 (parallel): 3A Discord, 3B Feishu, 3C Redis
    └── Wave 2 (serial):   3D PostgreSQL ← depends on 2B Migrations
```

---
*Last updated: 2026-07-03*
