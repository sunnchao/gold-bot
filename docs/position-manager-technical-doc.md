# Gold-Bot 持仓管理系统（Position Manager）技术文档

> **项目**: gold-bot monorepo (TypeScript)  
> **数据库**: PostgreSQL 15 (`postgres://...@8-209-215-113.hoki-nessie.ts.net:5432/goltbot`)  
> **文档日期**: 2026-07-17  
> **作者**: 太傅 (Taifu)  

---

## 目录

1. [系统架构概览](#1-系统架构概览)
2. [数据库 Schema](#2-数据库-schema)
3. [核心模块：Position Manager](#3-核心模块position-manager)
4. [命令生命周期](#4-命令生命周期)
5. [持仓状态机](#5-持仓状态机)
6. [Advisory 决策链](#6-advisory-决策链)
7. [分组操作](#7-分组操作)
8. [实际运行数据分析](#8-实际运行数据分析)
9. [已知问题与优化方案](#9-已知问题与优化方案)
10. [关键文件索引](#10-关键文件索引)

---

## 1. 系统架构概览

### 1.1 组件关系

```
┌─────────────────────────────────────────────────────┐
│                   EA (MQL4)                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Signal   │  │ Position     │  │ Order         │  │
│  │ Execute  │  │ Heartbeat    │  │ Result        │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
└───────┼───────────────┼──────────────────┼──────────┘
        │               │                  │
        ▼               ▼                  ▼
┌──────────────────────────────────────────────────────┐
│              app-server (Node.js)                     │
│                                                       │
│  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │ Scheduler    │  │ Analysis Service             │   │
│  │ Service      │  │  ┌─────────────────────┐     │   │
│  │              │──│  │ evaluatePosition    │     │   │
│  │ - enqueue    │  │  │ ManagerCommands()   │     │   │
│  │   Analysis  │  │  └─────────────────────┘     │   │
│  │ - enqueue    │  └──────────────────────────────┘   │
│  │   Position  │                                      │
│  │   Review    │  ┌──────────────────────────────┐   │
│  │ - queue     │  │ Command Lifecycle Service     │   │
│  │   Replay    │  │  - acceptCandidate()         │   │
│  │   Signal    │  │  - reconcile()               │   │
│  │ - queue AI  │  └──────────────────────────────┘   │
│  │   StopLoss  │                                      │
│  │ - queue     │  ┌──────────────────────────────┐   │
│  │   Position  │  │ PostgreSQL (EaStore)          │   │
│  │   Manager   │  │  - runtime_commands            │   │
│  │   Commands  │  │  - ea_snapshots               │   │
│  │             │  │  - position_states             │   │
│  │             │  │  - ea_events                   │   │
│  └──────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
EA Heartbeat (每 ~10s)
    │
    ▼
SchedulerService.enqueuePositionReview()
    │
    ├──▶ AnalysisService.analyzeAccountSymbol()
    │        │
    │        ├──▶ getPositions(accountId, symbol)      ← ea_snapshots
    │        ├──▶ loadPositionStates(accountId, symbol) ← position_states
    │        ├──▶ getBars(accountId, symbol, 'H1'...)   ← ea_snapshots
    │        └──▶ evaluatePositionManagerCommands()
    │                │
    │                ├──▶ 返回 advisories[] (MODIFY/CLOSE/CANCEL_PENDING)
    │                └──▶ 返回 nextStates[] (更新后的持仓状态)
    │
    ├──▶ persistPositionStates(accountId, symbol, nextStates)
    │
    └──▶ queuePositionManagerCommands(accountId, symbol, advisories)
             │
             ├──▶ positionManagerCommandCandidate()  ← 生成 CommandCandidate
             ├──▶ getCommand(command_id)            ← 去重检查
             └──▶ acceptCandidate()                  ← 写入 runtime_commands
                     │
                     └──▶ EA 轮询 pending commands → 执行 → reconcile
                              │
                              └──▶ reconcileCommandResult() → 更新 status
```

---

## 2. 数据库 Schema

### 2.1 runtime_commands

持仓管理、策略信号、AI 调整等所有运行时命令的存储与状态追踪表。

```sql
CREATE TABLE runtime_commands (
    command_id   text    PRIMARY KEY,          -- 命令唯一ID（含时间戳哈希）
    account_id   text    NOT NULL,             -- 账户ID (e.g. '90011087')
    status       text    NOT NULL,             -- 'queued'|'delivered'|'acked'|'failed'|'shadow_only'
    source       text    NOT NULL,             -- 'live_strategy'|'position_manager'|'ai_stop_loss'|'ai_approve'
    symbol       text    NOT NULL DEFAULT '',  -- 交易品种
    payload_json text    NOT NULL,             -- 完整命令 JSON
    result       text    NOT NULL DEFAULT '',  -- EA 返回结果 ('OK'|'ERROR')
    ticket       integer,                      -- EA ack 时回填的 ticket (0=未ack)
    created_at   text    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at text    NOT NULL DEFAULT '',  -- EA 取走时间
    acked_at     text    NOT NULL DEFAULT '',  -- EA 执行成功时间
    failed_at    text    NOT NULL DEFAULT '',  -- EA 执行失败时间
    error_text   text    NOT NULL DEFAULT '',  -- 错误码 (e.g. '4108', '130')
    updated_at   text    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_runtime_commands_account_status_created
    ON runtime_commands(account_id, status, created_at);
```

**状态流转**:
```
queued → delivered → acked   (成功)
                   → failed  (失败: error_text 填充错误码)
queued → shadow_only           (shadow 模式: 不发给 EA)
```

### 2.2 position_states

持仓管理状态机持久化表。每个活跃仓位的状态在此跨轮次保存。

```sql
CREATE TABLE position_states (
    account_id        text             NOT NULL,
    symbol            text             NOT NULL DEFAULT 'XAUUSD',
    ticket            integer          NOT NULL,
    tp1_hit           integer          NOT NULL DEFAULT 0,    -- TP1 已执行 (partial close 40%)
    tp2_hit           integer          NOT NULL DEFAULT 0,    -- TP2 已执行 (partial close 40%)
    max_profit_atr    double precision NOT NULL DEFAULT 0,    -- 历史最大浮盈（ATR 倍数）
    be_moved          integer          NOT NULL DEFAULT 0,    -- 已移动止损至保本
    be_trigger_atr    double precision NOT NULL DEFAULT 1.0,  -- 保本触发 ATR 门槛
    best_sl           real             NOT NULL DEFAULT 0,    -- 历史最优 SL 值
    open_time         text             NOT NULL DEFAULT '',   -- 开仓时间
    last_modify_time  text             NOT NULL DEFAULT '',   -- 最后修改时间
    add_on_count      integer          NOT NULL DEFAULT 0,   -- 加仓次数
    last_add_on_time  text             NOT NULL DEFAULT '',  -- 最后加仓时间
    last_add_on_price real             NOT NULL DEFAULT 0,   -- 最后加仓价格
    group_id          text             NOT NULL DEFAULT '',   -- 分组ID (side_ticket)
    group_avg_entry   real             NOT NULL DEFAULT 0,   -- 分组加权均价
    group_best_sl     real             NOT NULL DEFAULT 0,    -- 分组最优 SL
    PRIMARY KEY (account_id, symbol, ticket)
);
```

### 2.3 ea_snapshots

EA 上报的快照数据，包含持仓、K线、tick 等。

```sql
CREATE TABLE ea_snapshots (
    kind         text    NOT NULL,           -- 'positions'|'bars'|'tick'|'heartbeat'
    account_id   text    NOT NULL,
    symbol       text    NOT NULL DEFAULT '',
    timeframe    text    NOT NULL DEFAULT '', -- 'H1'|'M30'|'M15'|... (positions 时为空)
    payload_json text    NOT NULL,            -- JSON: {positions: [...]} 或 {bars: [...]}
    updated_at   text    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id           bigint  NOT NULL DEFAULT nextval('ea_snapshots_id_seq'),
    PRIMARY KEY (kind, account_id, symbol, timeframe)
);
```

### 2.4 ea_events

EA 上报的事件日志（订单结果等）。

```sql
CREATE TABLE ea_events (
    kind         text    NOT NULL,           -- 'order_result'|'heartbeat'|...
    account_id   text    NOT NULL,
    symbol       text    NOT NULL DEFAULT '',
    payload_json text    NOT NULL,
    delivered    integer NOT NULL DEFAULT 0,
    created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. 核心模块：Position Manager

### 3.1 文件位置

```
gold-bot/
├── packages/trading-core/src/positionmgr/
│   ├── manager.ts          ← 核心：evaluatePositionManagerCommands()
│   ├── types.ts            ← 类型定义
│   └── __tests__/
│       └── manager.spec.ts
│
├── apps/app-server/src/services/
│   ├── scheduler/
│   │   └── service.ts     ← 调度层：queuePositionManagerCommands()
│   ├── analysis/
│   │   └── service.ts     ← 分析层：analyzeAccountSymbol()
│   └── command-lifecycle/
│       └── service.ts     ← 命令生命周期：acceptCandidate() / reconcile()
│
└── packages/persistence/
    └── src/postgres.ts    ← 持久层：EaStore 实现
```

### 3.2 核心入口函数

```typescript
// packages/trading-core/src/positionmgr/manager.ts L606

export function evaluatePositionManagerCommands(
  input: PositionManagerCommandsInput
): PositionManagerCommandsResult {
  // 输入：
  //   input.positions    - EA 上报的持仓列表 (含市价仓 + 挂单)
  //   input.h1Bars       - H1 K线数据
  //   input.m5Bars       - M5 K线数据
  //   input.m1Bars       - M1 K线数据
  //   input.currentAtr   - 当前 ATR 值
  //   input.avgAtr       - 平均 ATR 值
  //   input.currentPrice - 当前价格
  //   input.equity       - 账户净值
  //   input.states       - 上一轮的持仓状态 (从 position_states 表加载)
  //   input.now          - 当前时间

  // 输出：
  //   result.advisories  - 命令建议列表 (MODIFY / CLOSE / CANCEL_PENDING)
  //   result.nextStates  - 更新后的持仓状态列表 (会持久化到 position_states)
}
```

### 3.3 持仓分类

```typescript
// 仓位分为两类：
// 1. pending (挂单) - 不参与 TP/trail/BE，仅检查 TP 到达 → CANCEL_PENDING
// 2. market (市价仓) - 参与 TP/trail/BE 等全部逻辑

function resolveOrderClass(position: unknown): 'pending' | 'market' {
  // 通过 position 的 type 字段判断:
  //   OP_BUY / OP_SELL → market
  //   OP_BUYLIMIT / OP_SELLLIMIT / OP_BUYSTOP / OP_SELLSTOP → pending
}
```

---

## 4. 命令生命周期

### 4.1 命令 ID 生成

```typescript
// scheduler/service.ts L484-495
function positionManagerCommandId(
  accountId: string,
  symbol: string,
  command: ReplayPositionCommand,
  nowIso: string
): string {
  const timestampKey = utcMinuteKey(nowIso);  // 精确到分钟的 UTC 时间戳
  return [
    'pm',
    commandIdPart(accountId),                    // 账户ID
    commandIdPart(symbol.toUpperCase()),         // 品种
    String(command.ticket),                     // 仓位 ticket
    command.action.toLowerCase(),               // 'modify' | 'close' | 'cancel_pending'
    commandIdPart(command.reason),              // 原因字符串
    timestampKey                                 // 分钟级时间戳
  ].filter(part => part.length > 0).join('_');
}
// 示例: pm_90011087_XAGUSD_42275433_close_trail_tp2_dd2_6_20260713081835321
```

**⚠️ 关键设计缺陷**: `commandIdPart(command.reason)` 包含了 `reason` 字符串。当 `reason` 随动态参数变化时（如 `trail_tp1_dd1.2` vs `trail_tp1_dd1.3`），同一仓位在同一分钟内会生成不同的 command_id，**绕过去重检查**，导致大量重复命令入队。

### 4.2 命令入队流程

```typescript
// scheduler/service.ts L214-231
private async queuePositionManagerCommands(
  accountId: string,
  symbol: string,
  commands: ReplayPositionCommand[]
): Promise<void> {
  const nowIso = this.nowIso();
  const positions = await this.store?.getPositions(accountId, symbol);

  for (const command of commands) {
    // 1. 生成候选命令（含仓位存活检查）
    const candidate = this.positionManagerCommandCandidate(
      accountId, symbol, command, positions, nowIso
    );

    // 2. 去重检查：command_id 已存在则跳过
    if (candidate == null) continue;
    if (await this.store?.getCommand(candidate.command_id) != null) continue;

    // 3. 入队
    await this.commandLifecycle.acceptCandidate(accountId, candidate);
  }
}
```

### 4.3 候选命令生成（含过滤逻辑）

```typescript
// scheduler/service.ts L233-312
positionManagerCommandCandidate(
  accountId, symbol, command, positions, nowIso
): CommandCandidate | undefined {
  const ticket = command.ticket;
  if (!Number.isFinite(ticket) || ticket <= 0) return undefined;

  const commandId = positionManagerCommandId(accountId, symbol, command, nowIso);

  // === MODIFY 分支 ===
  if (command.action === 'MODIFY') {
    const newSL = command.new_sl ?? 0;
    if (newSL <= 0) return undefined;

    const position = positions.find(c => numberField(c, 'ticket') === ticket);
    if (position == null) return undefined;        // 仓位不存在 → 跳过

    const oldSL = numberField(position, 'sl');
    if (oldSL <= 0) return undefined;              // 无现有SL → 跳过
    if (Math.abs(newSL - oldSL) < MODIFY_DISTANCE_EPSILON) return undefined; // 无变化

    return { command_id, action: 'MODIFY', source: 'position_manager',
             symbol, ticket, new_sl: newSL, sl: newSL, old_sl: oldSL,
             tp, open_price, distance, reason, trigger_time, analysis_mode };
  }

  // === CLOSE 分支 ===
  if (command.action === 'CLOSE') {
    const position = positions.find(c => numberField(c, 'ticket') === ticket);
    if (position == null) return undefined;        // 仓位不存在 → 跳过
    if (isPendingPositionRecord(position)) return undefined; // 挂单 → 跳过

    return { command_id, action: 'CLOSE', source: 'position_manager',
             symbol, ticket, lots, reason, trigger_time, analysis_mode };
  }

  // === CANCEL_PENDING 分支 ===
  if (command.action === 'CANCEL_PENDING') {
    return { command_id, action: 'CANCEL_PENDING', source: 'position_manager',
             symbol, ticket, reason, trigger_time, analysis_mode };
  }
}
```

### 4.4 命令执行与回调

```typescript
// command-lifecycle/service.ts L12-39
async acceptCandidate(accountId, candidate): Promise<StoredCommand> {
  // 1. 写入 runtime_commands (status='queued' 或 'shadow_only')
  const stored = await this.store.saveCommandCandidate(accountId, candidate);

  // 2. 根据 runtime_mode 决定是否推送给 EA
  const mode = resolveRuntimeMode(
    await this.store.getRuntimeMode(accountId),
    this.defaultRuntimeMode
  );
  if (mode === 'cutover') {
    await this.store.promoteCommand(stored.command_id);    // → queued (EA 可见)
  } else {
    await this.store.demoteCommandToShadowOnly(stored.command_id); // → shadow_only
  }
}

// command-lifecycle/service.ts L41-43
async reconcile(accountId, commandId, result, ticket, errorText, createdAt): Promise<boolean> {
  return await this.store.reconcileCommandResult(
    accountId, commandId, result, ticket, errorText, createdAt
  );
}
```

```typescript
// packages/persistence/src/postgres.ts L632-657
async reconcileCommandResult(accountId, commandId, result, ticket, errorText, createdAt) {
  const isAck = isAckResult(result);  // result === 'OK'

  // 更新 runtime_commands 状态
  const updateSql = isAck
    ? `UPDATE runtime_commands
       SET status='acked', result=$1, ticket=$2, error_text=$3, acked_at=$4
       WHERE command_id=$5 AND account_id=$6 AND status='delivered'`
    : `UPDATE runtime_commands
       SET status='failed', result=$1, ticket=$2, error_text=$3, failed_at=$4
       WHERE command_id=$5 AND account_id=$6 AND status='delivered'`;

  // 同时写入 ea_events 审计日志
  // 同时生成 decision_event
}
```

---

## 5. 持仓状态机

### 5.1 状态字段

```typescript
interface PositionManagerState {
  ticket: number;
  openTime: string;           // 开仓时间
  tp1Hit: boolean;            // TP1 已触发 (partial close 40%)
  tp2Hit: boolean;            // TP2 已触发 (partial close 40%)
  rsiTp75Triggered: boolean;  // RSI TP75 信号已触发
  beMoved: boolean;           // 已移动至保本
  beTriggerAtr: number;      // 保本触发 ATR 门槛 (默认 1.5)
  maxProfitAtr: number;      // 历史最大浮盈 (ATR 倍数)
  bestSl: number;             // 历史最优 SL 值
  addOnCount: number;         // 加仓次数
  lastAddOnTime: string;      // 最后加仓时间
  lastAddOnPrice: number;    // 最后加仓价格
  groupId: string;            // 分组ID (格式: "SIDE_TICKET")
  groupAvgEntry: number;      // 分组加权均价
  groupBestSl: number;        // 分组最优 SL
}
```

### 5.2 状态流转图

```
                    ┌──────────┐
          开仓 ───▶ │ INITIAL  │ (tp1Hit=F, tp2Hit=F, beMoved=F, maxProfitAtr=0)
                    └────┬─────┘
                         │ 浮盈 ≥ beTriggerAtr (1.5 ATR)
                         ▼
                    ┌──────────┐
                    │  BE_STEP │ (beMoved=T, bestSl=openPrice)
                    └────┬─────┘
                         │ 浮盈 ≥ tp1Multi (1.0~2.0 ATR)
                         ▼
                    ┌──────────┐
                    │  TP1_HIT │ (tp1Hit=T, CLOSE 40% lots)
                    └────┬─────┘
                         │ 浮盈 ≥ tp2Multi (2.0~4.0 ATR)
                         ▼
                    ┌──────────┐
                    │  TP2_HIT │ (tp2Hit=T, CLOSE 40% lots)
                    └────┬─────┘
                         │ 回撤 > maxProfitAtr * 0.55
                         ▼
                    ┌──────────┐
                    │ TRAIL_CLOSE│ (CLOSE 剩余仓位)
                    └──────────┘
```

### 5.3 锁盈参数（老板确认的配置）

```typescript
// manager.ts 中的锁盈逻辑 (profitLockTarget 函数 L1567-1593)

const BE_TRIGGER_ATR    = 1.5;  // 保本触发: 浮盈 ≥ 1.5 ATR
const LOCK_L1_PROFIT_ATR = 2.0; // L1 锁盈: 浮盈 ≥ 2.0 ATR
const LOCK_L2_PROFIT_ATR = 2.5; // L2 锁盈: 浮盈 ≥ 2.5 ATR
const LOCK_L1_OFFSET_ATR = 0.3; // L1: SL = openPrice ± 0.3*ATR
const LOCK_L2_OFFSET_ATR = 0.6; // L2: SL = openPrice ± 0.6*ATR

// 锁盈阶梯:
// 1.5 ATR → breakeven (SL = openPrice)
// 2.0 ATR → lock_l1   (SL = openPrice ± 0.3 ATR)
// 2.5 ATR → lock_l2   (SL = openPrice ± 0.6 ATR)
```

---

## 6. Advisory 决策链

### 6.1 单仓位决策顺序（evaluatePositionManagerCommands 主循环 L644-744）

```
对每个 market 仓位，按以下顺序检查（满足条件则 continue，不再检查后续）:

1. 时间止损 (timeStopAdvisory)
   条件: 持仓时间 > 阈值 且 浮亏
   动作: CLOSE 全部

2. 保本/锁盈 (profitLockTarget)
   条件: profitAtr ≥ beTriggerAtr
   动作: MODIFY SL → breakeven / lock_l1 / lock_l2

3. TP1 (shouldTakeTP1)
   条件: !tp1Hit && beMoved && profitAtr ≥ tp1Multi
   动作: CLOSE 40% lots, tp1Hit=true

4. 关键位 (keyLevelAdvisory)
   条件: 价格接近关键支撑/阻力位
   动作: MODIFY SL 或 CLOSE

5. TP2 (shouldTakeTP2)
   条件: tp1Hit && !tp2Hit && profitAtr ≥ tp2Multi
   动作: CLOSE 40% lots, tp2Hit=true

6. 趋势反转 (trendReversalAdvisory)
   条件: H1 趋势反转信号
   动作: CLOSE 全部

7. 动态追踪止盈 (dynamicTrailingAdvisory)
   条件: tp1Hit && drawdown > maxProfitAtr * 0.55
   动作: CLOSE 剩余仓位
```

### 6.2 动态追踪止盈 (dynamicTrailingAdvisory)

```typescript
// manager.ts L859-903 (推断位置)
function dynamicTrailingAdvisory(
  position: OpenPosition,
  state: PositionManagerState,
  profitAtr: number
): PositionDynamicTrailingAdvisory | null {
  // 条件: tp1Hit === true 且 maxProfitAtr > 0
  if (state.tp1Hit !== true || (state.maxProfitAtr ?? 0) <= 0) {
    return null;
  }

  // 计算回撤: maxProfitAtr - currentProfitAtr
  const drawdown = (state.maxProfitAtr ?? 0) - profitAtr;

  // 触发条件: 回撤 > 最大浮盈的 55%
  if (drawdown > (state.maxProfitAtr ?? 0) * 0.55) {
    return {
      action: 'CLOSE',
      ticket: position.ticket,
      lots: position.lots,
      reason: `trail_tp${state.tp2Hit ? '2' : '1'}_dd${drawdown.toFixed(1)}`
      //                ↑ reason 包含动态 drawdown 值
    };
  }
  return null;
}
```

**⚠️ 核心缺陷**: `reason` 包含 `drawdown.toFixed(1)`，每次 drawdown 变化（如从 1.2 → 1.3）reason 字符串变化 → command_id 变化 → 去重失效 → 同一仓位在短时间内被反复发送 CLOSE 命令。

### 6.3 自适应 TP 倍数

```typescript
// manager.ts L1406-1437
function adaptiveATRMultis(h1Bars: unknown[]): { tp1Multi: number; tp2Multi: number } {
  // 默认: tp1Multi=1.5, tp2Multi=3.0
  // 当前 ATR / 近20根平均 ATR:
  //   > 1.3 (高波动): tp1Multi=2.0, tp2Multi=4.0
  //   < 0.7 (低波动): tp1Multi=1.0, tp2Multi=2.0
  //   其他:           tp1Multi=1.5, tp2Multi=3.0
}
```

---

## 7. 分组操作

### 7.1 同方向分组保本 (applySameSideBreakeven)

```typescript
// manager.ts L1092-1169
// 触发条件: 同方向 >1 个仓位，且其中任一仓位新触发 BE
// 或: 新仓位价格优于旧仓位均价（favorable add-on）

// 逻辑:
// 1. 按 side (BUY/SELL) 分组
// 2. 计算组内 bestSL:
//    BUY  → 最高 openPrice
//    SELL → 最低  openPrice
// 3. 对组内每个仓位，如果 bestSL 优于 current bestSl → MODIFY
//    reason: "group_be_{side}" 或 "group_favorable_addon_{side}"
```

### 7.2 同方向分组重锚定 (applySameSideGroupStopReanchor)

```typescript
// manager.ts L1171-1266
// 触发条件: 同方向有新仓 + 旧仓，且新仓价格劣于旧仓均价（adverse add-on）

// 逻辑:
// 1. 按 side 分组，区分 newPositions / oldPositions
// 2. 计算 oldAveragePrice (旧仓加权均价)
// 3. 检测 hasAdverseAddOn (新仓价格劣于旧仓均价)
// 4. 计算 groupAvgEntry (全组加权均价)
// 5. 对组内每个仓位 → MODIFY SL = groupAvgEntry
//    reason: "group_adverse_reanchor_{side}"
```

**⚠️ 缺陷**: `groupAvgEntry` 直接作为 `newSL`，未检查与当前价的距离。当 `groupAvgEntry` 离当前价太近时，MT4 返回 error 130 (Invalid Stops)。

### 7.3 同方向分组 TP (applySameSideGroupClose)

```typescript
// manager.ts L749-750 (调用)
// applySameSideGroupClose(advisories, states, positions, preTP1Hit, 'tp1Hit', 'group_tp1')
// applySameSideGroupClose(advisories, states, positions, preTP2Hit, 'tp2Hit', 'group_tp2')

// 逻辑: 同方向任一仓位触发 TP1/TP2 → 组内其他仓位也触发
// reason: "group_tp1_{side}" / "group_tp2_{side}"
```

### 7.4 逆势分组止损 (applyAdverseGroupDrawdownExit)

```typescript
// manager.ts L1268+ (推断)
// 触发条件: 分组净浮亏超过阈值
// 动作: CLOSE 全组仓位
```

---

## 8. 实际运行数据分析

### 8.1 数据采集范围

- **时间**: 2026-07-10 ~ 2026-07-17 (7天)
- **数据库**: PostgreSQL (goltbot)
- **查询表**: runtime_commands (source='position_manager')

### 8.2 错误统计总览

| 错误码 | 含义 | 数量 | 占比 |
|--------|------|------|------|
| (无, acked) | 成功 | 60 | 8.5% |
| 4108 | Unknown ticket (仓位不存在) | 520 | 73.7% |
| 130 | Invalid stops (SL 距离违规) | 115 | 16.3% |
| 1 | 一般错误 | 5 | 0.7% |
| **总计** | | **706** | **100%** |

### 8.3 按 reason + error 分组统计

| reason | 错误类型 | 数量 |
|--------|---------|------|
| trail_tp2_dd2.5 | 4108 | 109 |
| trail_tp2_dd2.6 | 4108 | 69 |
| trail_tp2_dd2.4 | 4108 | 54 |
| trail_tp1_dd1.2 | 4108 | 51 |
| trail_tp2_dd2.1 | 4108 | 51 |
| group_favorable_addon_BUY | 130 | 44 |
| trail_tp2_dd2.2 | 4108 | 37 |
| group_favorable_addon_SELL | 130 | 27 |
| group_adverse_reanchor_SELL | 130 | 26 |
| trail_tp1_dd1.3 | 4108 | 28 |
| group_adverse_reanchor_BUY | 130 | 18 |
| trail_tp2_dd2.0 | 4108 | 17 |
| group_be_SELL | 4108 | 12 |
| trail_tp1_dd1.5 | 4108 | 25 |
| trail_tp1_dd1.4 | 4108 | 16 |
| group_tp1_SELL | (acked) | 11 |
| breakeven_1.5ATR | (acked) | 8 |
| TP1_1.5ATR | (acked) | 7 |

### 8.4 4108 错误根因分析

**核心发现**: 520 条 4108 错误中，519 条的 `runtime_commands.ticket` = 0（EA 从未 ack 过），全部来自 payload 中 ticket=42275433 的 XAGUSD 仓位。

**时间分布**:
| 时段 | 失败命令数 |
|------|-----------|
| 2026-07-13 00:05~00:25 (20分钟) | 127 |
| 2026-07-13 08:06~08:59 (54分钟) | 265 |
| 2026-07-13 09:00~09:27 (27分钟) | 97 |
| 其他时段 | 30 |
| **总计** | **519** |

**根因链**:
```
1. Ticket 42275433 是一个 XAGUSD 挂单 (pending order)
2. EA 在 2026-07-13 12:28 成功执行了 CANCEL_PENDING (pending_tp_reached)
3. 但在此之前的 00:05~09:27，position_manager 的 dynamicTrailingAdvisory
   将该仓位当作市价仓处理（evaluatePositionManagerCommands 的 resolveOrderClass
   过滤未生效？或该仓位在 ea_snapshots 中以 market 类型上报）
4. 每轮检查中，drawdown 值变化 → reason 变化 → command_id 变化 → 去重失效
5. EA 收到 CLOSE 命令 → ticket 不存在 → 返回 4108
6. 9 小时内累积 492 条失败命令
```

**position_states 表验证**: ticket 42275433 在 position_states 中 **不存在**（0 rows），说明状态已被清理或从未持久化。但 `evaluatePositionManagerCommands` 每轮从 `input.states` 加载状态，如果状态为空，`positionAnalyzeState` 会用默认值初始化（tp1Hit=false），然后 `maxProfitAtr` 会重新计算 → 导致 trail_tp 逻辑持续触发。

### 8.5 130 错误根因分析

**115 条 130 错误全部来自分组操作**:

| reason | 数量 |
|--------|------|
| group_favorable_addon_BUY | 44 |
| group_favorable_addon_SELL | 27 |
| group_adverse_reanchor_SELL | 26 |
| group_adverse_reanchor_BUY | 18 |

**payload 样本**:
```json
{
  "action": "MODIFY",
  "symbol": "GBPJPY",
  "ticket": 42275446,
  "new_sl": 216.765,
  "old_sl": 216.433,
  "open_price": 216.752,
  "distance": 0.332,
  "reason": "group_favorable_addon_BUY"
}
```

**根因**: `applySameSideGroupStopReanchor` 和 `applySameSideBreakeven` 使用 `groupAvgEntry` 或 `bestSL` 作为 newSL，但未检查 newSL 与当前价的距离是否满足 MT4 的 `MODE_STOPLEVEL` 最小距离要求。GBPJPY 的 STOPLEVEL 通常为 0.5~1.0 点，当 groupAvgEntry 接近当前价时触发 error 130。

---

## 9. 已知问题与优化方案

### 9.1 问题总览

| # | 问题 | 影响 | 优先级 |
|---|------|------|--------|
| 1 | trail_tp CLOSE 命令的去重失效 | 73.7% 失败命令的根因 | P0 |
| 2 | 已平仓/挂单仓位仍生成 CLOSE 命令 | 仓位存活检查不足 | P0 |
| 3 | 分组 SL 缺少 STOPLEVEL 距离检查 | 16.3% 失败命令的根因 | P1 |
| 4 | group_be 对已平仓 ticket 发 MODIFY | 4108 错误 | P1 |
| 5 | trail_tp 缺少幂等 flag | partial close 后重复 trail | P2 |

### 9.2 方案 1：trail_tp CLOSE 命令幂等去重 (P0)

**问题**: `positionManagerCommandId` 的 reason 部分包含动态 drawdown 值（如 `trail_tp1_dd1.2` vs `trail_tp1_dd1.3`），导致同一仓位在同一分钟内生成不同 command_id。

**修复位置**: `scheduler/service.ts` L278-297 (CLOSE 分支)

**修复方案**:
```typescript
if (command.action === 'CLOSE') {
  const position = positions.find(c => numberField(c, 'ticket') === ticket);
  if (position == null) return undefined;
  if (isPendingPositionRecord(position)) return undefined;

  // 新增: trail_tp 系列命令的幂等检查
  // 将 reason 归一化: trail_tp1_dd* → trail_tp1, trail_tp2_dd* → trail_tp2
  const normalizedReason = command.reason.replace(/_dd[\d.]+/, '');
  const idempotentCommandId = [
    'pm', commandIdPart(accountId), commandIdPart(symbol.toUpperCase()),
    String(ticket), 'close', commandIdPart(normalizedReason),
    utcMinuteKey(nowIso)
  ].filter(p => p.length > 0).join('_');

  // 使用归一化后的 command_id 进行去重
  if (await this.store?.getCommand(idempotentCommandId) != null) return undefined;

  return {
    command_id: idempotentCommandId,  // 使用归一化 ID
    action: 'CLOSE', source: 'position_manager',
    symbol, ticket, lots: command.lots,
    reason: command.reason,  // 原始 reason 保留在 payload 中
    trigger_time: nowIso, analysis_mode: 'positions'
  };
}
```

**预期效果**: 同一 ticket 的 trail_tp1 系列命令在同一分钟内只入队一条，消除 519/520 条 4108 错误。

### 9.3 方案 2：仓位存活验证增强 (P0)

**问题**: `evaluatePositionManagerCommands` 的 `resolveOrderClass` 过滤在 `positionmgr/manager.ts` 层面生效（L614-626），但 scheduler 层面从 `getPositions()` 获取的 positions 快照可能包含已被 EA 平仓但尚未更新的仓位。

**修复位置**: `scheduler/service.ts` L278-297

**修复方案**:
```typescript
if (command.action === 'CLOSE') {
  const position = positions.find(c => numberField(c, 'ticket') === ticket);
  if (position == null) return undefined;
  if (isPendingPositionRecord(position)) return undefined;

  // 新增: 检查仓位是否已在最近 heartbeat 中更新
  // 如果仓位数据超过 5 分钟未更新，可能已平仓
  const positionTime = stringField(position, 'time') || stringField(position, 'updated_at');
  if (positionTime) {
    const ageMs = Date.parse(nowIso) - Date.parse(positionTime);
    if (ageMs > 5 * 60 * 1000) {
      console.log(`[PM] skip CLOSE for stale position ticket=${ticket} age=${ageMs}ms`);
      return undefined;
    }
  }

  // ... 其余逻辑
}
```

### 9.4 方案 3：分组 SL 的 STOPLEVEL 距离检查 (P1)

**问题**: `applySameSideGroupStopReanchor` 和 `applySameSideBreakeven` 使用 `groupAvgEntry` 作为 newSL，未检查与当前价的距离。

**修复位置**: `positionmgr/manager.ts` L1255 (reanchor) 和 L1157 (breakeven)

**修复方案**:
```typescript
// applySameSideGroupStopReanchor L1255 附近
// 在 validateNewSL 之后增加 STOPLEVEL 检查

const STOPLEVEL_RATIO = 0.0005; // 0.05% 最小距离
const minStopDistance = (input.currentPrice ?? 0) * STOPLEVEL_RATIO;
const slDistance = Math.abs(groupAvgEntry - input.currentPrice);

if (slDistance < minStopDistance) {
  // SL 离当前价太近，跳过避免 error 130
  continue;
}

if (validateNewSL(side, groupAvgEntry, currentBestSL) && groupAvgEntry !== currentBestSL) {
  state.bestSl = groupAvgEntry;
  advisories.push({
    action: 'MODIFY',
    ticket: position.ticket,
    newSL: groupAvgEntry,
    reason: `group_adverse_reanchor_${side}`
  });
}
```

**注意**: `applySameSideBreakeven` 和 `applySameSideGroupStopReanchor` 是纯函数，不接收 `currentPrice`。需要修改函数签名，将 `currentPrice` 作为参数传入，或在调用处（L752-753）过滤。

**替代方案**（不改签名）: 在 `scheduler/service.ts` 的 `positionManagerCommandCandidate` MODIFY 分支中增加距离检查:
```typescript
// scheduler/service.ts L245-276 (MODIFY 分支)
if (command.action === 'MODIFY') {
  // ... 现有检查 ...

  // 新增: STOPLEVEL 距离检查
  const currentPrice = /* 从 positions 或 tick 获取 */;
  const STOPLEVEL_RATIO = 0.0005;
  const minDistance = currentPrice * STOPLEVEL_RATIO;
  if (Math.abs(newSL - currentPrice) < minDistance) {
    return undefined;  // SL 离当前价太近
  }

  // ... 返回 candidate ...
}
```

### 9.5 方案 4：group_be 的仓位新鲜度检查 (P1)

**问题**: `applySameSideBreakeven` 对组内所有 ticket 发 MODIFY，但如果某 ticket 已被 EA 平仓（TP1 partial close 后），下一轮 positions 快照可能仍包含该 ticket（heartbeat 延迟），导致对已不存在的 ticket 发 MODIFY → 4108。

**修复位置**: `scheduler/service.ts` L250-253 (MODIFY 分支)

**修复方案**:
```typescript
if (command.action === 'MODIFY') {
  // ... 现有检查 ...

  const position = positions.find(c => numberField(c, 'ticket') === ticket);
  if (position == null) return undefined;

  // 新增: 仓位新鲜度检查
  const positionTime = stringField(position, 'time') || stringField(position, 'updated_at');
  if (positionTime) {
    const ageMs = Date.parse(nowIso) - Date.parse(positionTime);
    if (ageMs > 5 * 60 * 1000) {
      return undefined;  // 超过5分钟未更新，可能已平仓
    }
  }

  // ... 其余逻辑 ...
}
```

### 9.6 方案 5：trail_tp 幂等 flag (P2)

**问题**: `dynamicTrailingAdvisory` 检查 `state.tp1Hit === true && maxProfitAtr > 0`，trail CLOSE 执行后没有设置幂等 flag，如果仓位只 partial close 了 40%（TP1），剩余 60% 会在下一轮继续触发 trail_tp。

**修复位置**: `positionmgr/manager.ts` 的 `dynamicTrailingAdvisory` 函数 + `PositionManagerState` 类型

**修复方案**:
```typescript
// 1. 在 PositionManagerState 中新增字段
interface PositionManagerState {
  // ... existing fields ...
  trailingClosed?: boolean;  // 新增: trail CLOSE 已执行
}

// 2. 在 dynamicTrailingAdvisory 中检查和设置
function dynamicTrailingAdvisory(
  position: OpenPosition,
  state: PositionManagerState,
  profitAtr: number
): PositionDynamicTrailingAdvisory | null {
  // 新增: 幂等检查
  if (state.trailingClosed === true) {
    return null;  // 已执行过 trail close
  }

  if (state.tp1Hit !== true || (state.maxProfitAtr ?? 0) <= 0) {
    return null;
  }

  const drawdown = (state.maxProfitAtr ?? 0) - profitAtr;
  if (drawdown > (state.maxProfitAtr ?? 0) * 0.55) {
    state.trailingClosed = true;  // 标记已执行
    return {
      action: 'CLOSE',
      ticket: position.ticket,
      lots: position.lots,
      reason: `trail_tp${state.tp2Hit ? '2' : '1'}_dd${drawdown.toFixed(1)}`
    };
  }
  return null;
}
```

**数据库变更**: 需要在 `position_states` 表新增 `trailing_closed` 列:
```sql
ALTER TABLE position_states
ADD COLUMN trailing_closed integer NOT NULL DEFAULT 0;
```

同时更新 `savePositionState` 和 `loadPositionStates` 的 SQL。

### 9.7 修复优先级与预期效果

| 优先级 | 方案 | 修复问题 | 预期减少失败命令 |
|--------|------|---------|-----------------|
| P0 | 方案 1: CLOSE 幂等去重 | trail_tp 重复命令 | ~520 条 (73.7%) |
| P0 | 方案 2: 仓位存活验证 | 对已平仓仓位发命令 | ~30 条 |
| P1 | 方案 3: STOPLEVEL 检查 | error 130 | ~115 条 (16.3%) |
| P1 | 方案 4: 仓位新鲜度检查 | group_be 4108 | ~12 条 |
| P2 | 方案 5: trail 幂等 flag | partial close 后重复 | 预防性 |

**P0 修复后预期失败率**: 从 91.5% 降至 ~17%（仅剩 130 错误）  
**P0+P1 全部修复后预期失败率**: < 2%

---

## 10. 关键文件索引

### 10.1 核心代码

| 文件 | 行数 | 职责 |
|------|------|------|
| `packages/trading-core/src/positionmgr/manager.ts` | 1813 | 持仓管理核心逻辑：advisory 生成、状态机、分组操作 |
| `apps/app-server/src/services/scheduler/service.ts` | 652 | 调度层：命令入队、去重、AI 止损 |
| `apps/app-server/src/services/analysis/service.ts` | - | 分析服务：调用 evaluatePositionManagerCommands |
| `apps/app-server/src/services/command-lifecycle/service.ts` | 61 | 命令生命周期：acceptCandidate / reconcile |
| `packages/persistence/src/postgres.ts` | 892 | PostgreSQL 数据访问层 (EaStore 实现) |
| `packages/persistence/src/index.ts` | - | EaStore 接口定义 |

### 10.2 关键函数索引

| 函数 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `evaluatePositionManagerCommands` | manager.ts | L606 | 核心入口 |
| `positionAnalyzeState` | manager.ts | L1510 | 状态初始化 |
| `profitLockTarget` | manager.ts | L1567 | 锁盈目标计算 |
| `dynamicTrailingAdvisory` | manager.ts | ~L859 | 动态追踪止盈 |
| `applySameSideBreakeven` | manager.ts | L1092 | 分组保本 |
| `applySameSideGroupStopReanchor` | manager.ts | L1171 | 分组重锚定 |
| `applySameSideGroupClose` | manager.ts | ~L749 | 分组 TP |
| `applyAdverseGroupDrawdownExit` | manager.ts | L1268 | 逆势分组止损 |
| `adaptiveATRMultis` | manager.ts | L1406 | 自适应 TP 倍数 |
| `validateNewSL` | manager.ts | L1557 | SL 有效性检查 |
| `resetStaleBreakeven` | manager.ts | L1544 | 清理过期 BE 状态 |
| `positionManagerCommandId` | scheduler/service.ts | L484 | 命令 ID 生成 |
| `positionManagerCommandCandidate` | scheduler/service.ts | L233 | 候选命令生成 |
| `queuePositionManagerCommands` | scheduler/service.ts | L214 | 命令入队 |
| `acceptCandidate` | command-lifecycle/service.ts | L12 | 命令接受 |
| `reconcile` | command-lifecycle/service.ts | L41 | 命令回调 |
| `reconcileCommandResult` | postgres.ts | L632 | 命令状态更新 |
| `getPositions` | postgres.ts | L447 | 获取持仓 |
| `loadPositionStates` | postgres.ts | L493 | 加载持仓状态 |
| `savePositionState` | postgres.ts | L467 | 保存持仓状态 |

### 10.3 锁盈参数常量

| 常量 | 值 | 位置 | 说明 |
|------|-----|------|------|
| `BE_TRIGGER_ATR` | 1.5 | manager.ts | 保本触发门槛 |
| `LOCK_L1_PROFIT_ATR` | 2.0 | manager.ts | L1 锁盈触发 |
| `LOCK_L2_PROFIT_ATR` | 2.5 | manager.ts | L2 锁盈触发 |
| `LOCK_L1_OFFSET_ATR` | 0.3 | manager.ts | L1 SL 偏移 |
| `LOCK_L2_OFFSET_ATR` | 0.6 | manager.ts | L2 SL 偏移 |
| `AI_STOP_LOSS_MODIFY_COOLDOWN_MS` | 300000 (5min) | scheduler/service.ts L8 | AI 止损冷却 |
| `AI_STOP_LOSS_PROFIT_ATR_GATE` | 1.5 | scheduler/service.ts L9 | AI 止损浮盈门槛 |
| `DEFAULT_AI_TRAIL_SYMBOLS` | 'GBPJPY' | scheduler/service.ts L10 | AI trail 默认品种 |
| `MODIFY_DISTANCE_EPSILON` | 1e-9 | scheduler/service.ts L11 | MODIFY 最小距离 |

### 10.4 MT4 错误码参考

| 错误码 | 常量名 | 含义 |
|--------|--------|------|
| 130 | ERR_INVALID_STOPS | SL/TP 距离违规（不满足 STOPLEVEL/FREEZELEVEL） |
| 4108 | ERR_INVALID_TICKET | 仓位 ticket 不存在（已平仓或未开仓） |
| 1 | ERR_NO_RESULT | 一般性错误（无具体信息） |

---

## 附录 A：决策链完整流程图

```
evaluatePositionManagerCommands(input)
│
├── 挂单处理: pending → 检查 TP 到达 → CANCEL_PENDING
│
├── 市价仓主循环 (L644-744):
│   │
│   ├── positionAnalyzeState() → 初始化/恢复状态
│   ├── updateBestSLFromPosition() → 同步 bestSL
│   ├── profitInAtr() → 计算浮盈 ATR 倍数
│   ├── 更新 maxProfitAtr (if profitAtr > max)
│   │
│   ├── 1. timeStopAdvisory()
│   │      条件: hours > 阈值 && 浮亏 → CLOSE 全部
│   │
│   ├── 2. resetStaleBreakeven() → 清理过期 BE
│   ├──    profitLockTarget()
│   │      条件: profitAtr ≥ beTriggerAtr
│   │      → breakeven (1.5 ATR): SL = openPrice
│   │      → lock_l1 (2.0 ATR): SL = openPrice ± 0.3 ATR
│   │      → lock_l2 (2.5 ATR): SL = openPrice ± 0.6 ATR
│   │      动作: MODIFY SL
│   │
│   ├── 3. shouldTakeTP1()
│   │      条件: !tp1Hit && beMoved && profitAtr ≥ tp1Multi
│   │      动作: CLOSE 40%, tp1Hit=true
│   │
│   ├── 4. keyLevelAdvisory()
│   │      条件: 价格接近关键位
│   │      动作: MODIFY SL 或 CLOSE
│   │
│   ├── 5. shouldTakeTP2()
│   │      条件: tp1Hit && !tp2Hit && profitAtr ≥ tp2Multi
│   │      动作: CLOSE 40%, tp2Hit=true
│   │
│   ├── 6. trendReversalAdvisory()
│   │      条件: H1 趋势反转
│   │      动作: CLOSE 全部
│   │
│   └── 7. dynamicTrailingAdvisory()
│          条件: tp1Hit && drawdown > maxProfitAtr * 0.55
│          动作: CLOSE 剩余
│
├── 分组操作 (L749-754):
│   ├── applySameSideGroupClose (tp1) → group_tp1_{side}
│   ├── applySameSideGroupClose (tp2) → group_tp2_{side}
│   ├── applySameSideBreakeven → group_be_{side} / group_favorable_addon_{side}
│   ├── applySameSideGroupStopReanchor → group_adverse_reanchor_{side}
│   └── applyAdverseGroupDrawdownExit → 分组止损
│
└── 返回: { advisories[], nextStates[] }
```

---

## 附录 B：payload_json 示例

### B.1 MODIFY 命令 (group_favorable_addon)
```json
{
  "command_id": "pm_90011087_GBPJPY_42275446_modify_group_favorable_addon_BUY_20260713014307178",
  "action": "MODIFY",
  "source": "position_manager",
  "symbol": "GBPJPY",
  "ticket": 42275446,
  "new_sl": 216.765,
  "sl": 216.765,
  "old_sl": 216.433,
  "tp": 216.862,
  "open_price": 216.752,
  "distance": 0.332,
  "reason": "group_favorable_addon_BUY",
  "trigger_time": "2026-07-13T01:43:07.178Z",
  "analysis_mode": "positions"
}
```

### B.2 CLOSE 命令 (trail_tp)
```json
{
  "command_id": "pm_90011087_XAGUSD_42275433_close_trail_tp2_dd2_6_20260713081835321",
  "action": "CLOSE",
  "source": "position_manager",
  "symbol": "XAGUSD",
  "ticket": 42275433,
  "lots": 0.05,
  "reason": "trail_tp2_dd2.6",
  "trigger_time": "2026-07-13T08:18:35.321Z",
  "analysis_mode": "positions"
}
```

### B.3 CANCEL_PENDING 命令
```json
{
  "command_id": "pm_90011087_XAGUSD_42275433_cancel_pending_pending_tp_reached_58_36_20260713122753508",
  "action": "CANCEL_PENDING",
  "source": "position_manager",
  "symbol": "XAGUSD",
  "ticket": 42275433,
  "reason": "pending_tp_reached_58.36",
  "trigger_time": "2026-07-13T12:27:53.508Z",
  "analysis_mode": "positions"
}
```

---

*文档结束*
