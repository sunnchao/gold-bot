# Phase 2: Adverse Add-on (逆势浮亏加仓) 实现计划

## 决策结论（已确认）

1. **内存 + 持久化** —— 实现 migration 0009，扩展 `PositionStateRecord` 增加 adverse 字段
2. **账户余额回撤** —— maxAdverseDrawdownPct=5%，用 heartbeat balance 计算回撤
3. **自动平仓推迟 Phase 3** —— Phase 2 只做触发校验，不做平仓
4. **gate 只校验手数** —— AI 决定 max_lots，gate 校验递减规则

## 范围

Phase 2 = **gate 层单次前置约束** + **持久化 adverse 状态**。不做 position_manager 的组级止损重锚定（applySameSideGroupStopReanchor，属 Phase 3），不做自动平仓（属 Phase 3）。

---

## 一、Schema 扩展

**文件**: `apps/app-agent/src/types/schemas.ts:225-226`

在 TradePlanSchema 增加 adverse 字段：
```typescript
add_on: z.boolean().optional().default(false),
add_on_type: z.enum(['favorable', 'adverse']).optional(),
add_on_level: z.number().int().min(1).max(3).optional(),       // L1=1, L2=2, L3=3
max_add_count: z.number().int().min(1).max(3).optional(),      // 默认 2，上限 3
max_total_lots: z.number().finite().min(0).optional(),         // 同向总手数上限
```

**文件**: `apps/app-agent/src/types/agent.ts:58` —— 同步 `add_on_type?: 'favorable' | 'adverse'` 等字段到 TS 类型（若存在对应 interface）。

---

## 二、持久化扩展（migration 0009）

**新增文件**: `packages/persistence/src/migrations/0009_position_states_adverse_add_on.sql`
```sql
-- Migration: 0009_position_states_adverse_add_on
-- Description: Persist adverse add-on state so level/spacing/count tracking survives restarts.

ALTER TABLE position_states ADD COLUMN add_on_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE position_states ADD COLUMN last_add_on_time TEXT NOT NULL DEFAULT '';
ALTER TABLE position_states ADD COLUMN last_add_on_price REAL NOT NULL DEFAULT 0;
ALTER TABLE position_states ADD COLUMN group_id TEXT NOT NULL DEFAULT '';
ALTER TABLE position_states ADD COLUMN group_avg_entry REAL NOT NULL DEFAULT 0;
ALTER TABLE position_states ADD COLUMN group_best_sl REAL NOT NULL DEFAULT 0;
```

> 注：这些字段挂在 per-ticket 行上（与 best_sl 一致的模式）。组级聚合用同 symbol+side 的行集合推断；group_id 作为软关联标签，Phase 2 写入但不强依赖。

**文件**: `packages/persistence/src/helpers.ts`
- 扩展 `PositionStateRecord` 和 `PositionStateRow` 类型，增加 6 个字段
- 扩展 `normalizePositionState()`、`positionStateFromRow()`

**文件**: `packages/persistence/src/index.ts`
- 扩展 SQLite `CREATE TABLE position_states`（471-484）增加 6 列
- 扩展 `upsertPositionState`（576-600）和 `selectPositionStates`（601-606）SQL
- 扩展 `savePositionState`（761-776）传参
- 扩展内存 store `normalizePositionState`（1331-1344）
- 扩展 `PositionStateRow`（1346-1356）和 `positionStateFromRow`（1358-1370）

**文件**: `packages/persistence/src/postgres.ts:461-506`
- 扩展 `savePositionState` INSERT/SELECT SQL 和参数

**文件**: `apps/app-server/src/services/analysis/service.ts:130-142`
- 扩展 `toPositionStateRecord()` 透传新字段（从 PositionManagerState）

**文件**: `packages/trading-core/src/positionmgr/manager.ts:49-67`
- 扩展 `PositionManagerState` 增加 `addOnCount`/`lastAddOnTime`/`lastAddOnPrice`/`groupId`/`groupAvgEntry`/`groupBestSl`（+ snake_case 别名）

**文件**: `apps/app-server/src/services/scheduler/service.spec.ts:413`
- 扩展测试 fixture 补齐新字段默认值（避免类型断言失败）

> Phase 2 这些字段**持久化 + 透传**，但 position_manager 暂不读写它们的业务逻辑（组级止损重锚定是 Phase 3）。这样 migration 和数据通路先打通，Phase 3 只加业务逻辑。

---

## 三、Gate 层 adverse 校验

**文件**: `apps/app-server/src/services/ai-approve/gate.ts:120-133`

在现有 favorable 分支后，新增 adverse 分支。校验顺序（拒绝即返回）：

```
const addOnType = stringField(input.tradePlan, 'add_on_type');
if (addOnType === 'favorable') { ... 既有 ... }

if (addOnType === 'adverse') {
  1. existingLots = totalLotsOnSide(positions, symbol, side)
     if (existingLots <= 0) return reject('position.adverse_add_no_existing_lots')

  2. lossAtr = calculateLossAtr(positions, symbol, side, currentPrice, m30Atr)
     // BUY: avgOpenPrice - currentPrice；SELL: currentPrice - avgOpenPrice，再 / ATR
     level = numberField(input.tradePlan, 'add_on_level') || inferLevelFromLoss(lossAtr)
     // level 由 AI 显式提交；若缺失则按 lossAtr 推断 (>=1.0→L1, >=2.0→L2, >=3.5→L3)
     lossThreshold = level===1?1.0 : level===2?2.0 : 3.5
     if (lossAtr < lossThreshold) return reject('position.adverse_add_loss_not_enough')

  3. spacingThreshold = level===1?1.0 : level===2?1.5 : 2.0  (× M30 ATR)
     // 注意：通用距离门 (line 116) 已校验 >= 1.0 ATR；adverse L2/L3 需更宽
     // 因此需把通用距离门改为按 add_on_type/level 参数化（见下「四」）
     if (Math.abs(entry - averagePrice) < spacingThreshold * m30Atr)
       return reject('position.adverse_add_spacing_not_enough')

  4. 时间间隔
     // 读 position_states 取 last_add_on_time（组内最新）
     // L1→L2: 45min, L2→L3: 90min, 之后: 180min
     intervalMs = level<=1?0 : level===2?45*60*1000 : level===3?90*60*1000 : 180*60*1000
     if (lastAddOnTime 存在 && now - lastAddOnTime < intervalMs)
       return reject('position.adverse_add_interval_active')

  5. 次数限制
     maxAddCount = numberField(input.tradePlan, 'max_add_count') || 2
     if (existingAddOnCount >= maxAddCount)  // add_on_count 从 position_states 取
       return reject('position.adverse_add_count_exceeded')

  6. 手数递减校验（AI 决定 max_lots → lots，gate 校验）
     // lots = calcAIApproveLots(max_lots) 已算好
     if (lots > existingLots * 0.6) return reject('position.adverse_add_single_lots_too_large')
     // 累计 adverse 加仓手数 <= initial lots * 1.5（initial = 最早/最大主单 lots）
     cumulativeAddLots = Σ 已加仓 lots（不含主单）
     if (cumulativeAddLots + lots > initialLots * 1.5) return reject('position.adverse_add_cumulative_lots_exceeded')
     // 同向总手数
     maxTotalLots = numberField(input.tradePlan, 'max_total_lots')
     if (maxTotalLots > 0 && existingLots + lots > maxTotalLots) return reject('position.adverse_add_total_lots_exceeded')

  7. 账户级回撤熔断
     heartbeat = await input.store.getHeartbeat(input.accountId)
     balance = numberField(heartbeat, 'balance')
     equity = numberField(heartbeat, 'equity')
     // 回撤 = (balance - equity) / balance，或基于历史 peak（Phase 2 用当前 balance vs equity 近似）
     if (balance > 0 && equity > 0) {
       drawdownPct = (balance - equity) / balance * 100
       if (drawdownPct >= 5.0) return reject('position.adverse_add_account_drawdown_exceeded')
     }
}
```

**新增 helper 函数**（gate.ts 底部）：
- `calculateLossAtr(positions, symbol, side, currentPrice, atr)` —— 复用 `calculateProfitAtr` 的加权逻辑但取反方向（浮亏）
- `latestAdverseAddOnState(positionStates, symbol, side)` —— 从 position_states 取组内最新 last_add_on_time / last_add_on_price / add_on_count

**gate input 扩展**：`AIApprovePendingGateInput` 增加 `positionStates?: PositionStateRecord[]`（由 app.ts 传入，避免 gate 内重复查询）。

---

## 四、通用距离门参数化

**文件**: `apps/app-server/src/services/ai-approve/gate.ts:116`

当前：
```typescript
if (Math.abs(entry - averagePrice) < m30Atr) {
  return reject('position.add_on_distance');
}
```

改为按 add_on_type/level 取阈值：
```typescript
const addOnType = stringField(input.tradePlan, 'add_on_type');
const addOnLevel = numberField(input.tradePlan, 'add_on_level') || 1;
const spacingMultiplier = addOnType === 'adverse'
  ? (addOnLevel >= 3 ? 2.0 : addOnLevel === 2 ? 1.5 : 1.0)
  : 1.0;  // favorable 和默认仍 1.0 ATR
if (Math.abs(entry - averagePrice) < spacingMultiplier * m30Atr) {
  return reject('position.add_on_distance');
}
```

> 这样 L2/L3 的更宽距离在通用门就生效，adverse 分支内的 spacing 检查可省略（避免重复）。但为清晰起见，adverse 分支仍保留显式 spacing reject reason，用更具体的 `position.adverse_add_spacing_not_enough`。实际实现时二选一：**通用门参数化 + adverse 分支不再重复 spacing 检查**（推荐，避免双 reject reason 歧义）。

---

## 五、Command 层 adverse 元数据

**文件**: `apps/app-server/src/services/ai-approve/command.ts:51-86`

现有 favorable 分支附加 scale_in 元数据。adverse 复用同样的元数据桥接字段（与 Phase 1 决策一致：scale_in 管 EA 执行，add_on 管 AI 决策），并附加 adverse 专属字段：

```typescript
const addOnType = stringField(input.tradePlan, 'add_on_type');
if ((addOnType === 'favorable' || addOnType === 'adverse') && input.positions != null) {
  // 既有 group 计算（largestTicket / groupAvgEntry / groupBestSl / scale_in_count）
  ...
  if (addOnType === 'adverse') {
    candidate.scale_in_add_on_type = 'adverse';
    candidate.scale_in_add_on_level = numberField(input.tradePlan, 'add_on_level') || 1;
    // group_best_sl 对 adverse = 最差 openPrice（BUY: min, SELL: max），作为组合止损重锚定基准
    // 注意：favorable 的 groupBestSl 是最优（BUY:max），adverse 需相反
  }
}
```

> adverse 的 `unified_sl` 语义：组合统一止损 = 最差开仓价方向（BUY 取 min openPrice，SELL 取 max openPrice），与 favorable 相反。需在 command.ts 区分计算。

---

## 六、app.ts 透传 positionStates

**文件**: `apps/app-server/src/app.ts:887,894-901,906`

```typescript
const positions = await deps.store.getPositions(accountId, symbol);
const positionStates = await deps.store.loadPositionStates(accountId, symbol);  // 新增
...
const pendingGate = await evaluateAIApprovePendingGate({
  store: deps.store,
  accountId, symbol, tradePlan,
  nowIso: eventTimestamp,
  cooldown: deps.aiApproveCooldown,
  positionStates  // 新增
});
...
const candidate = tradePlanToCommandCandidate(..., positions);  // 不变
```

---

## 七、Reject reasons 汇总

新增（gate.ts）：
- `position.adverse_add_no_existing_lots`
- `position.adverse_add_loss_not_enough`
- `position.adverse_add_spacing_not_enough`
- `position.adverse_add_interval_active`
- `position.adverse_add_count_exceeded`
- `position.adverse_add_single_lots_too_large`
- `position.adverse_add_cumulative_lots_exceeded`
- `position.adverse_add_total_lots_exceeded`
- `position.adverse_add_account_drawdown_exceeded`

---

## 八、测试计划

**gate.spec.ts** 新增 adverse describe block（与现有 favorable block 并列）：
1. accepts adverse add-on L1 when loss >= 1.0 ATR, spacing >= 1.0 ATR, lots <= net*0.6
2. rejects adverse add-on when loss < 1.0 ATR (L1)
3. rejects adverse add-on when spacing < required (L2 needs 1.5 ATR)
4. rejects adverse add-on when time interval not elapsed (L2 needs 45min)
5. rejects adverse add-on when count exceeded (max_add_count=2)
6. rejects adverse add-on when single lots > net*0.6
7. rejects adverse add-on when cumulative lots > initial*1.5
8. rejects adverse add-on when total lots > max_total_lots
9. rejects adverse add-on when account drawdown >= 5%

**command.spec.ts** 新增：
10. builds adverse SIGNAL with scale_in_add_on_type/level and unified_sl = min openPrice (BUY)

**migrate.spec.ts** 新增：
11. migration 0009 adds 6 columns to position_states（验证 PRAGMA table_info）

**persistence 测试**（index/postgres spec）：
12. savePositionState/loadPositionStates round-trip 新字段

**trading-core manager.spec.ts**：暂不新增（Phase 2 position_manager 无新业务逻辑，仅类型透传）。

---

## 九、实施顺序

1. Schema（schemas.ts + agent.ts）
2. Migration 0009 + helpers.ts + index.ts + postgres.ts（持久化通路）
3. PositionManagerState 类型扩展（manager.ts）+ toPositionStateRecord 透传（analysis/service.ts）+ scheduler fixture
4. Gate adverse 校验 + 通用距离门参数化 + helper 函数
5. Command adverse 元数据
6. app.ts 透传 positionStates
7. 测试（按上面 1-12 顺序）
8. 运行全量测试，确认无回归

---

## 十、不做（明确排除）

- ❌ `applySameSideGroupStopReanchor`（组级止损重锚定）→ Phase 3
- ❌ 自动平仓（净浮亏达 6% 退出）→ Phase 3
- ❌ group_id 强制唯一性约束（Phase 2 仅作软标签）
- ❌ bestSl 持久化（已在 migration 0008 完成，本 phase 不重复）

---

## 待确认

无。所有决策已在对话中明确。
