# ai_signal 加仓逻辑优化与可行性评估草案

> 日期: 2026-07-09
> 范围: ai_signal 加仓逻辑、position_manager 保本职责、LLM trailing stop 职责边界
> 状态: 待 GLM-5.2 复核

---

## 背景

当前系统已有以下基础能力：

- `trade_plan.add_on` 开关
- 同向持仓默认拒绝 gate
- `add_on_distance`（基于 M30 ATR）
- `max_lots` 手数控制
- `position_manager` 中 `bestSl`、`beMoved`、`group_be`、TP1/TP2 等组级联动雏形

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
`trade_plan.add_on` 已存在，可用于允许同向加仓路径通过 gate。

#### 2. 同向持仓限制
默认情况下，已有同向持仓会被拒绝：
- `position.same_side`
- `position.add_not_allowed`

#### 3. 加仓距离 gate
当前 AI approve pending gate 已支持：
- 若已有同向持仓且 `add_on=true`
- 则新入场价与当前组合均价的距离必须至少达到 `1 * M30 ATR`
- 否则拒绝：`position.add_on_distance`

#### 4. 组级止损联动雏形
`position_manager` 已具备：
- `beMoved`
- `bestSl`
- `group_be_BUY / group_be_SELL`
- 同向多单/空单组内联动止损能力

### 当前缺口

现有实现仍缺少：

1. 对 `adverse add-on` 与 `favorable add-on` 的明确分类
2. 逆势加仓的层级、价格间隔、时间间隔、次数上限、总风险上限
3. 同向盈利加仓后“新单更小 + 原单减亏止损”的硬约束
4. 补仓后统一组合风险与退出逻辑
5. 对 LLM 止损建议职责的进一步收口

---

## 职责边界调整（方案 2）

### 保本职责归程序化
继续采用：

- `position_manager` 负责第一次保本（breakeven）
- 触发条件仍按程序化规则（如 `profitAtr >= beTriggerAtr`）
- 一旦达到阈值，直接移动止损到 `openPrice`

### LLM 职责归 trailing
LLM / `ai_stop_loss` 只负责：

- 已保本后的结构 trailing
- 基于 H1/H4 结构、支撑阻力位、波动性，进一步优化已保本仓位的止损位置

### 不再允许 LLM 承担第一次保本
理由：

1. 保本是机械规则，程序化更稳
2. LLM 当前可能给出“放宽止损”而不是“锁盈止损”
3. 保本与 trailing 混用会导致行为不一致

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

### gate 层
负责：

- `add_on_type` 分流
- 同向/逆势/盈利条件判断
- 价格间隔、时间间隔、次数、手数、总风险前置约束

### riskgate 层
负责：

- 组合级风险再核验
- 总手数、总敞口、统一止损后最大风险是否超限

### command 层
负责：

- favorable / adverse 的新单 SIGNAL 构造
- 附带必要的 group 元数据

### position_manager 层
负责：

- 第一次保本
- favorable add-on 后旧单减亏止损
- adverse add-on 后组级统一止损重锚定
- 补仓后的组合退出编排

### ai_stop_loss 层
负责：

- 仅在 `beMoved=true` 后继续结构 trailing
- 不再负责第一次保本

---

## 风险点

1. 逆势浮亏加仓非常容易演化成危险摊平
2. 若不做组级总风险约束，盈利加仓可能放大回撤
3. 若不区分 `adverse/favorable`，逻辑会互相污染
4. 若不将保本与 trailing 职责拆分，行为会持续不稳定
5. 若不把旧单止损收紧作为 favorable add-on 的前置动作，盈利加仓会变成单纯扩敞口

---

## 建议实施顺序

### Phase 1

- 拆分 `add_on_type`
- favorable add-on 小手数约束
- favorable add-on 后旧单减亏止损
- LLM 仅做保本后 trailing

### Phase 2

- adverse add-on 分层触发
- 价格/时间间隔控制
- 最大次数/总手数/总风险限制

### Phase 3

- 组级统一止损
- 组合退出/回撤保护
- 失败补仓回退逻辑

---

## 待 GLM-5.2 评估的问题

请从以下角度复核：

1. 风控是否合理，是否还有明显缺口
2. 逆势浮亏加仓的层级、间隔、手数约束是否足够保守
3. 同向盈利加仓后“新单更小 + 原单减亏止损”的联动是否合理
4. 是否应该把 `adverse add-on` 与 `favorable add-on` 完全拆成两条独立状态机
5. 对现有 gold-bot 架构（gate / riskgate / position_manager / ai_stop_loss）来说，最稳妥的落地方式是什么
6. 是否存在策略冲突、执行歧义或潜在爆仓 / 回撤放大风险
7. 如需调整，请给出更优参数区间与实现建议
