# Gold Bot Node.js 策略修复实施清单

本文档列出了从 Go 版本移植到 Node.js 版本的所有缺失功能及其实施状态。

## ✅ 已完成的核心模块

### 1. SR-based SL/TP (pickSLTP)
**文件**: `packages/trading-core/src/replay/sr-sltp.ts`

**功能**:
- 智能止损止盈计算，基于支撑阻力位（EMA20/50, BB, Fib, Pivot）
- AI 建议优先级最高
- 距离约束检查（minDistATR, maxDistATR）
- Buffer 缓冲区避免过于贴近支撑阻力
- ATR 倍数作为后备方案

**使用方法**:
```typescript
import { pickSLTP } from './sr-sltp.js';

const result = pickSLTP(
  'BUY',           // side
  price,           // current price
  lastBar,         // bar with SR levels
  atr,             // ATR value
  precision,       // price precision
  cfg,             // strategy config
  aiResult         // optional AI suggestions
);

if (result.usedSR) {
  signal.stop_loss = result.sl;
  signal.tp1 = result.tp1;
  signal.tp2 = result.tp2;
}
```

---

### 2. Fibonacci Extension TP
**文件**: `packages/trading-core/src/replay/fib-extension.ts`

**功能**:
- 检测最近 swing high/low
- 计算 Fib 1.272 / 1.618 / 2.618 扩展位
- H4 优先，H1 后备
- ADX 强度过滤
- 信号方向必须与趋势一致

**使用方法**:
```typescript
import { applyFibExtensionTP } from './fib-extension.js';

signal = applyFibExtensionTP(
  signal,
  h4Bars,
  h1Bars,
  price,
  atr,
  cfg.fibExtension,  // { enabled, useH4Preference, swingWindow, minADX }
  precision
) ?? signal;
```

---

### 3. Scale-In 策略（浮亏加仓）
**文件**: `packages/trading-core/src/replay/scale-in.ts`

**功能**:
- 同向浮亏持仓检测
- ADX 趋势强度验证
- 距离约束（minDistATR, minFloatLossATR）
- 加仓次数限制（maxAddCount）
- 时间间隔限制（minIntervalMin）
- 技术位确认（Fib, Pivot, EMA, RSI）
- 手数衰减（lotDecay）
- 统一止损计算（加权平均）

**使用方法**:
```typescript
import { checkScaleIn } from './scale-in.js';

const result = checkScaleIn(
  h1Bars,
  price,
  atr,
  positions,    // existing positions
  cfg,
  precision
);

if (result.signal) {
  // Use result.signal with all scale-in metadata
}
```

---

### 4. SMC Context 评分加成
**文件**: `packages/trading-core/src/replay/smc-scoring.ts`

**功能**:
- CHoCH 确认: +1 分
- Sweep 确认: +1 分
- Order Block 确认: +1 分
- FVG 确认: +1 分
- 支持 H1/M30/M15 多时间框架

**使用方法**:
```typescript
import { calculateSMCBonus } from './smc-scoring.js';

score += calculateSMCBonus(
  smc,
  'BUY',
  price,
  atr,
  'h1'  // or 'm30', 'm15'
);
```

---

### 5. M30 Breakout Cache 二次确认
**文件**: `packages/trading-core/src/replay/breakout-cache.ts`

**功能**:
- H1 收盘突破 BB → 缓存
- M30 收盘仍在 BB 外 → 确认信号
- 假突破过滤（M30 回到 BB 内）
- TTL: 1 小时自动过期

**使用方法**:
```typescript
import { confirmBreakoutPyramid } from './breakout-cache.js';

const confirmResult = confirmBreakoutPyramid(
  symbol,
  'BUY',
  bbLevel,      // H1 BB upper/lower
  m30Bars,
  signal,
  signalMessage
);

if (!confirmResult.confirmed) {
  return null;  // Wait for M30 confirmation or rejected
}

return signal;
```

---

## 🚧 需要手动集成到 replay.ts 的部分

### 修改清单

#### 1. 导入新模块（已完成）
```typescript
import { getStrategyConfigBySymbol } from '../engine/config.js';
import { pickSLTP } from './sr-sltp.js';
import { applyFibExtensionTP } from './fib-extension.js';
import { checkScaleIn } from './scale-in.js';
import { calculateSMCBonus } from './smc-scoring.js';
import { confirmBreakoutPyramid } from './breakout-cache.js';
```

#### 2. 更新 ReplaySmcContext 类型（已完成）
添加 M30/M15 SMC 字段：
```typescript
export type ReplaySmcContext = {
  h1_breaks: ReplayStructureBreak[];
  h1_sweeps: ReplayLiquiditySweep[];
  h1_obs?: ReplayOrderBlock[];
  h1_short_obs?: ReplayOrderBlock[];
  h1_fvgs?: ReplayFVG[];
  m30_breaks?: ReplayStructureBreak[];
  m30_sweeps?: ReplayLiquiditySweep[];
  m30_obs?: ReplayOrderBlock[];
  m30_fvgs?: ReplayFVG[];
  m15_breaks?: ReplayStructureBreak[];
  m15_sweeps?: ReplayLiquiditySweep[];
  m15_obs?: ReplayOrderBlock[];
  m15_fvgs?: ReplayFVG[];
};
```

#### 3. 修改 collectReplayCandidates 签名（已完成）
添加 `symbol`, `positions`, `aiResult` 参数

#### 4. 修改 evaluatePullbackSignal

**需要修改的位置**: `replay.ts:1837`

**变更**:
```typescript
function evaluatePullbackSignal(
  h1: EnrichedReplayBar[],
  h4: EnrichedReplayBar[],
  price: number,
  pricePrecision: number,
  symbol: string,
  smc: ReplaySmcContext | undefined,
  aiResult?: ReplayAIResult
): ReplaySignal | null {
  const cfg = getStrategyConfigBySymbol(symbol);
  
  // Replace pullbackConfig.minAdx with cfg.pullbackMinADX
  if (last.adx < cfg.pullbackMinADX) {
    return null;
  }
  
  // Replace pullbackConfig.distAtr with cfg.pullbackDistATR
  const threshold = atrValue * cfg.pullbackDistATR;
  
  // Replace pullbackConfig.rsiOverbought with cfg.pullbackRSIOverbought
  if (last.rsi >= cfg.pullbackRSIOverbought) {
    return null;
  }
  
  // Add SMC bonus
  const smcBonus = calculateSMCBonus(smc, side, price, atrValue, 'h1');
  let score = pullbackScore(side, last, nearEma) + smcBonus;
  
  // Build signal with config-based SL/TP
  let signal = buildPullbackSignal(side, price, atrValue, score, pricePrecision);
  
  // Apply SR-based SL/TP
  const srResult = pickSLTP(side, price, last, atrValue, pricePrecision, cfg, aiResult);
  if (srResult.usedSR) {
    signal.stop_loss = srResult.sl;
    signal.tp1 = srResult.tp1;
    signal.tp2 = srResult.tp2;
  }
  
  // Apply Fib Extension TP
  signal = applyFibExtensionTP(signal, h4, h1, price, atrValue, cfg.fibExtension, pricePrecision) ?? signal;
  
  return signal;
}
```

#### 5. 修改 evaluateBreakoutRetestSignal

**需要修改的位置**: `replay.ts:1900`

**变更**:
```typescript
function evaluateBreakoutRetestSignal(
  h1: EnrichedReplayBar[],
  price: number,
  pricePrecision: number,
  symbol: string,
  smc: ReplaySmcContext | undefined,
  aiResult?: ReplayAIResult
): ReplaySignal | null {
  const cfg = getStrategyConfigBySymbol(symbol);
  
  // Use cfg.breakoutRetestLookback, cfg.breakoutRetestDistATR, etc.
  if (h1.length < cfg.breakoutRetestLookback + 5 || price <= 0) {
    return null;
  }
  
  // Add SMC bonus
  const smcBonus = calculateSMCBonus(smc, side, price, atrValue, 'h1');
  let score = breakoutRetestScore(side, last, touchCount) + smcBonus;
  
  let signal = buildBreakoutRetestSignal(side, price, atrValue, level, score, pricePrecision);
  
  // Apply SR-based SL/TP
  const srResult = pickSLTP(side, price, last, atrValue, pricePrecision, cfg, aiResult);
  if (srResult.usedSR) {
    signal.stop_loss = srResult.sl;
    signal.tp1 = srResult.tp1;
    signal.tp2 = srResult.tp2;
  }
  
  return signal;
}
```

#### 6. 修改 evaluateDivergenceSignal

**需要修改的位置**: `replay.ts:1989`

**变更**:
```typescript
function evaluateDivergenceSignal(
  h1: EnrichedReplayBar[],
  price: number,
  pricePrecision: number,
  symbol: string,
  smc: ReplaySmcContext | undefined,
  aiResult?: ReplayAIResult
): ReplaySignal | null {
  const cfg = getStrategyConfigBySymbol(symbol);
  
  // Use cfg.divergenceWindowRecent, cfg.divergenceWindowPrev
  const needed = cfg.divergenceWindowRecent + cfg.divergenceWindowPrev;
  
  // Add SMC bonus
  const smcBonus = calculateSMCBonus(smc, side, price, atrValue, 'h1');
  let score = divergenceScore(side, last) + smcBonus;
  
  let signal = buildDivergenceSignal(side, price, atrValue, score, pricePrecision);
  
  // Apply SR-based SL/TP
  const srResult = pickSLTP(side, price, last, atrValue, pricePrecision, cfg, aiResult);
  if (srResult.usedSR) {
    signal.stop_loss = srResult.sl;
    signal.tp1 = srResult.tp1;
    signal.tp2 = srResult.tp2;
  }
  
  return signal;
}
```

#### 7. 修改 evaluateCounterPullbackSignal（时间框架错配修复）

**需要修改的位置**: `replay.ts:2097`

**变更**:
```typescript
function evaluateCounterPullbackSignal(
  m30: EnrichedReplayBar[],  // Changed from h1
  m15: EnrichedReplayBar[],  // Added
  price: number,
  smc: ReplaySmcContext | undefined,
  pricePrecision: number,
  symbol: string,
  aiResult?: ReplayAIResult
): ReplaySignal | null {
  const cfg = getStrategyConfigBySymbol(symbol);
  
  // Prefer M30, fallback to M15
  const primaryBars = m30.length >= 20 ? m30 : m15;
  const primaryBreaks = m30.length >= 20 ? smc?.m30_breaks : smc?.m15_breaks;
  const primarySweeps = m30.length >= 20 ? smc?.m30_sweeps : smc?.m15_sweeps;
  const primaryOBs = m30.length >= 20 ? smc?.m30_obs : smc?.m15_obs;
  
  if (!primaryBreaks || primaryBars.length < 20) {
    return null;
  }
  
  // Find recent CHoCH from M30/M15 breaks
  let recentCHoCH = null;
  for (let i = primaryBreaks.length - 1; i >= 0; i--) {
    if (primaryBreaks[i].type === 'CHoCH') {
      recentCHoCH = primaryBreaks[i];
      break;
    }
  }
  
  if (!recentCHoCH) {
    return null;
  }
  
  // ... rest of counter_pullback logic using M30/M15 data
  
  // Add SMC bonus (from M30 or M15)
  const timeframe = m30.length >= 20 ? 'm30' : 'm15';
  const smcBonus = calculateSMCBonus(smc, side, price, atrValue, timeframe);
  let score = 5 + smcBonus;
  
  let signal = buildCounterPullbackSignal(side, price, atrValue, score, pricePrecision);
  
  // Apply SR-based SL/TP
  const lastBar = primaryBars[primaryBars.length - 1];
  const srResult = pickSLTP(side, price, lastBar, atrValue, pricePrecision, cfg, aiResult);
  if (srResult.usedSR) {
    signal.stop_loss = srResult.sl;
    signal.tp1 = srResult.tp1;
    signal.tp2 = srResult.tp2;
  }
  
  return signal;
}
```

#### 8. 修改 evaluateBreakoutPyramidSignal

**需要修改的位置**: `replay.ts:2222`

**变更**:
```typescript
function evaluateBreakoutPyramidSignal(
  h1: EnrichedReplayBar[],
  m30: EnrichedReplayBar[],  // Added for confirmation
  price: number,
  smc: ReplaySmcContext | undefined,
  pricePrecision: number,
  symbol: string
): ReplaySignal | null {
  const cfg = getStrategyConfigBySymbol(symbol);
  
  if (h1.length < 30) {
    return null;
  }
  
  const last = h1[h1.length - 1];
  const atrValue = last.atr;
  
  // Use cfg.breakoutPyramidMinADX
  if (last.adx < cfg.breakoutPyramidMinADX) {
    return null;
  }
  
  // ... breakout detection
  
  if (last.close > last.bb_upper && last.ema20 > last.ema50) {
    // Add SMC bonus
    const smcBonus = calculateSMCBonus(smc, 'BUY', price, atrValue, 'h1');
    let score = 6 + smcBonus;
    
    let signal: ReplaySignal = {
      side: 'BUY',
      entry: price,
      stop_loss: last.ema20 - atrValue * cfg.breakoutPyramidSLATR,
      tp1: price + atrValue * 2.0,
      tp2: price + atrValue * 5.0,
      score,
      strategy: 'breakout_pyramid',
      atr: atrValue,
      all_strategies: []
    };
    
    // Apply Fib Extension TP
    signal = applyFibExtensionTP(signal, [], h1, price, atrValue, cfg.fibExtension, pricePrecision) ?? signal;
    
    // M30 confirmation
    const confirmResult = confirmBreakoutPyramid(
      symbol,
      'BUY',
      last.bb_upper,
      m30,
      signal,
      `BUY 突破布林上轨 score=${score}`
    );
    
    if (!confirmResult.confirmed) {
      return null;  // Wait for M30 or rejected as false breakout
    }
    
    return signal;
  }
  
  // Similar for SELL side
  
  return null;
}
```

#### 9. 添加 evaluateScaleInSignal

**需要添加的位置**: 在其他策略函数之后

**代码**: 参考 `scale-in-wrapper.ts` 文件

---

## 📋 实施优先级

### 高优先级（核心功能）
1. ✅ SR-based SL/TP integration - 所有策略都受益
2. ✅ Scale-In strategy - 完全缺失的策略
3. ✅ Per-symbol config integration - 避免硬编码配置
4. 🔧 Counter_Pullback timeframe fix - 当前使用错误时间框架

### 中优先级（增强功能）
5. ✅ Fib Extension TP - 更好的止盈目标
6. ✅ M30 Breakout Cache - 减少假突破
7. ✅ SMC Context scoring - 提升信号质量

### 低优先级（已有但可优化）
8. Position Conflict Filter - 已存在但可能需要微调

---

## 🧪 测试建议

### 单元测试
```typescript
import { pickSLTP } from './sr-sltp.js';
import { applyFibExtensionTP } from './fib-extension.js';
import { checkScaleIn } from './scale-in.js';
import { calculateSMCBonus } from './smc-scoring.js';
import { confirmBreakoutPyramid } from './breakout-cache.js';

describe('SR-based SL/TP', () => {
  it('should use AI override when available', () => {
    // Test AI priority
  });
  
  it('should find closest SR level within constraints', () => {
    // Test SR detection
  });
  
  it('should fallback to ATR when no valid SR', () => {
    // Test fallback
  });
});

describe('Scale-In Strategy', () => {
  it('should reject when no floating loss', () => {
    // Test entry conditions
  });
  
  it('should calculate unified SL correctly', () => {
    // Test weighted average SL
  });
  
  it('should respect max add count', () => {
    // Test limits
  });
});
```

### 集成测试
1. 运行 replay with historical data
2. 验证信号生成正确性
3. 对比 Go 版本输出

---

## 📦 依赖关系

```
replay.ts
  ├─ sr-sltp.ts (独立)
  ├─ fib-extension.ts (独立)
  ├─ scale-in.ts (独立)
  ├─ smc-scoring.ts (独立)
  ├─ breakout-cache.ts (独立)
  └─ engine/config.ts (已存在)
```

所有新模块都是独立的，可以逐步集成。

---

## 🎯 下一步行动

1. **立即**: 手动应用 replay.ts 修改（参考上面的清单）
2. **验证**: 运行 `pnpm build` 检查编译错误
3. **测试**: 使用 replay 测试数据验证新策略
4. **部署**: 更新生产环境配置

---

## 📝 配置示例

### StrategyConfig (packages/trading-core/src/engine/config.ts)

已存在的配置字段：
- `pullbackMinADX`, `pullbackDistATR`, `pullbackRSIOversold`, `pullbackRSIOverbought`
- `breakoutRetestLookback`, `breakoutRetestDistATR`
- `divergenceWindowRecent`, `divergenceWindowPrev`
- `breakoutPyramidMinADX`, `breakoutPyramidSLATR`
- `scaleInEnabled`, `scaleInMinADX`, `scaleInMaxAddCount`, `scaleInLotDecay`
- `fibExtension: { enabled, useH4Preference, swingWindow, minADX }`
- `srMinDistATR`, `srMaxDistATR`, `srBufferATR`

---

## ⚠️ 已知问题

1. **Pivot Points 缺失**: 当前 enrichBars 未计算 PP/S1/R1，Scale-In 中相关检查会失效
2. **EMA200 缺失**: enrichBars 未计算 EMA200，Scale-In 中相关检查会失效
3. **VolSMA 可选**: 部分策略依赖 VolSMA，需确保 EA 上传该字段

**解决方案**: 在 enrichBars() 中添加计算，或在策略中容错处理。

---

## 📊 预期效果

| 功能 | Go 版本 | Node 当前 | Node 修复后 |
|------|---------|-----------|-------------|
| SR-based SL/TP | ✅ | ❌ | ✅ |
| Fib Extension TP | ✅ | ❌ | ✅ |
| Scale-In 策略 | ✅ | ❌ | ✅ |
| SMC 评分加成 | ✅ | ❌ | ✅ |
| M30 Breakout 确认 | ✅ | ❌ | ✅ |
| Counter_Pullback M30 | ✅ | ❌ (用H1) | ✅ |
| Per-symbol Config | ✅ | 部分 | ✅ |

---

**最后更新**: 2026-07-10
**状态**: 核心模块已实现，等待集成到 replay.ts
