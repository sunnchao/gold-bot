# 服务端 market_status 陈旧 TTL 关市方案

> 日期：2026-07-18  
> 范围：`analysis_payload.market_status` 陈旧判定、Agent LLM 关市 skip 链路  
> 状态：已上线（commit 846a3f5）  
> 目标：周末 / EA 断线后停止无效 LLM 调用；EA 恢复上报后自动恢复分析

---

## 1. 背景与问题

### 1.1 现象

- 观测时间：`2026-07-18 18:01 CST`（周六，外汇周末休市）
- `gold-analysis-agent` 仍持续：
  - `routeAfterFetch { decision: 'analyze', reason: 'payloads-available-or-market-open', primaryMarketOpen: true }`
  - `LLM streamLayered`（模型 `glm-5.2`）
- 实时接口 `/api/v2/analysis_payload/90011087/{XAUUSD,XAGUSD,GBPJPY}` 返回：

```json
{
  "market_status": {
    "market_open": true,
    "is_trade_allowed": true,
    "tradeable": true
  }
}
```

### 1.2 根因链路

```text
EA 最后心跳 (market_open=true)
        │
        ▼
app-server 持久化 heartbeat / tick（不再刷新）
        │
        ▼
analysisMarketStatus() 直接复用 heartbeat 布尔值
（仅在 tick 时间解析失败时关市；无相对 now 的 age 判定）
        │
        ▼
analysis_payload.market_status.market_open = true（陈旧）
        │
        ▼
app-agent routeAfterFetch：只要不是全部 false → analyze
        │
        ▼
周末继续打 LLM
```

### 1.3 证据（生产快照）

| 数据 | 值 |
|------|----|
| 最后 heartbeat | `2026-07-17 20:58 UTC` 左右 |
| heartbeat 内容 | `market_open=true`, `is_trade_allowed=true`, `server_time=2026.07.17 23:58` |
| 最后 tick | 同批约 `23:58:5x`，之后停更 |
| 当前 payload | 仍报 `market_open=true` |

结论：**不是 Agent 自己“不知道周末”，而是服务端把陈旧开市状态继续喂给 Agent。**

---

## 2. 目标与非目标

### 2.1 目标

1. **止血**：tick / heartbeat 超过阈值后，`analysis_payload.market_status` 对外表现为关市：
   - `market_open = false`
   - `is_trade_allowed = false`
   - `tradeable = false`
2. **自动恢复**：EA 恢复上报且数据新鲜后，下一轮读 payload 自动回到开市，无需人工翻开关、无需重启服务。
3. **最小改动**：优先修服务端单一真相源；Agent 只消费 `market_status`，不在本方案强制加本地周末日历。
4. **可观测**：能从字段 / 日志判断是「真实关市」还是「陈旧关市」。

### 2.2 非目标（本方案不做）

1. 不在 Agent 侧新增周末 / 会话日历硬编码（可作为后续双保险）。
2. 不改 EA 上报协议字段名。
3. 不把 DB 中历史 heartbeat 的 `market_open` 永久改写为 `false`。
4. 不改 LLM 模型、cron 频率、品种列表。
5. 不把 `evaluateMarketFilters` 的 2 分钟 `tick.stale` 阈值强行统一到本方案 TTL（见第 5 节边界）。

---

## 3. 现状代码核对

### 3.1 服务端 `analysisMarketStatus`

文件：`apps/app-server/src/app.ts`

当前逻辑（摘要）：

1. 读取 heartbeat 的 `market_open` / `is_trade_allowed`
2. 用 `analysisTickTimeMillis()` 解析 tick 时间
3. **仅当 tick 时间解析失败** 时返回关市
4. 否则原样返回 heartbeat 布尔值

```ts
function analysisMarketStatus(...): { marketOpen: boolean; isTradeAllowed: boolean } {
  let marketOpen = booleanField(heartbeat, 'market_open');
  let isTradeAllowed = booleanField(heartbeat, 'is_trade_allowed');
  const now = parseDateMillis(timestamp);
  const tickTime = analysisTickTimeMillis(heartbeat, latestTick, now);
  if (tickTime == null) {
    return { marketOpen: false, isTradeAllowed: false };
  }
  return { marketOpen, isTradeAllowed }; // ← 缺 age 判定
}
```

补充：

- 已有常量 `MAX_TICK_AGE_MS = 10 * 60 * 1000`
- 当前只用于 **time-only tick 跨日回拨**，不是「相对 now 过期关市」
- 单测已存在期望：`marks analysis market status untradeable when the latest tick is stale`
  - 期望 `market_status.market_open=false` 且 `market_filters` 含 `tick.stale`
  - 说明产品意图早已是 stale → 关市，但 `analysisMarketStatus` 实现未闭环

### 3.2 `market_filters` 与 `market_status` 分裂

`analysisPayload()` 中：

| 字段 | 来源 | 陈旧判定 |
|------|------|----------|
| `market_filters` | `evaluateMarketFilters()`（trading-core） | 有：默认 **2 分钟** `tick.stale` |
| `market_status` | `analysisMarketStatus()` | **无 age 判定** |

后果：

- 可能出现：`market_filters.reason_codes` 含 `tick.stale`，但 `market_status.market_open` 仍为 `true`
- Agent 关市门禁只看 `market_status.market_open`，**不看** `market_filters` 是否 blocked

### 3.3 Agent 关市门禁

文件：`apps/app-agent/src/graph/edges.ts` → `routeAfterFetch`

- 仅当所有 payload 的 `market_status.market_open === false` 才 `skip`
- 否则 `analyze` → 进入 LLM
- `forceAnalyze` 可强制绕过（运维 / 回放场景保留）

文件：`apps/app-agent/src/graph/compose.ts`

- `tick.stale` 等 critical filter 只影响 **trade_plan mode / veto**，**不能阻止已经发生的 LLM 分析**
- 因此「只修 filters、不修 market_status」无法止血 LLM 费用

### 3.4 自动恢复相关现状

| 机制 | 现状 | 是否自动恢复 |
|------|------|--------------|
| heartbeat / tick 上报 | EA 在线即持续写 store | 是 |
| `analysisMarketStatus` | 每次读时计算 | 是（读时语义） |
| DB 永久改写 market_open | 无 | 不需要 |
| Agent cron | 持续跑 | 是；依赖 payload |

---

## 4. 方案设计

### 4.1 核心原则

**读时 TTL，不写死状态。**

- 不修改历史 heartbeat 行的 `market_open`
- 每次生成 `analysis_payload` 时根据「新鲜度」覆盖对外 `market_status`
- EA 重新上报新鲜数据后，自然恢复

### 4.2 判定输入

对单个 `accountId + symbol`：

| 输入 | 来源 | 用途 |
|------|------|------|
| `now` | `analysisPayload` 的 `timestamp` / `nowIso()` | 基准时间 |
| `tickTime` | `analysisTickTimeMillis(heartbeat, latestTick, now)` | 最新有效报价时间 |
| `heartbeatTime` | heartbeat 的 `server_time` / `updated_at` / `last_heartbeat_at`（按可解析优先级） | 心跳新鲜度 |
| `rawMarketOpen` | heartbeat `market_open` | EA 原始开市声明 |
| `rawTradeAllowed` | heartbeat `is_trade_allowed` | EA 原始可交易声明 |

### 4.3 判定规则（建议）

常量（建议值，可配置）：

```ts
// 与现有 MAX_TICK_AGE_MS 命名对齐，语义升级为「相对 now 的关市 TTL」
const MARKET_STATUS_TICK_TTL_MS = 15 * 60 * 1000;      // 15 分钟
const MARKET_STATUS_HEARTBEAT_TTL_MS = 15 * 60 * 1000; // 15 分钟
```

伪代码：

```ts
function analysisMarketStatus(heartbeat, latestTick, timestamp) {
  const now = parseDateMillis(timestamp);
  const rawOpen = booleanField(heartbeat, 'market_open');
  const rawAllowed = booleanField(heartbeat, 'is_trade_allowed');

  const tickTime = analysisTickTimeMillis(heartbeat, latestTick, now);
  const heartbeatTime = analysisHeartbeatTimeMillis(heartbeat); // 新增 helper

  // 1) 无法建立有效时间坐标 → 关市
  if (now == null || tickTime == null) {
    return closed('tick_time_unparseable');
  }

  // 2) tick 过期 → 关市
  if (now - tickTime > MARKET_STATUS_TICK_TTL_MS) {
    return closed('tick_stale');
  }

  // 3) heartbeat 过期（可解析时）→ 关市
  if (heartbeatTime != null && now - heartbeatTime > MARKET_STATUS_HEARTBEAT_TTL_MS) {
    return closed('heartbeat_stale');
  }

  // 4) 新鲜数据：信任 EA
  return {
    marketOpen: rawOpen,
    isTradeAllowed: rawAllowed,
    // 可选诊断字段见 4.5
  };
}

function closed(reason: string) {
  return { marketOpen: false, isTradeAllowed: false, staleReason: reason };
}
```

### 4.4 为什么 tick + heartbeat 双 TTL

| 场景 | 仅 tick TTL | 仅 heartbeat TTL | 双 TTL |
|------|-------------|------------------|--------|
| 周末 EA 全停 | 可关 | 可关 | 可关 |
| tick 停、heartbeat 仍刷（少见） | 可关 | 可能误开 | 可关 |
| heartbeat 停、tick 仍刷（异常） | 可能误开 | 可关 | 可关 |
| 短暂网络抖动 < TTL | 保持开 | 保持开 | 保持开 |

### 4.5 输出字段

**必须保持兼容（Agent 已消费）：**

```json
{
  "market_status": {
    "market_open": false,
    "is_trade_allowed": false,
    "mt4_server_time": "2026.07.17 23:58",
    "tradeable": false
  }
}
```

**建议新增诊断字段（可选，向后兼容）：**

```json
{
  "market_status": {
    "market_open": false,
    "is_trade_allowed": false,
    "mt4_server_time": "2026.07.17 23:58",
    "tradeable": false,
    "stale": true,
    "stale_reason": "tick_stale",
    "tick_age_ms": 72000000,
    "heartbeat_age_ms": 72000000
  }
}
```

说明：

- Agent 现有逻辑不依赖新字段，可不改 Agent 即可止血
- 新字段便于日志 / 飞书排查「为什么关市」

### 4.6 自动恢复路径

```text
周末/断线
  EA 停更 → tick/heartbeat age > TTL
  → market_status.market_open=false
  → Agent routeAfterFetch = skip
  → 不打 LLM

周一开市 / 网络恢复
  EA 重新 /heartbeat + /tick
  → store 更新为新鲜时间 + market_open=true
  → 下一次 analysis_payload 读时计算 age < TTL
  → market_status.market_open=true
  → Agent 自动 analyze
```

**恢复条件（全部满足）：**

1. EA 进程在线并继续上报
2. 最新 tick 时间可解析且 `now - tickTime <= TTL`
3. heartbeat 时间可解析时 `now - heartbeatTime <= TTL`
4. EA 自身上报 `market_open=true` 且 `is_trade_allowed=true`（若 EA 报 false，仍关市）

**不需要：**

- 手动改配置 / 清 Redis / 重启容器
- 单独 cron「恢复任务」
- 人工改 DB

### 4.7 TTL 取值建议

| 选项 | 值 | 优点 | 缺点 |
|------|----|------|------|
| A 对齐现有常量 | 10 分钟 | 与 `MAX_TICK_AGE_MS` 一致 | EA 短卡顿可能误 skip 1 个 cron 周期 |
| B 推荐 | **15 分钟** | 覆盖常见 EA 卡顿；周末仍能较快止血 | 收市后最多再烧约 1 个 15 分钟周期 |
| C 宽松 | 30 分钟 | 误杀最少 | 收市后浪费更多 LLM |

**推荐默认：15 分钟。**  
若 cron 是 `*/5` 或 `*/15`，15 分钟 TTL 通常只会多跑 0–1 次分析。

环境变量（可选，便于热调，非必须第一期）：

```bash
GB_MARKET_STATUS_TICK_TTL_MS=900000
GB_MARKET_STATUS_HEARTBEAT_TTL_MS=900000
```

---

## 5. 边界与关联系统

### 5.1 与 `evaluateMarketFilters` 的关系

| 项目 | market_filters | market_status（本方案） |
|------|----------------|-------------------------|
| 默认 tick 过期 | 2 分钟 `tick.stale` | 建议 15 分钟关市 |
| 消费方 | trade_plan / risk 文案 | Agent 是否发起 LLM |
| 是否阻止 LLM | 否 | 是 |

本方案**不强制**把 filters 的 2 分钟改成 15 分钟：

- 2 分钟 stale 继续用于「不该下单」
- 15 分钟 stale 用于「不该烧 LLM」
- 二者语义不同，允许更严的下单门禁 + 更宽的分析门禁

若未来要统一，需单独评估：过严会导致持仓期间完全不分析。

### 5.2 与 app-server 传统策略调度的关系

`apps/app-server/src/services/scheduler/service.ts`：

```ts
canRunLiveAnalysis():
  heartbeat.market_open === true && heartbeat.is_trade_allowed === true
```

注意：这里读的是 **原始 heartbeat 布尔**，不是 `analysisMarketStatus()`。

本方案第一期：

- **必改**：`analysis_payload` 路径（止血 LLM）
- **建议同批改**（可选增强）：`canRunLiveAnalysis` 也走同一套 freshness helper，避免传统策略在陈旧开市状态下空转

### 5.3 与账户总览 `connected` 的关系

`accountConnected(heartbeat)` 当前几乎只要有 heartbeat 对象就 true，不表示开市。  
本方案不修改 `connected` 语义，避免看板误报离线。

### 5.4 `forceAnalyze`

Agent `forceAnalyze=true` 仍可强制分析（回放 / 人工触发）。  
服务端 TTL 不取消 force 旁路。

---

## 6. 实现计划

### 6.1 文件改动清单

| 文件 | 改动 |
|------|------|
| `apps/app-server/src/app.ts` | 升级 `analysisMarketStatus`；新增 heartbeat 时间解析 helper；可选输出 `stale*` 字段 |
| `apps/app-server/src/app.spec.ts` | 补强 / 修复 stale 关市用例；新增 heartbeat 过期、自动恢复（新鲜后 re-open）用例 |
| （可选）`apps/app-server/src/services/scheduler/service.ts` | `canRunLiveAnalysis` 复用 freshness |
| （可选）`apps/app-server/src/services/scheduler/service.spec.ts` | 对应单测 |
| 本文档 | 实现后把状态改为「已上线」并补 commit |

**第一期明确不改：**

- `apps/app-agent/**`（靠消费 `market_status` 即可 skip）
- EA / MQ4
- DB schema / migration

### 6.2 实现步骤

1. 抽出纯函数（便于单测）：
   - `analysisHeartbeatTimeMillis(heartbeat)`
   - `isMarketDataFresh({ now, tickTime, heartbeatTime, tickTtlMs, heartbeatTtlMs })`
2. 改写 `analysisMarketStatus`：不新鲜则强制关市
3. `analysisPayload` 映射可选诊断字段
4. 单测覆盖第 7 节矩阵
5. `pnpm --filter app-server test/build`
6. Docker：`build app` → `up -d --force-recreate app`
7. 用实时接口验证周六 / 陈旧数据返回 `market_open=false`
8. 观察 agent 日志出现 `decision: 'skip'` 且无新 LLM stream

### 6.3 伪接口契约（实现后）

`GET /api/v2/analysis_payload/:accountId/:symbol`

当 tick 过期：

```json
{
  "market_status": {
    "market_open": false,
    "is_trade_allowed": false,
    "mt4_server_time": "...",
    "tradeable": false,
    "stale": true,
    "stale_reason": "tick_stale"
  }
}
```

Agent 预期：

```text
routeAfterFetch { decision: 'skip', reason: 'all-fetched-payloads-closed' | 'primary-payload-closed' }
```

---

## 7. 测试矩阵

### 7.1 单测（app-server）

| 用例 | 输入 | 期望 `market_status` |
|------|------|----------------------|
| tick 解析失败 | time 非法 / 缺 server_time | open=false, allowed=false |
| tick 过期 | tick age = 20min, TTL=15min | open=false, reason=tick_stale |
| heartbeat 过期 | heartbeat age=20min, tick 新鲜（构造） | open=false, reason=heartbeat_stale |
| 边界内新鲜 | age = 14min59s | 信任 EA 原始 true/false |
| EA 真实关市 | 新鲜 + market_open=false | open=false（非 stale 或 stale=false） |
| time-only tick 正常 | 现有跨日用例 | 行为不回归 |
| 午夜 rollover | 现有用例 | 行为不回归 |
| 自动恢复 | 先 stale 关市，再写入新鲜 tick/heartbeat | 再次 open=true |

已有测试需核对：

- `marks analysis market status untradeable when the latest tick is stale`
- `keeps analysis market status tradeable for EA time-only tick timestamps`
- `rolls time-only analysis tick timestamps over to the previous server date near midnight`

### 7.2 集成 / 生产验证

1. **当前周末（应关）**

```bash
curl -s "http://127.0.0.1:8880/api/v2/analysis_payload/90011087/XAUUSD" \
  -H "X-API-Token: $TOKEN" | jq '.market_status'
# 期望 market_open=false tradeable=false
```

2. **Agent 日志（应 skip）**

```bash
docker logs gold-analysis-agent --since 20m | rg 'routeAfterFetch|LLM streamLayered'
# 期望：decision=skip；无新的 LLM streamLayered（force 除外）
```

3. **恢复演练（可选）**

- 模拟或等待 EA 恢复 heartbeat/tick
- 再次拉 payload → `market_open` 随 EA 与新鲜度恢复
- Agent 下一轮自动 analyze

### 7.3 回归关注点

- 持仓管理 / 传统策略是否受 `canRunLiveAnalysis` 影响（若未改 scheduler，行为与现网一致）
- AI approve gate 仍使用原始 runtime 字段时，下单门禁可能仍依赖 filters / riskgate 的 2 分钟 stale（保持更严，可接受）
- 多品种：某一品种 tick 停、其它仍更新时，**按 symbol 分别判定**（当前 payload 本就是 per-symbol）

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| TTL 过短 | EA 卡顿导致误 skip 分析 | 默认 15 分钟；可 env 调大 |
| TTL 过长 | 收市后仍短暂烧 LLM | 接受 1 个周期；后续可再降 |
| tick 只有 `HH:MM:SS` | 解析依赖 heartbeat `server_time` 日期 | 复用现有 `analysisTickTimeMillis` |
| heartbeat 无可靠时间戳 | 双 TTL 退化为主要靠 tick | tick TTL 仍生效；heartbeat TTL 仅在可解析时启用 |
| 时区偏差 | age 计算偏差 | 统一用 `nowIso()` / `parseDateMillis`；单测锁死固定 now |
| 只修 server、不修 agent | 若 payload 仍 true 则无效 | 本方案直接修 payload 真相源 |
| 多账户 | 某账户离线影响其它账户 | per-account store，天然隔离 |

---

## 9. 回滚方案

1. 代码回滚到改动前 commit，重建 `app` 镜像并 `force-recreate`
2. 无需 DB 回滚（无 schema 变更）
3. 回滚后行为恢复为：信任最后一次 heartbeat 布尔值（含陈旧 true）

---

## 10. 发布计划

1. 实现 + 单测通过
2. `pnpm --filter app-server build`
3. `docker compose build app && docker compose up -d --force-recreate app`
4. 健康检查：`3100/health`、`8880/healthz`
5. 验证 payload `market_status` + agent skip
6. 观察至少 1–2 个 cron 周期确认无 LLM
7. commit / push（按老板指令推进）

**是否需要同时重建 agents？**

- 第一期：**不需要**（Agent 逻辑不变）
- 仅当后续做 Agent 双保险时才重建 `gold-analysis-agent`

---

## 11. 后续可选增强（不在第一期）

1. **Agent 双保险**：payload 缺 `market_status` / 本地周末时段额外 skip  
2. **scheduler `canRunLiveAnalysis` 共用 freshness helper**  
3. **可观测性**：Prometheus 计数 `market_status_stale_total{reason=...}`  
4. **统一 TTL 配置中心**：server / riskgate / agent 文档化差异  
5. **heartbeat 强制写 `updated_at` ISO**，减少 time-only 解析歧义

---

## 12. 决策记录

| 项 | 决策 |
|----|------|
| 落点 | 服务端 `analysis_payload.market_status` |
| 语义 | 读时 TTL，不改写 DB |
| 默认 TTL | tick 15 分钟 + heartbeat 15 分钟（可配置） |
| 自动恢复 | 有：EA 恢复新鲜上报后自动 open |
| Agent 改造 | 第一期不改 |
| filters 2 分钟 stale | 保留，用于下单门禁，不与 LLM 门禁强行统一 |

---

## 13. 验收标准（Definition of Done）

1. 单测覆盖 stale 关市 + 新鲜恢复 + 现有 time-only / rollover 不回归  
2. 当前陈旧生产数据下，三品种 payload 均 `market_open=false`  
3. `gold-analysis-agent` 日志出现 skip，无新的非 force LLM 请求  
4. 文档状态更新为已上线，并记录 commit  
5. 容器健康，无需手工清状态即可在 EA 恢复后自动开市

---

## 14. 附录：关键代码位置

| 模块 | 路径 | 说明 |
|------|------|------|
| market_status 生成 | `apps/app-server/src/app.ts` `analysisMarketStatus` | 本方案主改点 |
| payload 组装 | `apps/app-server/src/app.ts` `analysisPayload` | 输出 `market_status` |
| tick 时间解析 | `apps/app-server/src/app.ts` `analysisTickTimeMillis` | 复用 |
| market filters | `packages/trading-core/src/riskgate/riskgate.ts` `evaluateMarketFilters` | 2 分钟 stale |
| Agent 路由 | `apps/app-agent/src/graph/edges.ts` `routeAfterFetch` | 消费 market_open |
| Agent 调度 | `apps/app-agent/src/scheduler/scheduler.service.ts` | cron 触发 |
| 传统策略门禁 | `apps/app-server/src/services/scheduler/service.ts` `canRunLiveAnalysis` | 可选增强 |

---

## 15. 一句话总结

**在服务端对 tick/heartbeat 做 15 分钟读时 TTL：过期则对外 `market_open=false` 让 Agent 自动 skip LLM；EA 恢复新鲜上报后无需人工干预即可自动恢复分析。**


---

## 16. 上线记录

- commit：`846a3f5` `fix(app-server): stale tick/heartbeat 读时关市，阻断周末 LLM`
- 默认 TTL：tick 15m + heartbeat 15m（`GB_MARKET_STATUS_TICK_TTL_MS` / `GB_MARKET_STATUS_HEARTBEAT_TTL_MS`）
- 生产验证（2026-07-18）：XAUUSD/XAGUSD/GBPJPY 均 `market_open=false`，`stale_reason=tick_stale`
