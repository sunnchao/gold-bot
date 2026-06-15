# Phase 3: AI Signal Pending Order (AI 信号挂单)

## 问题背景

gold-analysis-agent 每 5 分钟运行 AI 分析后，通过 `POST /api/v2/ai_result` 将结果推送到 gold-bot 服务端。其中 `trade_plan.mode="approve"` 的 AI 决策目前仅落库保存，不产生任何可执行的 EA 命令。这导致 AI 分析中的高质量开仓信号被浪费，无法转化为实际交易。

## 需求摘要

新增 AI approve → EA PENDING 挂单的执行路径，同时保持现有技术面策略引擎的完整性和独立性。AI 信号挂单手数减半、挂单有效期 4 小时、仅使用 15 分钟以上周期数据。

## 核心设计决策

### 决策 1：不修改策略引擎，直接复用 PENDING 链路

**决策理由：** 策略引擎是被动触发的（EA push bars → Analyze），而 AI 是主动推送的。两者触发机制不同，强行融合需要架构级重构。

**方式：** 在 `handleAIResult()` 中新增 AI approve 判断逻辑，直接复用现有的 `buildSignalCommand()` 和 `orderTypeForSignal()` 函数，通过 `SIGNAL + order_type` 字段触发现有的 EA 端 `ExecutePending()`。

### 决策 2：手数缩减公式

**公式：** `math.Ceil(maxLots * 0.5 / 0.01) * 0.01`

| MaxLots | AI 手数 | 计算过程 |
|---------|---------|----------|
| 0.10 | 0.05 | 0.05 / 0.01 = 5.0 → Ceil(5.0)=5 → 0.05 |
| 0.05 | 0.03 | 0.025 / 0.01 = 2.5 → Ceil(2.5)=3 → 0.03 |
| 0.20 | 0.10 | 0.10 / 0.01 = 10.0 → Ceil(10.0)=10 → 0.10 |

### 决策 3：挂单有效期 4 小时

`expiration = now + 4h`，以 Unix 时间戳形式放入命令 payload。

EA 端已有 `OrderSend` 的 `expiration` 参数支持和挂单过期自动清理机制。

### 决策 4：Entry 价格取 EntryZone Midpoint

`entry = (entry_zone.min + entry_zone.max) / 2`

TradePlan 没有具体 entry_price 字段，只有 entry_zone 区间。取 midpoint 作为挂单价最合理。

### 决策 5：复用现有 SIGNAL 命令类型（不创建新 Action）

不新增 `CommandAction`，而是通过 payload 中的 `source=ai_approve` 字段区分来源。现有 EA 端 `ExecuteSignal()` 检测到 `order_type` 非 market 时自动委派给 `ExecutePending()`，完全兼容。

### 决策 6：分析周期优化（gold-analysis-agent 端）

AI 分析不再使用 M5/M1 数据，改为至少 M15。在 gold-analysis-agent 的 `sr-analyst.ts` 和 `risk-manager.ts` 中移除 M5 周期配置。

---

## 安全保护（5 层）

| # | 保护层 | 实现方式 | 代码位置 |
|---|--------|----------|----------|
| 1 | **RiskGate** | 复用现有 `evaluateRiskGate()` | `handlers_ai.go:121-125` |
| 2 | **置信度门槛** | `tradePlan.Confidence >= 70` | `handlers_ai.go` 新增 |
| 3 | **频率控制 + 去重** | 查询 commands 表，同 symbol+同方向+pending+source=ai_approve 的活跃挂单存在时跳过 | `handlers_ai.go` 新增 |
| 4 | **价格合理性** | entry 与当前市价偏离 > 3×ATR 则拒绝 | `handlers_ai.go` 新增 |
| 5 | **手数下限** | `aiLots < 0.01` 直接拒绝（小于最小交易单位） | `handlers_ai.go` 新增 |

---

## 代码改动范围

| 文件 | 改动 | 预估行数 |
|------|------|----------|
| `internal/api/handlers_ai.go` | 新增 AI approve → PENDING 逻辑，辅助函数 | +80 行 |
| `internal/legacy/live_trading.go` | 提取 `orderTypeForSignal()` 为包级导出函数 | 重构-0 行 |
| `gold-analysis-agent/src/agents/sr-analyst.ts` | 移除 M5 周期 | +5 行 |
| `gold-analysis-agent/src/agents/risk-manager.ts` | 移除 M5 周期 | +5 行 |
| **仅 Go 端改动** | | **+80 行** |

---

## 数据流

```
gold-analysis-agent (15分钟周期)
  ↓ POST /api/v2/ai_result/{account}/{symbol}
handleAIResult()
  ├─ 解析 trade_plan
  ├─ evaluateRiskGate()         ← 第1层：风险门
  ├─ 风险警报处理（现有逻辑）
  │
  └─ ★ 新增：AI approve 处理
       ├─ Confidence >= 70?     ← 第2层：置信度
       ├─ 去重检查?              ← 第3层：频率控制
       ├─ 价格合理性?             ← 第4层：偏离校验
       ├─ 手数 = Ceil(lots*0.5/0.01)*0.01
       ├─ entry = (min+max)/2
       ├─ order_type = deriveOrderType(entry, price, side)
       └─ Enqueue PENDING command {lots, entry, sl, tp, expiration=4h, source=ai_approve}
              ↓
       EA poll → ExecutePending()
         ├─ OrderSend → 挂单 (4h过期)
         ├─ 成交后 → OrderModify SL/TP
         └─ 过期 → OrderDelete
```

---

## 与现有系统关系

| 方面 | 策略引擎（技术面） | AI 信号（本方案） |
|------|-------------------|-------------------|
| **触发方式** | EA push bars → 被动分析 | AI push result → 主动接收 |
| **手数** | 策略引擎 default lots | 减半（maxLots * 0.5） |
| **挂单机制** | 距离 > 0.3×ATR → 自动转挂单 | 全部走挂单（PENDING） |
| **有效期** | 24h | 4h |
| **冲突检测** | 同向 1ATR 封锁 + 反向 2ATR 封锁 | 同 symbol 同方向去重（频率控制） |
| **来源标记** | `source=live_strategy` | `source=ai_approve` |

两条路径完全独立，不共享状态，不竞争资源。

---

## 边界条件

- **entry_zone.min == entry_zone.max**: 直接使用该值作为 entry
- **AI 服务超时/不可用**: 不影响策略引擎，不影响现有持仓
- **RiskGate Rejected**: 不生成任何命令，日志记录拒绝原因
- **Confidence < 70**: 静默跳过（日志记录）
- **同方向已有活跃 AI 挂单**: 静默跳过（日志记录）
- **市场关闭/休市**: RiskGate 会拒绝（market.closed），不走 AI approve 路径

---

*Created: 2026-06-15 for Phase 3*
