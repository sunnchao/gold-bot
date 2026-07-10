# ai_signal 加仓逻辑优化与可行性评估草案

> 日期: 2026-07-09
> 范围: ai_signal 加仓逻辑、position_manager 保本职责、LLM trailing stop 职责边界
> 状态: 待 GLM-5.2 复核

---

## 背景

当前系统已有以下基础能力（经代码核对，见文末「现状核对清单」）：

- `trade_plan.add_on` 布尔开关（`schemas.ts:225`）
- 同向持仓默认拒绝 gate（AI Approve Gate + Risk Gate 两层）
- 同向加仓距离门：硬编码 `|entry - avgPrice| >= 1 * M30 ATR`（`gate.ts:108-118`）。注意 `add_on_distance` **只是 reject reason 字符串**，schema 中没有同名可配置字段
- `max_lots` 通用手数上限（`schemas.ts:220`），非加仓专用
- `position_manager` 中 `bestSl`、`beMoved`、`group_be_BUY/SELL`、TP1/TP2 等组级联动雏形（`manager.ts`）
- LLM trailing stop 已被硬校验排除保本可能（`scheduler/service.ts:196-212`）

但当前没有完整区分两类完全不同的加仓行为：

1. **逆势浮亏加仓（adverse add-on）**
2. **同向盈利加仓（favorable add-on）**

目标：

- 允许逆势加仓，但必须严格控制层级、价格间隔、时间间隔、总手数、总风险
- 允许同向盈利加仓，但新单必须更小，并且加仓后要同步移动原订单止损，减少亏损或回撤
- 保本职责继续交给程序化 `position_manager`，LLM 只负责保本后的结构 trailing，不负责第一次保本

---

## 当前系统现状

### 已有能力

#### 1. add_on 基础开关
`trade_plan.add_on`（`schemas.ts:225`）已存在，为布尔值，无任何子参数（无 type/distance/level/count 字段），可用于允许同向加仓路径通过 gate。

#### 2. 同向持仓限制（两层）
默认情况下，已有同向持仓会被拒绝，分布在两层：

- **AI Approve Gate**（`gate.ts:102-119`）：`position.same_side`（`add_on !== true`）+ `position.add_on_distance`（距离不足）
- **Risk Gate**（`riskgate.ts:324-356`）：`position.add_not_allowed`（仅看 `allowAdd` 布尔，**不做距离判断**）

两层职责不同：gate 做单次入场前置约束，riskgate 做组合级核验。设计新约束时需明确落点。

#### 3. 加仓距离 gate（硬编码，不可配置）
当前 AI approve pending gate 已支持：
- 若已有同向持仓且 `add_on=true`
- 则新入场价与当前组合加权均价（`averageEntryPrice`，`gate.ts:251-273`）的距离必须至少达到 `1 * M30 ATR`（取 M30 末 bar ATR，`gate.ts:275-278`）
- 否则拒绝：`position.add_on_distance`

**注意**：阈值 `1 * M30 ATR` 硬编码在 `gate.ts:117`，schema 中没有可配置的 `add_on_distance` 字段。`add_on_distance` 仅是 reject reason 字符串。若需要按 add_on_type / level 配置不同距离，需新增字段并参数化该判断。

#### 4. 组级止损联动雏形
`position_manager`（`manager.ts`）已具备：

- `beMoved` / `beTriggerAtr`（单仓保本，`manager.ts:381`，触发 `profitAtr >= beTriggerAtr`，默认 1.5）
- `bestSl`（仅存内存 `PositionManagerState`，**不持久化**，见下文缺口）
- `applySameSideBreakeven`（`manager.ts:1028-1084`）：任一仓触发 BE → 全组拉到最优 openPrice（BUY 取最高 / SELL 取最低），reason `group_be_{side}`
- `applySameSideGroupClose`（`manager.ts:976-1026`）：TP1/TP2 组级联动平仓

组关系当前**无显式 `group_id`**，靠按 side 在内存推断，重启后从持仓列表重建。

### 当前缺口

现有实现仍缺少：

1. 对 `adverse add-on` 与 `favorable add-on` 的明确分类
2. 逆势加仓的层级、价格间隔、时间间隔、次数上限、总风险上限
3. 同向盈利加仓后"新单更小 + 原单减亏止损"的硬约束
4. 补仓后统一组合风险与退出逻辑
5. 组级元数据持久化（`group_id` / `group_avg_entry` / `group_best_sl` / `add_on_count` / `last_add_on_time` 均不存在于持久层，`position_states` 仅存 per-ticket BE/TP 状态，见 `helpers.ts:14-23`、`index.ts:467-479`、`postgres.ts:461-492`）
6. SIGNAL 命令携带组元数据（`ai_approve` SIGNAL `command.ts:27-48` 不带 group 字段；live_strategy 路径已有 `scale_in_*` 元数据 `service.ts:98-101`，需厘清关系，见「与现有 scale_in 机制的关系」）

### 现有硬校验与潜在缺陷（核对清单）

以下为代码现状，设计时须以此为前提：

| 项 | 现状 | 位置 | 影响 |
|----|------|------|------|
| LLM 不能保本 | LLM 的 SL 建议 `newSL >= openPrice`(BUY)/`<= openPrice`(SELL) 时直接 `return undefined` | `scheduler/service.ts:196-212` | 草案"方案 2 职责收口"在代码层已落地，勿重复设计 |
| 距离门硬编码 | `Math.abs(entry - averagePrice) < m30Atr` | `gate.ts:117` | 无 `add_on_distance` 可配置字段 |
| `beTriggerAtr` 默认值不一致 | 内存默认 1.5（`manager.ts:381`）vs 建表默认 1.0（`index.ts:474`） | — | 保本时机随机，应顺手统一 |
| `bestSl` 不持久化 | `PositionManagerState.bestSl` 存内存，`toPositionStateRecord` 未写出 | `service.ts:130-141` | 重启后丢失，靠 `updateBestSLFromPosition` 重建 |
| 组关系无 `group_id` | 按 side 内存推断 | `manager.ts:1028-1084` | 组级状态重启后需重建，加仓组级追踪无载体 |
| ai_approve SIGNAL 无组元数据 | 无 group_id / group_avg_entry / group_best_sl | `command.ts:27-48` | 加仓单无法回溯组归属 |

---

## 职责边界调整（方案 2）

> 现状说明：本节描述的职责划分**在代码层已落地**，列为既有契约而非待办。下方"待补强"为加仓场景下的扩展点。

### 保本职责归程序化（已实现）
继续采用：

- `position_manager` 负责第一次保本（breakeven），`manager.ts:381`，触发 `profitAtr >= beTriggerAtr`（内存默认 1.5）
- 一旦达到阈值，直接移动止损到 `openPrice`，置 `beMoved=true`

### LLM 职责归 trailing（已实现）
LLM / `ai_stop_loss` 只负责：

- 已保本后的结构 trailing
- 基于 H1/H4 结构、支撑阻力位、波动性，进一步优化已保本仓位的止损位置

### LLM 已被硬校验排除保本（已实现）
`scheduler/service.ts:196-212` 对 LLM 的 SL 建议做方向校验：

- BUY: `newSL >= openPrice` 直接 `return undefined`（不能保本或越过开仓价）
- SELL: `newSL <= openPrice` 直接 `return undefined`
- 另有最小距离 `distance >= atr * 0.3`（`service.ts:213-215`）与 5 分钟冷却（`service.ts:7`）

即 LLM 的 SL 不可能等于/越过开仓价，保本路径在代码层已被堵死。

### 待补强（加仓场景扩展点）

1. **`beTriggerAtr` 默认值统一**：内存 1.5（`manager.ts:381`）与建表 1.0（`index.ts:474`）不一致，保本时机随机，应统一为一个来源（建议统一为 1.5，或由 trade_plan / position_states 显式承载）
2. **`bestSl` 持久化**：当前仅存内存，重启丢失（`service.ts:130-141` 未写出）。加仓后组级 `group_best_sl` 若要跨重启生效，必须落库
3. **组级 trailing 边界**：LLM trailing 当前是 per-ticket（`aiStopLossCommandCandidate` 按 ticket 构造）。加仓后是否需要"组级 trailing"——即对同组多单统一收紧 SL——需明确是复用 per-ticket LLM 逐单收紧，还是新增组级 advisory 由 `position_manager` 编排

---

## 方案 A：逆势浮亏加仓（adverse add-on）

### 定义

已有 `ai_signal` 同方向持仓处于浮亏状态，允许继续同方向补仓，以优化均价或等待价格回归。

这不是顺势 pyramiding，而是 **adverse averaging-in**。

### 建议新增字段

#### trade_plan

```json
{
  "add_on": true,
  "add_on_type": "adverse",
  "add_on_level": 1,
  "max_add_count": 3,
  "max_total_lots": 0.20
}
```

#### position_states

建议新增：

- `add_on_count`
- `last_add_on_time`
- `last_add_on_price`
- `adverse_add_done_levels`
- `group_id`
- `group_avg_entry`
- `group_best_sl`

### 触发条件

必须同时满足：

1. 已有同向 `ai_signal` 持仓
2. 当前组合处于浮亏
   - BUY: `currentPrice < avgEntry`
   - SELL: `currentPrice > avgEntry`
3. 浮亏达到最小阈值（按 ATR）
   - L1: `lossAtr >= 1.0`
   - L2: `lossAtr >= 2.0`
   - L3: `lossAtr >= 3.5`

### 间隔控制

#### 1. 价格间隔

新单入场价与当前组合加权均价距离至少：

- L1: `>= 1.0 * M30 ATR`
- L2: `>= 1.5 * M30 ATR`
- L3: `>= 2.0 * M30 ATR`

#### 2. 时间间隔

两次逆势加仓之间至少：

- L1 → L2：45 分钟
- L2 → L3：90 分钟
- 之后：180 分钟

#### 3. 层数限制

- `max adverse add count = 2 or 3`
- 超过直接拒绝

### 手数控制

禁止马丁倍增。

只允许递减补仓，例如：

- 主单：1.00R
- L1：0.60R
- L2：0.35R
- L3：0.20R

建议约束：

- `single adverse add lots <= current net lots * 0.6`
- `cumulative adverse add lots <= initial lots * 1.5`
- `total_same_side_lots <= max_total_lots`

### 风险控制

补仓后必须重新评估：

1. 组合统一止损
2. 组合最大风险是否超账户上限
3. 新均价改善是否足够（避免补了也没意义）
4. 若补仓后风险收益比恶化则拒绝

### 退出逻辑

必须配套：

- 组合统一止损（组级）
- 回到 `breakeven + 0.5 ATR` 时优先减掉最后加仓单
- 若继续恶化且触发最终风险阈值，则按组合止损退出
- 禁止无限摊平

### 建议新增 gate reject reasons

- `position.adverse_add_loss_not_enough`
- `position.adverse_add_spacing_not_enough`
- `position.adverse_add_interval_active`
- `position.adverse_add_count_exceeded`
- `position.adverse_add_total_lots_exceeded`
- `position.adverse_add_group_risk_exceeded`

---

## 方案 B：同向盈利加仓（favorable add-on）

### 定义

已有 `ai_signal` 同方向仓位已盈利，在趋势延续时允许顺势加仓；但新单必须更小，加仓后必须同步收紧旧单止损，降低回撤风险。

### 建议新增字段

#### trade_plan

```json
{
  "add_on": true,
  "add_on_type": "favorable",
  "add_on_level": 1,
  "max_total_lots": 0.20
}
```

#### position_states

建议新增：

- `favorable_add_done`
- `last_favorable_add_time`
- `group_best_sl`
- `group_avg_entry`

### 触发条件

必须同时满足：

1. 已有同向持仓处于盈利
2. `profitAtr >= favorable_add_trigger_atr`
   - 建议：`1.0 ~ 1.5`
3. 趋势足够强
   - H1 / M30 同向
   - ADX 高于阈值
   - H4 不明显逆势
   - AI confidence 较高
4. 与上次盈利加仓价格间隔 `>= 1.0 * M30 ATR`

### 新单手数规则

新单必须严格小于主单，并递减：

- `new add lots <= initial lots * 0.5`
- `new add lots <= current largest same-side lots * 0.5`
- `new add lots <= current net lots * 0.3`

示例：

- 主单：0.10
- 加仓 1：0.04
- 加仓 2：0.02

### 原单止损调整（核心）

盈利加仓一旦成立，原单必须同步减亏 / 锁盈。

> **行业基准（风险中性原则）**：pyramiding 的核心约束是——加仓引入的新风险必须被已有浮盈完全覆盖，使得每次加仓后**组合最坏情况（全部止损同触发）的净风险不上升、应下降**。Van Tharp / MQL5 篮子引擎的标准实现要求："除非原单止损已移到保本或更好，否则不得加仓"。草案的"新单更小 + 原单收紧"是对该原则的近似，但缺一条硬约束：**加仓后组合净货币风险必须 <= 加仓前**。建议把这条提升为 favorable add-on 的第一前置硬校验，而非仅 advisory（见下方「组级风险中性校验」）。

#### B1：先保本，再结构 trailing

- 若原单尚未保本：先把原单止损移到 `openPrice`
- 若原单已保本：再按 `group_best_sl` / 结构位继续收紧

#### B2：组级联动止损

利用现有 `group_be` 机制扩展：

- 加仓新单建立后，重算同组最佳止损
- 对同组所有旧单发 `MODIFY`
- 原则：**新增一单，旧单风险必须下降**

### 组合原则

盈利加仓后：

- 新单负责趋势延续收益
- 旧单负责锁盈或减亏
- 组合净风险不能高于加仓前

### 建议新增 gate reject reasons

- `position.favorable_add_profit_not_enough`
- `position.favorable_add_spacing_not_enough`
- `position.favorable_add_lots_too_large`
- `position.favorable_add_requires_old_sl_tighten`
- `position.favorable_add_group_risk_worse`

### 建议新增 advisory

- `group_reduce_risk_after_favorable_add`
- `group_reanchor_sl_after_favorable_add`

---

## 架构落点建议

> 前提：当前同向持仓拒绝分散在两层——AI Approve Gate（`gate.ts:102-119`，含距离门）与 Risk Gate（`riskgate.ts:324-356`，仅看 `allowAdd` 布尔，不做距离）。新增约束须按"单次前置 vs 组合级"职责划分落点，避免重复或漏判。

### gate 层（单次入场前置约束）
负责：

- `add_on_type` 分流（adverse / favorable）
- 同向/逆势/盈利的单次入场条件判断
- **单次**前置约束：价格间隔、时间间隔、单次手数上限、加仓次数上限
- 将现有硬编码 `|entry - avgPrice| >= 1 * M30 ATR`（`gate.ts:117`）参数化，按 `add_on_type` / `add_on_level` 取不同阈值

> 不在此层做组合级总风险核验，交给 riskgate。

### riskgate 层（组合级核验）
负责（扩展现有 `validateExpandableRisk`，`riskgate.ts:204-222`）：

- 组合级风险再核验
- 总手数（`max_total_lots`）、总敞口、统一止损后最大风险是否超限
- 现有 `position.add_not_allowed`（`riskgate.ts:346`）从"仅看 allowAdd"升级为"allowAdd + 组合风险通过"

### command 层
负责：

- favorable / adverse 的新单 SIGNAL 构造（扩展 `command.ts:27-48`）
- 附带必要的 group 元数据（`group_id`、`add_on_type`、`add_on_level`、`parent_ticket` 等）
> 命名尽量与现有 live_strategy 的 `scale_in_*` 字段对齐（`service.ts:98-101`），避免两套语义冲突（见「与现有 scale_in 机制的关系」）。

### position_manager 层
负责：

- 第一次保本（既有，`manager.ts:381`）
- favorable add-on 后旧单减亏止损（扩展 `applySameSideBreakeven`）
- adverse add-on 后组级统一止损重锚定（**新增**，见下「组级止损重锚定」）
- 补仓后的组合退出编排

### ai_stop_loss 层
负责（既有，无需改动职责）：

- 仅在 `beMoved=true` 后继续结构 trailing（`scheduler/service.ts:196-212` 已排除保本）
- per-ticket trailing，不负责第一次保本

### 组级止损重锚定（新增逻辑，明确扩展点）

adverse 加仓后的"组合统一止损"与现有 `applySameSideBreakeven`（`manager.ts:1028-1084`，任一仓触发 BE → 全组拉到最优 openPrice）**语义不同**：前者是给浮亏组重锚定更紧的组合 SL，不是保本。建议明确二选一：

- **选项 1**：新增 `applySameSideGroupStopReanchor`，独立处理 adverse 组止损，与 BE 联动解耦
- **选项 2**：扩展 `bestSl` 计算逻辑，让 `applySameSideBreakeven` 区分"保本锚定"与"组级止损锚定"两种 reason

倾向选项 1（职责清晰，BE 与止损重锚定不互相污染）。

---

## 与现有 scale_in 机制的关系（新增，需澄清）

仓库已存在一套加仓机制，但位于 live_strategy 路径，非 AI trade_plan 的 `add_on`：

- `scale_in_parent_ticket` / `weighted_avg_entry` / `unified_sl` / `scale_in_count`（`service.ts:98-101`），来自 replay 策略层
- 用于 EA 端的加仓订单处理

本草案的 `favorable add-on` 与 `scale_in` 存在语义重合。必须澄清以下之一：

1. **同一件事**：favorable add-on 即 AI 端入口的 scale_in，复用同一套 EA 端元数据字段
2. **并行两路**：scale_in 是策略层自动加仓，favorable add-on 是 AI 主动加仓，二者需隔离（不同 source / magic / group 命名空间）
3. **分层**：scale_in 管 EA 端执行细节，favorable add-on 管 AI 决策，二者通过共享字段衔接

> 未澄清前不应同时实现两套加仓语义，否则会出现 group 归属冲突与重复加仓。

---

## 状态机分拆倾向（回应待评估问题 4）

倾向将 `adverse` 与 `favorable` **拆成两条独立状态机 + 共享 group 元数据层**，而非合并：

- favorable 触发于盈利（`profitAtr >= trigger`），退出走"锁盈减亏"，复用既有 `beMoved` / `bestSl` / `applySameSideBreakeven` 链
- adverse 触发于浮亏（`lossAtr >= L1/L2/L3`），退出走"组合统一止损 + 减仓最后加仓单"，是全新逻辑
- 二者盈亏方向相反、退出逻辑相反，混在一台状态机内几乎必然互相污染（flag 互斥、退出路径冲突）
- 共享层：`group_id` / `group_avg_entry` / `group_best_sl` / `add_on_count` 等持久化字段，两类加仓读写同一组元数据

---

## 组级风险中性校验（新增，回应深度评估）

### 原则
参照 pyramiding 风险中性（risk neutrality）行业基准：**每次加仓后，组合"全部止损同触发"的净货币风险必须 <= 加仓前**。否则加仓即扩敞口，违反 favorable add-on 初衷。

### 现有 riskgate 能否复用
现有 `maxRiskLots` 计算（`riskgate.ts:290`）基于单笔入场：`equity * 2% / (slDistance * contractSize)`，是**单单**风险预算，不感知"已有持仓 + 新单 + 组合统一 SL"的叠加效应。`contractSize` 已有（XAUUSD=100，`riskgate.ts:407`），但缺少组合级聚合。

### 建议新增 riskgate 校验（组合级，扩展 `validateExpandableRisk`）

对 favorable add-on，在单笔 `maxRiskLots` 通过后，追加组合级校验：

```
组合净风险 = Σ(每单 lots * |entry - group_best_sl| * contractSize)
约束: 组合净风险 <= 加仓前组合净风险
否则 reject: position.favorable_add_group_risk_neutral_violated
```

对应草案既有 reject `position.favorable_add_group_risk_worse`，建议升级为**硬 reject**（非 advisory），并与 B2"组级联动止损"绑定为前置条件：只有当 `group_best_sl` 重算后组合净风险下降，才允许发出 favorable 加仓 SIGNAL。

### 对 adverse add-on 的对应约束
adverse 加仓不可能满足"风险中性"（加仓时本就浮亏，组合净风险必然上升），故 adverse 不套用风险中性，改用**绝对上限**：

```
adverse 组合净风险 <= equity * maxAdverseRiskPct（建议 6%，即 3 倍单笔 2%）
否则 reject: position.adverse_add_group_risk_exceeded
```

这与草案既有 `position.adverse_add_group_risk_exceeded` 对齐，补一个具体阈值来源。

### 状态更新顺序（MQL5 篮子引擎基准）
参照 MQL5 basket/网格引擎的实现，加仓后的状态更新须遵循严格顺序，避免"先改内部状态、后 MODIFY 失败"导致组合 SL 与实际持仓不一致：

1. **先核验**：组合净风险校验通过后，才发出 favorable / adverse 加仓 SIGNAL
2. **后重算**：EA 确认新单成交（`order_result` 回报）后，`position_manager` 才重算 `group_avg_entry` / `group_best_sl`
3. **再联动**：基于重算后的 `group_best_sl`，对同组旧单发 `MODIFY`（favorable 收紧、adverse 重锚定）
4. **最后落库**：所有 `MODIFY` 确认回报后，才把 `group_best_sl` / `add_on_count` / `last_add_on_time` 写入持久层

> 当前 `bestSl` 仅存内存（`service.ts:130-141`），违反此顺序——重启即丢。Phase 0 持久化 `bestSl` 是该顺序能成立的前提。

---

## adverse add-on 深度评估（行业基准对照）

### 摊平（averaging-down）的爆仓风险
逆势浮亏加仓本质是 averaging-down / martingale-adjacent 策略。行业共识：在趋势市场（尤其 XAU 这类强趋势品种）中，无上限的摊平会因"价格不回归"而耗尽保证金。关键不是禁止，而是**把其数学性质从"无限摊平"压缩为"有限层级 + 硬回撤上限"**。

### 对照草案既有约束的评估

| 维度 | 草案既有约束 | 行业基准要求 | 评估 |
|------|-------------|-------------|------|
| 加仓次数 | `max adverse add count = 2 or 3` | 3–5 层上限 | 偏保守，合理；建议上限明确锁定 3 |
| 手数递减 | 1.00→0.60→0.35→0.20，`single add <= net*0.6` | 固定 sizing 或严格递减，禁马丁倍增 | 合理；建议补"递减比不得小于上一单的 0.5 倍"硬下限，防止后期层级骤缩到无意义 |
| 价格间隔 | L1≥1.0 / L2≥1.5 / L3≥2.0 × M30 ATR | ATR 间距且随层级递增 | 合理，符合"越深越远" |
| 时间间隔 | 45/90/180 min | cooldown 防止短时连续补 | 合理 |
| 总风险上限 | `cumulative <= initial*1.5`、`total <= max_total_lots` | 硬回撤上限（账户级 drawdown cap） | **缺口**：缺少**账户级硬回撤上限**。建议新增：触发账户回撤超过 `maxAdverseDrawdownPct`（建议 5%）时，禁止任何 adverse 加仓，且优先对最后加仓单减仓 |

### 建议新增 gate reject reasons（补强）
- `position.adverse_add_account_drawdown_exceeded`（账户级回撤熔断，新增）
- `position.adverse_add_decrease_ratio_too_small`（递减比硬下限，新增）

### 退出（最关键，草案偏弱）
adverse add-on 的退出比触发更重要。草案"回到 breakeven+0.5 ATR 减最后加仓单"方向正确，但缺**自动平仓触发**：

- 建议新增：当组合净浮亏达到 `equity * maxAdverseRiskPct`（6%）时，**自动**按组合统一止损退出全部 adverse 组，而非等 LLM/人工
- 该退出应走 `position_manager` 程序化路径（与 LLM trailing 无关），理由：adverse 组的退出是风控动作，不是结构判断

> 与"职责边界方案 2"一致：第一次保本归 `position_manager`，adverse 组的硬回撤退出同样归 `position_manager`，LLM 不介入。

---

## 风险点

1. 逆势浮亏加仓非常容易演化成危险摊平
2. 若不做组级总风险约束，盈利加仓可能放大回撤
3. 若不区分 `adverse/favorable`，逻辑会互相污染
4. 若不将保本与 trailing 职责拆分，行为会持续不稳定（**注**：代码层已拆分，此项属既有契约维护，非待办）
5. 若不把旧单止损收紧作为 favorable add-on 的前置动作，盈利加仓会变成单纯扩敞口
6. **`beTriggerAtr` 默认值不一致**（内存 1.5 / 建表 1.0）会导致保本时机随机，加仓组保本判断不可靠
7. **`bestSl` 不持久化**：重启后组级止损状态丢失，加仓组级 SL 重锚定可能重复触发或漏触发
8. **组关系无 `group_id` 持久化**：重启后组归属需从持仓列表重建，跨重启的加仓计数 / 时间间隔约束无载体
9. **favorable add-on 与现有 scale_in 语义重合**未澄清，可能导致两套加仓机制冲突或重复加仓
10. **AI Approve Gate 与 Risk Gate 双层同向拒绝**，新增约束须明确落点，否则距离门 / 总风险核验可能只在一层生效
11. **adverse add-on 缺账户级硬回撤熔断**：仅有组合级 `maxAdverseRiskPct`（6%）上限，无账户回撤 `maxAdverseDrawdownPct`（5%）熔断，趋势行情下仍可能耗尽保证金（见「adverse add-on 深度评估」）
12. **adverse add-on 退出偏弱**：草案仅"回到 breakeven+0.5 ATR 减仓"，缺程序化自动平仓触发，依赖人工/LLM 在浮亏时决策不可靠（见「退出」）
13. **状态更新顺序未规范化**：加仓后若"先改内部状态、后 MODIFY 失败"，会导致组合 SL 与实际持仓不一致；须遵循 MQL5 篮子引擎的"先核验→后重算→再联动→最后落库"顺序（见「状态更新顺序」）

---

## 建议实施顺序

### Phase 0（前提修复，可与 Phase 1 并行）

- 统一 `beTriggerAtr` 默认值（内存 1.5 vs 建表 1.0，`manager.ts:381` / `index.ts:474`）
- 持久化 `bestSl`（`service.ts:130-141` 扩展）
- 澄清 favorable add-on 与 scale_in 的关系（见「与现有 scale_in 机制的关系」）

### Phase 1

- 拆分 `add_on_type`
- favorable add-on 小手数约束
- favorable add-on 后旧单减亏止损
- ~~LLM 仅做保本后 trailing~~（已实现，仅需确认既有硬校验覆盖加仓场景）

### Phase 2

- adverse add-on 分层触发
- 价格/时间间隔控制
- 最大次数/总手数/总风险限制

### Phase 3

- 组级统一止损（`applySameSideGroupStopReanchor`，见「组级止损重锚定」）
- 组合退出/回撤保护
- 失败补仓回退逻辑
- 持久层扩展 group 元数据（`group_id` / `group_avg_entry` / `group_best_sl` / `add_on_count` / `last_add_on_time`，SQLite `index.ts:467` + PostgreSQL `postgres.ts:461` 双库 migration）

---

## 待 GLM-5.2 评估的问题

请从以下角度复核：

1. 风控是否合理，是否还有明显缺口
2. 逆势浮亏加仓的层级、间隔、手数约束是否足够保守
3. 同向盈利加仓后"新单更小 + 原单减亏止损"的联动是否合理
4. 是否应该把 `adverse add-on` 与 `favorable add-on` 完全拆成两条独立状态机（**本草案已倾向拆分 + 共享 group 元数据层，见「状态机分拆倾向」**，请复核该倾向是否成立）
5. 对现有 gold-bot 架构（gate / riskgate / position_manager / ai_stop_loss）来说，最稳妥的落地方式是什么（**注**：gate 与 riskgate 双层同向拒绝的现状须纳入考量，见「架构落点建议」）
6. 是否存在策略冲突、执行歧义或潜在爆仓 / 回撤放大风险（**含 favorable add-on 与现有 scale_in 的语义重合**，见「与现有 scale_in 机制的关系」）
7. 如需调整，请给出更优参数区间与实现建议

> 补充提示给 GLM-5.2：本草案的"现状核对清单"已基于 gold-bot 实际代码（截至 2026-07-09）核对了已有能力与缺口，请以该清单为事实基准，避免基于过时前提给建议。
