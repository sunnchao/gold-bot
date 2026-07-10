# 技术策略信号 vs AI Agent 信号冲突分析

## 执行时间：2026-07-10

## 核心发现：**技术策略信号和 AI 信号不会冲突** ✅

---

## 1. 两种信号的来源和标识

### 技术策略信号 (Technical Strategy Signals)
- **触发位置**: `apps/app-server/src/services/scheduler/service.ts:57-68`
  - 由 `SchedulerService.publishReplaySignal()` 在 K 线更新时触发
  - 调用 `AnalysisService.analyzeAccountSymbol()` 分析产生技术信号
  
- **策略标识**: `source: 'live_strategy'`
- **策略名**: 来自 replay 引擎的策略名，如：
  - `pullback`, `breakout_retest`, `divergence`, `breakout_pyramid`, 
  - `counter_pullback`, `range`

- **命令生成**: `apps/app-server/src/services/scheduler/service.ts:89-121`
  ```typescript
  const candidate: CommandCandidate = {
    command_id: commandId,
    source: 'live_strategy',  // 技术策略标识
    strategy: stringField(signalRecord, 'strategy'),  // 具体策略名
    symbol,
    type: stringField(signalRecord, 'side'),
    ...
  };
  ```

### AI Agent 信号
- **触发位置**: `apps/app-server/src/routes/ai-result-method.spec.ts` + `apps/app-server/src/services/ai-approve/command.ts:42`
  - 由 AI Agent 通过 `POST /api/v2/ai_result/{account}/{symbol}` 提交
  
- **策略标识**: `source: 'ai_approve'`, `strategy: 'ai_signal'`
- **命令生成**: `apps/app-server/src/services/ai-approve/command.ts:28-49`
  ```typescript
  const candidate: CommandCandidate = {
    command_id: `ai_pending_${input.accountId}_${input.symbol}_${unixNanos(input.nowIso)}`,
    source: 'ai_approve',     // AI 来源标识
    strategy: 'ai_signal',    // 固定策略名
    ...
  };
  ```

---

## 2. 持仓冲突检测机制

### AI 信号的持仓检测 (隔离机制)
**位置**: `apps/app-server/src/services/ai-approve/gate.ts:105-108`

```typescript
if (hasOpenPositionOnSide(positions, input.symbol, side, 'ai_signal')) {
  if (booleanField(input.tradePlan, 'add_on') !== true) {
    return reject('position.same_side');
  }
  // ... 加仓逻辑
}
```

**关键函数**: `gate.ts:305-322`
```typescript
function hasOpenPositionOnSide(
  positions: EaRecord[], 
  symbol: string, 
  side: string, 
  skipStrategy: string  // 关键参数：跳过的策略名
): boolean {
  for (const position of positions) {
    const strategy = stringField(position, 'strategy');
    // 只检查非 skipStrategy 的持仓
    if (skipStrategy.length > 0 && strategy.length > 0 && strategy !== skipStrategy) {
      continue;  // 跳过其他策略的持仓
    }
    if (stringField(position, 'type').trim().toUpperCase() === wantSide) {
      return true;
    }
  }
  return false;
}
```

**隔离效果**：
- AI 信号调用 `hasOpenPositionOnSide(positions, symbol, side, 'ai_signal')`
- **只检查 `strategy === 'ai_signal'` 的持仓**
- **忽略所有技术策略持仓** (`pullback`, `breakout_retest`, 等)

---

### Risk Gate 的持仓检测 (策略隔离)
**位置**: `packages/trading-core/src/riskgate/riskgate.ts:324-356`

```typescript
function positionConflictRejects(input: RiskGateInput): string[] {
  for (const position of input.state.positions) {
    // 核心策略过滤逻辑
    if ((input.sourceStrategy ?? '') !== '' && 
        (position.strategy ?? '') !== '' && 
        position.strategy !== input.sourceStrategy) {
      continue;  // 跳过不同策略的持仓
    }
    
    if (side === planSide && input.allowAdd !== true) {
      reasons.push('position.add_not_allowed');
    }
  }
  return reasons;
}
```

**传入 sourceStrategy**:
- **AI 信号**: `apps/app-server/src/app.ts:1479`
  ```typescript
  sourceStrategy: 'ai_signal'
  ```
- **技术策略信号**: 默认不传 `sourceStrategy` (为空字符串)

**隔离效果**：
- AI 信号：只检查 `strategy === 'ai_signal'` 的持仓
- 技术策略信号：检查所有持仓（因为 `sourceStrategy === ''`）

---

## 3. 命令队列去重机制

### 技术策略信号去重
**位置**: `apps/app-server/src/services/scheduler/service.ts:76-80`

```typescript
const triggerKey = liveDecisionKey(strategy, bars);
const commandId = liveCommandId(accountId, symbol, signalRecord, triggerKey);
if ((await this.store?.getCommand(commandId)) != null) {
  return;  // 已存在相同命令，不重复入队
}
```

**命令 ID 生成**: `scheduler/service.ts:374-383`
```typescript
function liveCommandId(accountId, symbol, signal, decisionKey): string {
  const seed = [
    accountId,
    symbol.toUpperCase(),
    stringField(signal, 'strategy'),  // 策略名参与 hash
    stringField(signal, 'side'),
    decisionKey  // 包含最新 K 线时间戳
  ].join('|');
  return `live_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}
```

### AI 信号去重
**位置**: `apps/app-server/src/services/ai-approve/command.ts:29`

```typescript
command_id: `ai_pending_${accountId}_${symbol}_${unixNanos(nowIso)}`
```

**特点**：
- 使用纳秒级时间戳，几乎不会重复
- 与技术策略命令 ID 格式完全不同

---

## 4. 策略映射配置

**位置**: `apps/app-server/src/app.ts:125-138`

```typescript
const DEFAULT_STRATEGY_MAPPING: EaRecord = {
  '20250231': 'pullback',
  '20250232': 'breakout_retest',
  '20250233': 'divergence',
  '20250234': 'breakout_pyramid',
  '20250235': 'counter_pullback',
  '20250236': 'range',
  '20250238': 'ai_signal'  // AI 信号占用 magic number
};
```

**Magic Number 分配**：
- 技术策略：20250231-20250236
- AI 信号：20250238
- **互不重叠**

---

## 5. 结论

### ✅ 不冲突的原因

1. **策略标识隔离**
   - 技术策略：`strategy ∈ {pullback, breakout_retest, ...}`
   - AI 信号：`strategy = 'ai_signal'`

2. **持仓检测隔离**
   - AI 信号只检查 `strategy === 'ai_signal'` 的持仓
   - 技术策略持仓对 AI 信号透明

3. **Risk Gate 策略过滤**
   - AI 信号传入 `sourceStrategy: 'ai_signal'`
   - Risk Gate 只对比同策略持仓

4. **命令 ID 生成不同**
   - 技术策略：`live_{hash(account|symbol|strategy|side|bars)}`
   - AI 信号：`ai_pending_{account}_{symbol}_{nanos}`

5. **Magic Number 隔离**
   - 技术策略和 AI 信号使用不同的 magic number

### ⚠️ 注意事项

1. **技术策略信号检测所有持仓**
   - 因为 `sourceStrategy === ''`，技术策略会看到 AI 持仓
   - 如果想让技术策略也隔离，需要传入对应的 `sourceStrategy`

2. **同一策略内不允许同向加仓**
   - 除非明确设置 `add_on: true` (AI 信号支持)
   - 技术策略默认不支持加仓

3. **命令去重依赖数据库查询**
   - `store.getCommand(commandId)` 必须正确实现
   - 避免重复入队

---

## 6. 代码路径总结

### 技术策略信号流程
```
EA POST /bars
  ↓
SchedulerService.enqueueAnalysis()
  ↓
publishReplaySignal()
  ↓
AnalysisService.analyzeAccountSymbol()
  ↓
queueReplaySignal()
  ↓
CommandCandidate { source: 'live_strategy', strategy: '具体策略名' }
  ↓
CommandLifecycleService.acceptCandidate()
  ↓
store.saveCommandCandidate()
```

### AI 信号流程
```
AI Agent POST /api/v2/ai_result/{account}/{symbol}
  ↓
handleAIResultRoute()
  ↓
evaluateAIApprovePendingGate() [检查同策略持仓]
  ↓
buildAIApproveCommandCandidate()
  ↓
CommandCandidate { source: 'ai_approve', strategy: 'ai_signal' }
  ↓
CommandLifecycleService.acceptCandidate()
  ↓
store.saveCommandCandidate()
```

### Risk Gate 策略过滤
```
evaluateRiskGate(input)
  ↓
positionConflictRejects(input)
  ↓
for each position:
  if (input.sourceStrategy !== '' && 
      position.strategy !== '' && 
      position.strategy !== input.sourceStrategy) {
    continue;  // 跳过不同策略持仓
  }
```

---

## 7. 验证测试用例

**已有测试覆盖**：
- `apps/app-server/src/services/ai-approve/gate.spec.ts`
  - 测试 AI 信号只检查 `ai_signal` 持仓
- `packages/trading-core/src/riskgate/riskgate.spec.ts`
  - 测试 Risk Gate 的策略过滤逻辑

**建议补充测试**：
```typescript
// 场景：技术策略 BUY 持仓 + AI 信号 BUY 请求
test('technical strategy position should not block ai signal', async () => {
  await store.updatePosition('90011087', {
    ticket: 1001,
    symbol: 'XAUUSD',
    type: 'BUY',
    lots: 0.1,
    strategy: 'pullback'  // 技术策略持仓
  });
  
  const aiTradePlan = {
    side: 'buy',
    strategy: 'ai_signal',  // AI 信号
    entry_zone: { min: 3335, max: 3340 },
    stop_loss: 3330,
    take_profit: [3350],
    max_lots: 0.05
  };
  
  const result = await evaluateAIApprovePendingGate({
    store,
    accountId: '90011087',
    symbol: 'XAUUSD',
    tradePlan: aiTradePlan,
    nowIso: '2026-07-10T10:00:00Z'
  });
  
  expect(result.accepted).toBe(true);  // 应该通过
});
```

---

**分析完成时间**: 2026-07-10  
**验证状态**: ✅ 通过代码审查  
**风险等级**: 低 (架构设计已隔离)
