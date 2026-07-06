# Requirements: Go → Node.js Rewrite Feature Parity

**Defined:** 2026-07-03
**Core Value:** Node.js app-server 完全替代 Go engine，生产级功能对等

---

## P0 — 核心交易逻辑缺口（直接影响信号质量）

### REWRITE-01: scale_in 策略 + 统一 SL

- [ ] **SI-01**: `scaleInSignal()` 信号生成器 — 检测浮亏同方向加仓条件
- [ ] **SI-02**: `calculateUnifiedSL()` — 加权均价 + 统一止损计算
- [ ] **SI-03**: `roundDownScaleInLot()` — 加仓手数向下取整
- [ ] **SI-04**: `ReplayStrategyName` 类型新增 `'scale_in'`
- [ ] **SI-05**: `shared-contracts/strategy.ts` 新增 `scale_in` 策略名
- [ ] **SI-06**: replay.ts 集成 scale_in 策略评估
- [ ] **SI-07**: 单元测试 + replay 集成测试

### REWRITE-02: SMC 检测

- [ ] **SMC-01**: `findSwingPoints()` — 摆动高低点识别
- [ ] **SMC-02**: `detectStructureBreaks()` — BOS/CHoCH 结构突破检测
- [ ] **SMC-03**: `detectOrderBlocks()` — 订单块检测 + 有效性追踪
- [ ] **SMC-04**: `detectFVGs()` — Fair Value Gap 检测 + 填充追踪
- [ ] **SMC-05**: `detectLiquiditySweeps()` — 流动性扫荡检测
- [ ] **SMC-06**: `buildSMCContext()` — 多时间帧 SMC 上下文聚合 (H4+H1)
- [ ] **SMC-07**: 辅助函数 `hasCHOCHInDirection()`, `recentSweepInDirection()`, `validOBsNearPrice()`, `unfilledFVGsNearPrice()`
- [ ] **SMC-08**: 类型定义 (`SwingPoint`, `StructureBreak`, `FVG`, `OrderBlock`, `LiquiditySweep`, `SMCContext`)
- [ ] **SMC-09**: replay.ts 中 counter_pullback/breakout_pyramid 策略消费 SMC 上下文
- [ ] **SMC-10**: analysisPayload() 中构建 SMC 上下文
- [ ] **SMC-11**: 单元测试 (每个检测函数)

### REWRITE-03: 谐波形态检测

- [ ] **HARM-01**: `detectHarmonicPatterns()` — Gartley/Bat/Butterfly/Crab/ABCD 检测
- [ ] **HARM-02**: XABCD 点位验证 + PRZ (Potential Reversal Zone) 计算
- [ ] **HARM-03**: `buildHarmonicContext()` — 多时间帧谐波上下文 (H4/H1/M30)
- [ ] **HARM-04**: 方向偏好推导 + 评分/置信度
- [ ] **HARM-05**: 类型定义 (`HarmonicPattern`, `HarmonicContext`, PRZ zone, SL/TP)
- [ ] **HARM-06**: replay.ts 中策略引擎消费谐波上下文
- [ ] **HARM-07**: analysisPayload() 中构建谐波上下文 (替换 `harmonic_context: null`)
- [ ] **HARM-08**: 单元测试

### REWRITE-04: K 线形态检测

- [ ] **CANDLE-01**: 单 K 线形态 (Hammer, Shooting Star)
- [ ] **CANDLE-02**: 双 K 线形态 (Bullish Engulfing, Bearish Engulfing, Piercing Line, Dark Cloud Cover)
- [ ] **CANDLE-03**: 三 K 线形态 (Morning Star, Evening Star, Three White Soldiers, Three Black Crows)
- [ ] **CANDLE-04**: `detectAllCandlestickPatterns()` + `patternStrength()` 质量评分
- [ ] **CANDLE-05**: indicators 模块集成
- [ ] **CANDLE-06**: replay.ts 中策略引擎消费 K 线形态
- [ ] **CANDLE-07**: 单元测试

### REWRITE-05: 逐品种策略配置

- [ ] **SYM-01**: `StrategyConfig` 类型定义 (30+ 可调参数)
- [ ] **SYM-02**: `strategyConfigForSymbol()` 工厂函数
- [ ] **SYM-03**: XAUUSD 配置 (GoldStrategyConfig)
- [ ] **SYM-04**: XAGUSD 配置 (SilverStrategyConfig)
- [ ] **SYM-05**: GBPJPY 配置 (GBPJPYStrategyConfig)
- [ ] **SYM-06**: EURJPY/USDJPY 配置 (JPYCrossStrategyConfig)
- [ ] **SYM-07**: EURUSD 配置 (EURUSDStrategyConfig)
- [ ] **SYM-08**: GBPUSD 配置 (GBPUSDStrategyConfig)
- [ ] **SYM-09**: USDCAD 配置 (USDCADStrategyConfig)
- [ ] **SYM-10**: US100CASH 配置 (US100CashStrategyConfig)
- [ ] **SYM-11**: USOILCASH/UKOILCASH 配置 (OilStrategyConfig)
- [ ] **SYM-12**: replay.ts 中所有 6 策略使用逐品种配置
- [ ] **SYM-13**: 单元测试 (每个品种配置验证)

### REWRITE-06: 趋势上下文补全

- [ ] **TREND-01**: `ApplyTrendRating` 新增手数乘数 (0.7/1.0)
- [ ] **TREND-02**: `TrendConfig` 可配置启用/禁用开关
- [ ] **TREND-03**: replay.ts 中应用手数乘数
- [ ] **TREND-04**: 单元测试

---

## P1 — 运维可观测性（生产环境必需）

### REWRITE-07: Prometheus 真实指标

- [ ] **PROM-01**: 引入 `prom-client` npm 依赖
- [ ] **PROM-02**: 信号指标 (`goldbot_signals_total`, `goldbot_signal_score`)
- [ ] **PROM-03**: 订单指标 (`goldbot_orders_total`, `goldbot_order_latency_seconds`, `goldbot_order_profit_usd`)
- [ ] **PROM-04**: 账户指标 (`goldbot_account_equity_usd`, `goldbot_account_balance_usd`, `goldbot_account_positions`, `goldbot_account_floating_pl_usd`, `goldbot_account_daily_pl_usd`)
- [ ] **PROM-05**: EA 指标 (`goldbot_ea_last_heartbeat_timestamp`, `goldbot_ea_heartbeats_total`, `goldbot_ea_ticks_total`)
- [ ] **PROM-06**: HTTP 指标 (`goldbot_http_requests_total`, `goldbot_http_request_duration_seconds`)
- [ ] **PROM-07**: DB 指标 (`goldbot_db_query_duration_seconds`, `goldbot_db_queries_total`, `goldbot_db_connections_open`, `goldbot_db_connections_in_use`)
- [ ] **PROM-08**: 策略指标 (`goldbot_strategy_execution_seconds`, `goldbot_strategy_win_rate`)
- [ ] **PROM-09**: 风控指标 (`goldbot_risk_gate_rejections_total`, `goldbot_spread_points`)
- [ ] **PROM-10**: HTTP 中间件 (请求耗时 + 状态码 + 路径归一化)
- [ ] **PROM-11**: DB 采集器 (定期采集连接池状态)
- [ ] **PROM-12**: `/metrics` 端点替换硬编码 stub
- [ ] **PROM-13**: 集成测试

### REWRITE-10: DB 迁移框架

- [ ] **MIG-01**: 版本化 SQL 迁移文件 (0001_init ~ 0007_decision_timeline)
- [ ] **MIG-02**: `schema_migrations` 追踪表
- [ ] **MIG-03**: `runMigrations()` 执行器
- [ ] **MIG-04**: SQLite store 启动时自动运行迁移
- [ ] **MIG-05**: 迁移测试

### REWRITE-11: Token 引导补全

- [ ] **TOKEN-01**: `GB_ADMIN_TOKEN` 环境变量种子 admin token
- [ ] **TOKEN-02**: 导入 legacy `tokens.json` 文件
- [ ] **TOKEN-03**: 启动时自动执行引导
- [ ] **TOKEN-04**: 测试

### REWRITE-12: 仲裁管理器自动轮询

- [ ] **ARB-01**: `ArbitrationManager` 类 — 提交信号 + 等待结果
- [ ] **ARB-02**: 轮询循环 (1s 间隔, 30s 超时)
- [ ] **ARB-03**: 高分自动通过 (score >= 8)
- [ ] **ARB-04**: 过期信号处理
- [ ] **ARB-05**: 集成测试

---

## P2 — 基础设施扩展（按需启用）

### REWRITE-08: Discord 通知

- [ ] **DISC-01**: Discord webhook 发送器
- [ ] **DISC-02**: 15 分钟冷却
- [ ] **DISC-03**: 异步 fire-and-forget
- [ ] **DISC-04**: 测试

### REWRITE-09: Feishu 通知

- [ ] **FEI-01**: Feishu webhook 发送器
- [ ] **FEI-02**: HMAC-SHA256 签名
- [ ] **FEI-03**: 10 分钟冷却
- [ ] **FEI-04**: 交互式卡片格式
- [ ] **FEI-05**: 测试

### REWRITE-13: Redis Breakout Cache

- [ ] **REDIS-01**: Redis 客户端连接 (`REDIS_URL`)
- [ ] **REDIS-02**: `Set/Get/Del` + 1h TTL
- [ ] **REDIS-03**: 不可用时降级到内存
- [ ] **REDIS-04**: breakout_pyramid 策略集成
- [ ] **REDIS-05**: 测试

### REWRITE-14: PostgreSQL 支持

- [ ] **PG-01**: `pg` npm 依赖
- [ ] **PG-02**: PostgreSQL store 实现 (与 SQLite 同接口)
- [ ] **PG-03**: SQL 方言切换 (占位符 `$1` vs `?`)
- [ ] **PG-04**: `DSN` 环境变量支持
- [ ] **PG-05**: 连接池配置 (max 20 open / 5 idle)
- [ ] **PG-06**: 测试

---

## Traceability

| Requirement | Phase | Priority |
|-------------|-------|----------|
| REWRITE-01 (SI-01~07) | Phase 1 | P0 |
| REWRITE-02 (SMC-01~11) | Phase 1 | P0 |
| REWRITE-03 (HARM-01~08) | Phase 1 | P0 |
| REWRITE-04 (CANDLE-01~07) | Phase 1 | P0 |
| REWRITE-05 (SYM-01~13) | Phase 1 | P0 |
| REWRITE-06 (TREND-01~04) | Phase 1 | P0 |
| REWRITE-07 (PROM-01~13) | Phase 2 | P1 |
| REWRITE-10 (MIG-01~05) | Phase 2 | P1 |
| REWRITE-11 (TOKEN-01~04) | Phase 2 | P1 |
| REWRITE-12 (ARB-01~05) | Phase 2 | P1 |
| REWRITE-08 (DISC-01~04) | Phase 3 | P2 |
| REWRITE-09 (FEI-01~05) | Phase 3 | P2 |
| REWRITE-13 (REDIS-01~05) | Phase 3 | P2 |
| REWRITE-14 (PG-01~06) | Phase 3 | P2 |

---
*Requirements defined: 2026-07-03*
