# Gold Bot 优化方案 v3.0
> 基于代码静态分析 + 17天实盘数据（2026-07-08 ~ 07-24）  
> 制定日期：2026-07-26

## 实施进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 1（执行层止血） | ✅ 已完成 2026-07-26 | 4 项全部落地，typecheck + 测试通过 |
| Phase 2（度量基础设施） | ✅ 已完成 2026-07-26 | 2.1–2.4 全部落地；2.4 见下方看板说明 |
| Phase 3（信号质量） | ✅ 已完成 2026-07-26 | 3.1–3.6 全部落地，见下方改动清单 |
| Phase 4（AI 链路） | 🟡 4.1/4.2/4.3 已完成 2026-07-26 | 4.4 需 closed_trades 数据积累后再做 |
| Phase 5（风控加固） | 🟡 5.1/5.2/5.3 已完成 2026-07-26 | 5.4/5.5 需 closed_trades 数据积累后再做 |

**Phase 1+2 改动清单**
- `apps/app-server/src/services/command-lifecycle/service.ts` — 4108 即删幽灵 position_states
- `apps/app-server/src/services/ai-approve/gate.ts` — R:R ≥ 1.2 下限过滤（市价单按执行价、限价单按挂单价计算）
- `apps/app-mt/mt4_ea/GoldBolt_Client.mq4` — 部分平仓、挂单读 cmd.lots + 补风控、`SendTradeHistory()`
- `apps/app-mt/mt5_ea/GoldBolt_Client.mq5` — `SendTradeHistory()`（基于 deal，反查 DEAL_ENTRY_IN 取开仓价）
- `packages/persistence/src/migrations/0011_closed_trades.sql` + `index.ts` / `postgres.ts` — closed_trades 表与统计
- `apps/app-server/src/app.ts` — `POST /api/trade_history`，联通 ordersTotal / orderProfit / strategyWinRate

**已知遗留**：`app.spec.ts` 有 6 个先行失败用例（策略映射 + trading-core 断言），经 `git stash` 前后比对确认与本次改动无关，未处理。

**Phase 3 改动清单（2026-07-26）**- 3.1 `packages/trading-core/src/indicators/index.ts` — enrichBars 计算真实 stoch_k / vol_sma（消除 divergence 系统性做多偏差）
- 3.2 `apps/app-server/src/services/scheduler/service.ts` — `queueReplaySignal` 接入 `evaluateMarketFilters`，blocking（点差过宽/周五尾盘/tick 过期/市场关闭）直接丢弃信号并打 `signal_blocked_by_market_filter` 日志
- 3.3 `packages/trading-core/src/replay/replay.ts` — 谐波加分量纲修复（0-100 分制：<30 忽略，≥70 +2，其余 +1）
- 3.4 `packages/trading-core/src/replay/replay.ts` — breakout_pyramid 接入 `confirmBreakoutPyramid` M30 二次确认（仅实盘 symbol 路径启用，回放/测试无 symbol 保持确定性）
- 3.5 `apps/app-server/src/services/scheduler/service.ts` — **实盘数据修正了计划假设**：US100Cash breakout_retest 失败 10/11 是 `strategy_disabled`（EA 侧开关关闭），不是 stoplevel。修复为服务端消费心跳 `strategies.{name}.enabled`，明确 false 时跳过下发（默认放行，ai_signal/scale_in 不在心跳块内）
- 3.6 `packages/trading-core/src/replay/replay.ts` — H4 ADX 否决双档 `GB_H4_ADX_FILTER_MODE=hard|soft`，默认恢复 hard（震荡市禁入）；`.env.example` 已加注释

**Phase 4 改动清单（2026-07-26）**
- 4.1 `apps/app-server/src/services/ai-approve/gate.ts` — 每品种每 UTC 日 AI 信号限额 2 笔（`daily_limit.symbol` 拒绝；queued/delivered/acked/failed/superseded 计入，draft/shadow_only/rejected 不计）
- 4.2 `apps/app-agent/src/agents/comprehensive-analyst.ts` — Markdown+JSON 双解析都失败时，追加一次强制 tool_use 结构化重试（`submit_comprehensive_analysis` 工具，input_schema 由 `ComprehensiveAnalysisDataSchema` 经 zod-to-json-schema 生成），仍失败才落 `buildFallback`；新增依赖 `zod-to-json-schema`
- 4.3 `apps/app-server/src/app.ts` — `AI_APPROVE_QUEUE_MIN_CONFIDENCE` 55 → 65
- 4.4 未做：需 closed_trades 数据积累（Phase 2 上线后约 2 周）

**Phase 2.4 看板说明（2026-07-26）**
- 新增 `grafana/dashboards/gold-bot-performance.json`（uid `gold-bot-performance`，「Gold Bot - 交易绩效」，8 面板）；provisioning 是目录级 file provider，自动加载无需登记
- 受现有指标 label 约束的偏差：`goldbot_orders_total` / `goldbot_order_profit_usd` 均无 strategy label，「按策略分组的盈亏」不可行，策略维度由 `goldbot_strategy_win_rate` gauge 承接；R 倍数分布以 USD 盈亏 histogram 代理
- 全仓无按错误码（4108/130）打点的指标，`/order_result` 不增 metric，`goldbot_risk_gate_rejections_total` 注册了但从未 inc（空壳）。执行质量面板暂用 HTTP 4xx/5xx 错误率 + 亏损单占比代替
- 后续增强（已完成 2026-07-26，见下方 metrics 增强清单）：给 `goldbot_order_profit_usd` 加 strategy label；`/order_result` 路径新增带 error_code label 的 counter

**Phase 5 改动清单（2026-07-26）**
- 5.1 日损熔断：`packages/persistence` 新增 `daily_equity` 表（migration 0012，PK (account_id, utc_date)，首写不覆盖）+ `getDailyStartEquity`/`saveDailyStartEquity`（内存/SQLite/Postgres 三实现，PG 用 `ON CONFLICT DO NOTHING`）；`packages/config` 新增 `GB_MAX_DAILY_LOSS_PCT`（默认 0.05）；`apps/app-server/src/services/scheduler/service.ts` `canRunLiveAnalysis` 接入 `passesDailyLossGuard`——当日首个心跳 equity 作基线，回撤 ≥ 阈值即停当日实盘分析（`daily_loss_guard_blocked` 日志），UTC 日切自然复位
- 5.2 信号手数风控钳制：scheduler `queueReplaySignal` 经 `allowedLotsForSignal`（复用 trading-core `evaluateRiskGate`，与 app.ts AI 路径同数据流）对 `signal.lots` 取 `min(signal, allowed)`，钳制时打 `signal_lots_clamped` 日志；riskgate 数据不足时不钳制
- 5.3 STOPLEVEL 距离改为按品种：`STOPLEVEL_MIN_RATIO_DEFAULT=0.0005` + `GBPJPY=0.0012`（`stoplevelMinRatio()` 归一化 symbol，剥离 `M#`/`#` 券商后缀）
- scheduler 测试 21 → 28（3 日损 + 2 钳制 + 2 stoplevel）
- 5.4（scale_in 优化）/ 5.5（GB_AI_TRAIL_SYMBOLS 扩展）未做：closed_trades 表在生产尚不存在（`to_regclass` 为 null，等 Phase 2 部署后积累数据）

**Metrics 增强清单（2026-07-26，Phase 2.4 后续）**
- `packages/observability/src/metrics.ts` — `goldbot_orders_total` / `goldbot_order_profit_usd` 增加 `strategy` label（prom-client 允许旧调用点用 label 子集，向后兼容）；新增 `goldbot_command_results_total{account_id, result, error_code}` counter
- `apps/app-server/src/app.ts` — `/api/trade_history` 打点带上 `strategy: trade.strategy`；`onOrderResult` 回调 inc `commandResultsTotal`（纯数字错误码原样保留如 4108/130，成功为 `none`，非数字文本归 `other` 防 label 基数爆炸）
- `grafana/dashboards/gold-bot-performance.json` — PromQL 升级为 strategy 维度 + 新增错误码趋势/命令成功率面板

---

## 执行摘要

当前系统的核心问题不是"策略不好"，而是**执行层有两个结构性 bug 正在主动破坏盈亏比**，加上**完全没有结果度量**导致无法判断任何改进的效果。

实盘数据关键指标：
- 17天内执行命令 1202 条，其中 **672 条失败（56%）**
- 失败里 **73% 来自单一幽灵仓位**（42275433，13小时500条无效命令）
- AI 信号中约 **40% 的 R:R < 1.0**（最低 0.25），数学期望接近负值
- 技术策略执行成功 99 笔，**TP/lots 全部由 EA 自算**（服务端 TP 控制无效）
- MT4 部分平仓实际执行全平，服务端的阶梯出场设计完全失效
- 平仓后无任何盈亏记录，**317笔已执行订单的实际结果一无所知**

---

## Phase 1：止血——执行层 Bug 修复（本周，P0）

### 1.1 幽灵仓位：4108 即删 position_states

**问题**：EA 内置 TP/SL 触发平仓后，服务端不知情，position_states 行保留，
PM 每分钟对死ticket 发CLOSE命令，连续13小时产生500条ERROR 4108。
7月13日单日误差占全部历史错误的73%。

**修复**：`apps/app-server/src/services/command-lifecycle/service.ts`
当命令回报 result=ERROR 且 error_text='4108' 时，立即调用
`store.deletePositionState(accountId, symbol, ticket)` 并取消同ticket的所有待投递命令。

```typescript
// command-lifecycle/service.ts — onCommandAcked / onCommandFailed
if (result.error === '4108') {
  await store.deletePositionState(accountId, symbol, ticket);
  await store.cancelPendingCommandsByTicket(accountId, ticket);
  log.warn({ ticket }, 'ticket gone (4108), position_states cleaned');
}
```

**预期效果**：消除 73% 的历史执行错误，停止无效 LLM/PM 计算循环。

---

### 1.2 限价单手数超配：ExecutePending 读 cmd.lots

**问题**：`apps/app-mt/mt4_ea/GoldBolt_Client.mq4:1447-1451`
`ExecutePending` 用 `CalcLotsForStrategy` 计算手数（= FixedLots 0.10），
完全忽略服务端下发的 `cmd.lots`（= 0.01）。
实盘数据：修复后仍有2笔 0.03 手限价单，确认漏洞存在。

**修复**：在 `ExecutePending` 入口读取 `cmd.lots`：

```mql4
// mt4_ea/GoldBolt_Client.mq4 — ExecutePending()
double lots = CalcLotsForStrategy(strategy, baseSymbol, sl_distance);
double cmdLots = GetJsonDouble(cmd, "lots");
if (cmdLots > 0.009) lots = NormalizeVolume(brokerSymbol, cmdLots);
// 同步补调 CheckRisk
if (!CheckRisk(symbol, lots, type == OP_BUY ? 1 : -1)) {
  ReportResult(cmdId, "REJECTED", 0, "risk_check_failed");
  return;
}
```

同步 MT5（`mq5:1696-1702`）。

---

### 1.3 MT4 部分平仓：实现 CLOSE_PARTIAL

**问题**：`mq4:1707` `OrderClose(ticket, OrderLots(), ...)` 无视 `cmd.lots`，
所有 CLOSE 命令全部全平。服务端精心设计的 TP1/TP2/时间止损阶梯全部失效，
实际盈亏比被压到约 1:1。

**修复**：在 `ExecuteClose` 里读取 `cmd.lots`；
新增 `CLOSE_PARTIAL` action 处理器（仿照 MT5 已有的实现）：

```mql4
// ExecuteClose() 修改
double closeLots = GetJsonDouble(cmd, "lots");
if (closeLots <= 0 || closeLots >= OrderLots()) closeLots = OrderLots(); // 全平
bool result = OrderClose(ticket, NormalizeVolume(sym, closeLots), closePrice, Slippage, clrRed);
```

MT5 已有 `CLOSE_PARTIAL`，对齐即可。**此修复是恢复盈亏比设计意图的最高优先级改动。**

---

### 1.4 AI 信号最低 R:R 过滤器

**问题**：实盘数据显示40笔AI信号中约14笔 R:R < 1.0（含 0.25、0.35、0.48），
对应的入场逻辑是：TP 距离 < SL 距离，即使全胜也跑不赢止损。
`rules.ts` 和 `gate.ts` 没有任何 R:R 下限检查。

**修复**：在 `apps/app-server/src/services/ai-approve/gate.ts` 的
`evaluateAIApprovePendingGate` 里增加 R:R 检查：

```typescript
// gate.ts — 在 entry.too_far_from_market 检查之前
const rrRatio = side === 'BUY'
  ? (tp - entry) / Math.abs(entry - sl)
  : (entry - tp) / Math.abs(entry - sl);
if (rrRatio < MIN_RR_RATIO) {
  return reject('rr.below_minimum', `R:R=${rrRatio.toFixed(2)} < ${MIN_RR_RATIO}`);
}
```

`MIN_RR_RATIO = 1.2`（基于当前数据分布，1.2 过滤掉约40%的低质信号，
同时保留 R:R 1.2~6.0 的全部信号）。

---

## Phase 2：度量基础设施——让一切可验证（第2周，P0）

没有数据，没有优化。317笔已执行订单的实际结果目前一条都查不到。

### 2.1 EA 上报已平仓成交

**问题**：EA 从不调用 `HistorySelect`，平仓后服务端对盈亏一无所知。

**修复**：在 MT4/MT5 EA 的 `OnTimer` 里遍历最近平仓订单，
上报到新的 `POST /api/trade_history` 端点：

```mql4
// MT4 OnTimer() — 每5分钟扫一次历史
void ReportClosedTrades() {
  int total = OrdersHistoryTotal();
  for (int i = total - 1; i >= 0; i--) {
    if (!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
    if (OrderCloseTime() < lastReportedCloseTime) break;
    // 上报：ticket, magic, symbol, type, openPrice, closePrice,
    //       lots, profit, swap, commission, openTime, closeTime
    string payload = BuildTradeHistoryPayload(i);
    HttpPost(serverUrl + "/api/trade_history", payload);
  }
  lastReportedCloseTime = TimeCurrent();
}
```

### 2.2 服务端新增 closed_trades 表

```sql
CREATE TABLE closed_trades (
  id            BIGSERIAL PRIMARY KEY,
  account_id    TEXT NOT NULL,
  ticket        BIGINT NOT NULL,
  magic         BIGINT,
  symbol        TEXT NOT NULL,
  strategy      TEXT,       -- 从 magic 反查或 comment 解析
  side          TEXT,       -- BUY / SELL
  open_price    REAL,
  close_price   REAL,
  lots          REAL,
  profit        REAL,       -- 已实现盈亏（含swap/commission）
  open_time     TIMESTAMPTZ,
  close_time    TIMESTAMPTZ,
  duration_min  INTEGER,
  r_multiple    REAL,       -- profit / (|open-sl| * lots * contract)
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, ticket)
);
CREATE INDEX ON closed_trades(account_id, strategy, close_time);
```

### 2.3 填充空壳 Prometheus 指标

`packages/observability/src/metrics-collector.ts` 里在每次收到
trade_history 上报时更新：

```typescript
goldbot_orders_total.inc({ account_id, symbol, side, result: profit > 0 ? 'win' : 'loss' });
goldbot_order_profit_usd.observe({ account_id, symbol, strategy }, profit);
// 定期聚合（每小时）
goldbot_strategy_win_rate.set({ account_id, strategy }, wins / (wins + losses));
```

### 2.4 Grafana 绩效看板

新增面板：
- **策略胜率**：按策略分组的 win/loss 堆叠柱状图
- **日盈亏曲线**：`SUM(profit) GROUP BY day, strategy`
- **R 倍数分布**：直方图，标注 1.0/1.5/2.0 分位线
- **执行质量**：4108/130 错误率趋势

**Phase 2 完成标志**：能从 Grafana 查到按策略分组的胜率和期望值，
`goldbot_strategy_win_rate` 有真实数据而非空白。

---

## Phase 3：信号质量提升（第3-4周，P1）

### 3.1 修复实盘 stoch_k 数据——消除不对称加分偏差

**问题**：`packages/trading-core/src/indicators/index.ts:821`
`stoch_k = bar.stoch_k ?? 0`，EA 只发 OHLCV，实盘中 `stoch_k` 恒为0。
divergence 策略的 `stoch_k < 20` 加分（`replay.ts:2459`）对 BUY 永远成立、
对 SELL 永远不成立——系统性偏向做多。

**修复**：在 `enrichBars` 里计算真实随机指标：
```typescript
// packages/trading-core/src/indicators/index.ts — enrichBars()
const stochResult = stochastic(closes, highs, lows, 14, 3);
bar.stoch_k = stochResult.k[i];
```
同步修复 `vol_sma`（当前 undefined，导致3个策略的成交量确认加分静默失效）。

### 3.2 把市场过滤器接入技术信号路径

**问题**：`evaluateMarketFilters`（点差/展期/周五尾盘/ATR扩张）
只用于填充 LLM payload，从不过滤技术信号（`scheduler/service.ts:72-74`
只检查 `market_open && is_trade_allowed`）。

**修复**：在 `SchedulerService.queueReplaySignal` 里调用过滤器：
```typescript
const filters = evaluateMarketFilters(accountState, tick, bars);
if (filters.some(f => f.blocking)) return; // 阻断拦截
```
实盘数据：周五尾盘（friday_close_window）每周约有96次分析在禁止时段运行，
接入后这些信号将被拦截。

### 3.3 修复谐波加分量纲错误

**问题**：`replay.ts:1918` 阈值 5/8 对应的是0-100分量纲，
任何方向一致的谐波形态（典型分40-90）都拿满+2，质量分无效化。

**修复**：
```typescript
const score = pattern.score; // 0-100 scale
if (score < 30) return 0;    // 弱形态忽略
return score >= 70 ? 2 : 1;  // 高质量+2，中等+1
```

### 3.4 恢复 confirmBreakoutPyramid M30 二次确认

`confirmBreakoutPyramid`（`packages/breakout-cache/src/breakout-cache.ts:91`）
import了但从未调用。文档称可减少~30%假突破。在 `evaluateBreakoutPyramidSignal`
末尾接入即可，5行代码。

### 3.5 breakout_retest US100Cash 专项修复

实盘数据：7月23-24日 breakout_retest US100Cash 失败率 92%（11/12笔 ERROR）。
需查 error_text 确认原因，对应调整 `riskgate.ts:404` 里的 US100Cash `minSL`
或把该策略在 US100Cash 上的 `minScore` 从5提高到7。

### 3.6 恢复 H4 ADX 趋势否决

`replay.ts:443-452` 把 H4 ADX 不足改成仅告警。改为可配置的双档：
`GB_H4_ADX_FILTER_MODE=hard|soft`，默认恢复 `hard`（阻断振荡市入场）。

---

## Phase 4：AI 信号链路改造（第4-6周，P2）

### 4.1 每品种每日信号限额

实盘数据：XAUUSD 单日最多8笔AI信号（含同日反向），XAGUSD 最多4笔。
```typescript
const AI_MAX_DAILY_SIGNALS_PER_SYMBOL = 2;
const todaySignals = await store.countAISignalsToday(accountId, symbol);
if (todaySignals >= AI_MAX_DAILY_SIGNALS_PER_SYMBOL) {
  return reject('daily_limit.symbol');
}
```

### 4.2 LLM 输出强制结构化

把 markdown 手工解析改为 OpenAI function-calling，绑定 Zod schema，
消除 414 笔 confidence=0 的解析噪音（目前占 accepted 信号的5.4%）。

### 4.3 置信度下限提升到65%

`AI_APPROVE_QUEUE_MIN_CONFIDENCE` 从55提到65。
当前17天内该门槛只拦截了3次，实际上毫无约束力。
提到65后约过滤掉17%的低置信分析，减少相应 LLM API 消耗。

### 4.4 交易结果反馈回灌（Phase 2 完成后）

把"最近10笔该品种AI信号的实际结果"注入 prompt：
```
最近10笔 XAUUSD AI信号结果：
- BUY @ 4028 → +$42 (R=2.1) ✓
- SELL @ 4095 → -$18 (R=-0.9) ✗
```
不改模型，不改架构，最小成本的AI质量提升。

---

## Phase 5：风控与仓位管理加固（第6-8周，P2）

### 5.1 服务端持久化日亏保护

EA 的 `MaxDailyLoss=5%` 重启即清零，且用券商本地时间切日。
在 `runtime_state` 表里按 UTC 持久化每日起始权益，
在 `canRunLiveAnalysis` 里新增日亏百分比检查。

### 5.2 allowedLots 实际生效

`riskgate.ts:314` 计算的2%权益风险上限，目前只写进响应不消费。
在 `queueReplaySignal` 里把信号手数 clamp 到 `allowedLots`。

### 5.3 GBPJPY group SL STOPLEVEL 保护加强

115条 ERROR 130 里44条来自 GBPJPY group_favorable_addon，
per-symbol 的 `STOPLEVEL_MIN_RATIO`：GBPJPY 从0.0005提到0.0012。

### 5.4 接入 scale_in 策略

`scale-in.ts` 完整实现了逆势加仓，只差 `replay.ts` 里那一行调用。
在 Phase 2 数据积累后，先在小手数上跑2周验证，再接入主流程。

### 5.5 扩展 AI trail symbols

`GB_AI_TRAIL_SYMBOLS` 默认只有 GBPJPY。
从 closed_trades 数据找出 AI 信号持仓时间最长的品种（XAUUSD/XAGUSD 是候选），
加入 trail 列表。

---

## 量化目标与验收标准

### 近期（Phase 1+2，约2周后可验证）

| 指标 | 当前 | 目标 |
|---|---|---|
| PM 命令失败率 | 72%（672/938）| < 10% |
| ERROR 4108 | 556 条（历史） | < 20 条/周 |
| ERROR 130 | 116 条（历史） | < 20 条/周 |
| AI 信号 R:R < 1.0 比例 | ~40% | 0%（过滤） |
| 已实现盈亏可查 | 无 | 100% |

### 中期（Phase 3-4，约6周，需2周 closed_trades 数据）

| 指标 | 目标 |
|---|---|
| AI 信号平均 R:R | ≥ 1.5 |
| 每品种每日 AI 信号数 | ≤ 2 笔 |
| LLM 解析失败率 | < 2%（当前 5.4%） |
| breakout_retest US100Cash 成功率 | > 50%（当前 8%） |

### 长期（Phase 5，约10周，需3个月数据）

| 指标 | 目标 |
|---|---|
| 综合胜率 | > 50% |
| 综合期望值 | 胜率×均盈 − (1−胜率)×均亏 > 0 |
| 最大回撤 | < 10% 权益 |
| 月均盈亏比 | > 1.3 |

---

## 关键路径

```
Phase 1（3-5天）
    │
    ▼
Phase 2（5-7天）
    │
    ▼ 等待 closed_trades 数据积累 2 周
    │
    ├──────────────┐
    ▼              ▼
Phase 3（7-10天）  Phase 4（10-14天）  ← 可并行
    │              │
    └──────┬───────┘
           ▼
       Phase 5（7-10天）
```

Phase 1 可今天开始，不依赖其他 Phase。
Phase 2 必须在 Phase 3-4 之前完成，否则改了也无法验证。

---

## 今天可以开始的3件事

| 优先级 | 任务 | 代码量 | 预期效果 |
|---|---|---|---|
| ① | 4108 → 立即清 position_states | ~20行，`command-lifecycle/service.ts` | 消除73%历史执行错误 |
| ② | AI gate 增加 R:R ≥ 1.2 过滤 | ~10行，`ai-approve/gate.ts` | 过滤40%低质AI信号 |
| ③ | EA 上报平仓 + closed_trades 表 | ~50行 EA + SQL | 打通绩效可视化基础 |

---

*文档基于代码静态分析（packages/trading-core、apps/app-server、apps/app-agent、apps/app-mt EA）
以及 PostgreSQL 实盘数据（account 90011087，2026-07-08 ~ 2026-07-24，
1202 条命令 / 22980 条决策事件 / 317 条已执行订单）。*

### 1.4 AI 信号最低 R:R 过滤器

**问题**：实盘数据显示40笔AI信号中约14笔 R:R < 1.0（含 0.25、0.35、0.48），
对应的入场逻辑是：TP距离<SL距离，即使全胜也跑不赢止损。
`rules.ts` 和 `gate.ts` 没有任何 R:R 下限检查。

**修复**：在 `apps/app-server/src/services/ai-approve/gate.ts` 的
`evaluateAIApprovePendingGate` 里增加 R:R 检查：

```typescript
// gate.ts — 在 entry.too_far_from_market 检查之前
const rrRatio = side === 'BUY'
  ? (tp - entry) / Math.abs(entry - sl)
  : (entry - tp) / Math.abs(entry - sl);
if (rrRatio < MIN_RR_RATIO) {
  return reject('rr.below_minimum', `R:R=${rrRatio.toFixed(2)} < ${MIN_RR_RATIO}`);
}
```

`MIN_RR_RATIO = 1.2`（基于当前数据分布，1.2 过滤掉约40%的低质信号，
同时保留 R:R 1.2~6.0 的全部信号）。

---
