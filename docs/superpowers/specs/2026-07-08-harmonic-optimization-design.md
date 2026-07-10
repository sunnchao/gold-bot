# 谐波分析优化设计方案

> 日期: 2026-07-08
> 涉及: gold-bot 谐波形态检测引擎 + AI Agent 谐波分析管道

---

## 概览

对 gold-bot 的谐波分析体系进行两项优化：

1. **完善程序化谐波检测引擎** — 补全 Deep Crab、增强 Crab、可选支持 Shark
2. **用程序化检测取代 LLM 自主判断** — 让谐波分析走波浪/缠论同样的预计算路径

---

## 优化一：完善程序化谐波检测引擎

### 当前状态

程序化检测引擎位于 `packages/trading-core/src/harmonic/detector.ts`，支持 5 种形态：

| 形态 | PatternSpec | 规则 |
|------|-----------|------|
| ABCD | ✅ | AB=CD=1.0 |
| Gartley | ✅ | AB=XA×0.618, XD=XA×0.786, CD=1.272/1.618 |
| Bat | ✅ | AB=XA×0.382/0.500, XD=XA×0.886, CD=1.618/2.618 |
| Butterfly | ✅ | AB=XA×0.786, XD=XA×1.272/1.618, CD=1.618/2.618 |
| Crab | ✅ | AB=XA×0.382/0.618, XD=XA×1.618, CD=2.618 |

### 1.1 Crab 增强

**改动文件**: `packages/trading-core/src/harmonic/detector.ts`

**当前 Crab PatternSpec**:
```ts
{
  patternType: PATTERN_CRAB,
  abTargets: [target(0.382), target(0.618)],
  xdTargets: [target(1.618)],
  cdTargets: [target(2.618)],
  abcdTargets: [target(1.0)],
}
```

**改动**: 在 `cdTargets` 追加 3.14 和 3.618 延伸比例，覆盖极端蟹形。

```ts
cdTargets: [target(2.618), target(3.140), target(3.618)],
```

同时在 `toleranceByRatio` 中补充 3.140 的 tolerance。

### 1.2 Deep Crab 新增

**改动文件**: `packages/trading-core/src/harmonic/detector.ts`

新增 PatternSpec 条目和常量 `PATTERN_DEEP_CRAB = 'deep_crab'`。

| 规则 | 值 |
|------|-----|
| AB (XA 回撤) | 0.886 |
| XD (XA 延伸) | 1.128（可选，增加确认维度） |
| CD (BC 延伸) | 2.240 / 2.618 / 3.618 |
| AB=CD | 1.0 |

**PatternSpec**:
```ts
{
  patternType: PATTERN_DEEP_CRAB,
  abTargets: [target(0.886)],
  xdTargets: [target(1.128)],
  cdTargets: [target(2.240), target(2.618), target(3.618)],
  abcdTargets: [target(1.0)],
}
```

同时在 `types.ts` 中确认 `deep_crab` 在 HarmonicPattern.type 的类型联合中。

### 1.3 Shark（可选，低优先级）

**改动复杂度**: 中 — 需新增 6 点 swing 扫描循环。

Shark 形态（Scott Carney）是 5 浪结构 O-X-A-B-C-D：
- O→X: 初始段
- X→A: 回撤
- A→B: AB 延伸 1.13–1.618（B 超过 X）
- B→C: 回撤到 0.382–0.886 的 XA
- C→D: 基于 C 点交易，D 点止盈

当前扫描窗口只支持 4-5 个 swing 点，Shark 需要 6 点窗口（O-X-A-B-C-D）。

**当前不推荐实现**，因为：
- LLM Agent 已能识别 Shark
- 6 点窗口扫描复杂度高，可能与现有检测冲突
- 用户明确要求时再实施

### 1.4 相关文件变更清单

| 文件 | 改动 |
|------|------|
| `packages/trading-core/src/harmonic/types.ts` | 补充 `deep_crab` 到类型联合 |
| `packages/trading-core/src/harmonic/detector.ts` | Crab 增强 + Deep Crab PatternSpec + 常量 + tolerance |
| `packages/trading-core/src/harmonic/detector.spec.ts` | 新增 Deep Crab 检测用例，Crab 3.14/3.618 测试 |
| `packages/trading-core/src/index.ts` | 确认导出（如 Deep Crab 常量需导出） |

---

## 优化二：程序化检测取代 LLM 自主判断

### 当前架构

```
服务端计算:
  detectPatterns(H4/H1/M30 bars) → harmonic_context

Agent LLM Prompt 注入:
  {{HARMONIC_CTX}} 锚点 → "HARMONIC section MUST reflect {{HARMONIC_CTX}}"
  
LLM 输出:
  ## HARMONIC           ← LLM 仍然输出自己的分析
  - Detected Pattern: ...
  - Direction: ...
  ...
  
解析阶段:
  parseHarmonicSection(markdown)  → HarmonicAnalysisResult  ← 可能偏离程序化结果
  parseArbitrationSection(markdown) → HarmonicTheoryAnalysis ← 同样可能偏离
```

### 问题

1. LLM 输出格式中有 `## HARMONIC` 章节（prompt line 554-565），LLM 自行填写
2. 即使 prompt 说 "MUST reflect {{HARMONIC_CTX}}"，LLM 仍可能输出不同结果
3. 解析后的 `HarmonicAnalysisResult` 被用于仲裁，与程序化检测可能不一致
4. 与波浪/缠论对比：波浪和缠论是"MUST use without modification"，谐波是"MUST reflect"——措辞弱一级

### 目标架构

```
服务端计算:
  detectPatterns(H4/H1/M30 bars) → harmonic_context  ← 唯一权威来源

Agent LLM Prompt 注入:
  {{HARMONIC_CTX}} 锚点 → "MUST use without modification"（同波浪/缠论）

LLM 输出:                    解析:
  ## TECHNICAL               TechnicalAnalysis
  ## WAVE                    WaveAnalysis          ← 预计算，LLM 引用
  ## CHANLUN                 ChanlunAnalysis        ← 预计算，LLM 引用
  ## RISK                    RiskAssessment
  ## ARBITRATION             ArbitrationResult
                              HarmonicAnalysisResult ← 从程序化检测直接填充
                              HarmonicTheoryAnalysis ← 从程序化检测直接填充
```

### 2.1 删除 LLM 的 HARMONIC 章节

**改动文件**: `apps/app-agent/src/agents/comprehensive-analyst.ts`

**位置**: 删除 LLM 输出格式模板中的 `## HARMONIC` 章节（约 line 554-565 共 12 行）

删除内容:
```
## HARMONIC
- Detected Pattern: gartley | bat | butterfly | crab | abcd | cypher | shark | none
- Direction: bullish | bearish | neutral
- Timeframe: <H4 | H1 | M30 or "N/A" if none>
- Completion: <0-100%>
- Confidence: <0-100>
- D Zone Price: <number or 0 if none>
- Entry Zone: <price range string or "N/A">
- Stop Loss: <absolute stop loss price level or 0 if none>
- Take Profit 1: <absolute take profit price level or 0 if none>
- Take Profit 2: <absolute take profit price level or 0 if none>
- Rationale: <bilingual string>
```

### 2.2 强化 {{HARMONIC_CTX}} 指令

**改动文件**: `apps/app-agent/src/agents/comprehensive-analyst.ts`

**位置**: 约 line 642-650

当前:
```
- {{HARMONIC_CTX}}: Pre-computed harmonic pattern detection
  - detected_pattern, direction, confidence, d_zone_price, completion_pct
  - Use exactly as provided; set detected_pattern="none" if empty

...

- The HARMONIC section MUST reflect {{HARMONIC_CTX}} — use detected_pattern, direction, confidence directly
- If {{HARMONIC_CTX}} is empty, set detected_pattern="none" and direction="neutral"
```

改为:
```
- {{HARMONIC_CTX}}: Pre-computed harmonic pattern detection
  - detected_pattern, direction, confidence, d_zone_price, completion_pct
  - Use exactly as provided without recalculation; set to "none" if empty
```

同时删除 HARMONIC 引用指令（因为 HARMONIC 章节已被删除），整合到 INTEGRATION INSTRUCTIONS 中。

### 2.3 从程序化检测直接构建 HarmonicAnalysisResult

**改动文件**: `apps/app-agent/src/agents/comprehensive-analyst.ts`

**位置**: 函数 `parseFirstPhaseMarkdown()` 中解析 HARMONIC 的部分（约 line 921-937）

**改动**: 不再从 LLM markdown 的 HARMONIC 章节解析，而是从 payload 的 `harmonic_context` 直接构建。

```ts
// 替换前：从 markdown 解析
const harmonicSection = sections.get('harmonic') || '';
const harmonicFields = extractFields(harmonicSection);
const harmonic: HarmonicAnalysisResult = {
  detected_pattern: getEnumField(harmonicFields, 'detected_pattern', ...),
  ...
};

// 替换后：从程序化检测结果直接构建
const harmonic: HarmonicAnalysisResult = buildHarmonicFromContext(payload.harmonic_context);
```

### 2.4 buildHarmonicFromContext 辅助函数

```ts
function buildHarmonicFromContext(ctx: HarmonicContext | undefined | null): HarmonicAnalysisResult {
  if (!ctx || !ctx.active_pattern) {
    return {
      detected_pattern: 'none',
      direction: 'neutral',
      timeframe: 'N/A',
      completion_pct: 0,
      confidence: 0,
      d_zone_price: 0,
      entry_zone: 'N/A',
      stop_loss: 0,
      take_profit_1: 0,
      take_profit_2: 0,
      rationale: '无程序化谐波形态检测到 (No programmatic harmonic pattern detected)',
    };
  }

  const ap = ctx.active_pattern;
  return {
    detected_pattern: ap.type as HarmonicAnalysisResult['detected_pattern'],
    direction: ap.direction as 'bullish' | 'bearish' | 'neutral',
    timeframe: ap.timeframe,
    completion_pct: ap.confidence ?? ap.score,
    confidence: ap.confidence ?? ap.score,
    d_zone_price: (ap.przLow + ap.przHigh) / 2,
    entry_zone: `${ap.przLow.toFixed(2)}-${ap.przHigh.toFixed(2)}`,
    stop_loss: ap.stopLoss,
    take_profit_1: ap.target1,
    take_profit_2: ap.target2,
    rationale: ap.reason || `程序化检测到 ${ap.timeframe} ${ap.direction} ${ap.type} 形态，PRZ=${ap.przLow}-${ap.przHigh}`,
  };
}
```

### 2.5 Arbitration 中的谐波同样从程序化检测填充

**改动文件**: `apps/app-agent/src/agents/comprehensive-analyst.ts`

**位置**: 约 line 985-990，解析 `harmonicTheory` 的部分

从 LLM markdown 的 `Harmonic Pattern` 字段改为从 `harmonic_context.active_pattern` 构建：

```ts
const harmonicTheory: HarmonicTheoryAnalysis = harmonic.active_pattern
  ? {
      pattern: harmonic.detected_pattern,
      direction: harmonic.direction,
      confidence: harmonic.confidence,
      rationale: harmonic.rationale,
    }
  : {
      pattern: 'none',
      direction: 'neutral',
      confidence: 0,
      rationale: '无程序化谐波形态',
    };
```

### 2.6 相关文件变更清单

| 文件 | 改动 |
|------|------|
| `apps/app-agent/src/agents/comprehensive-analyst.ts` | 删除 HARMONIC 输出格式、强化指令、替换解析逻辑、新增辅助函数 |
| `apps/app-agent/src/agents/comprehensive-analyst.test.ts` | 适配测试用例：不再期望 LLM HARMONIC 章节，改为测试程序化路径 |
| `apps/app-agent/src/types/goldbot.ts` | 如有必要补充 HarmonicContext 的完整类型 |

---

## 实现优先级

| 优先级 | 模块 | 工作量 | 风险 |
|--------|------|--------|------|
| **P0** | 优化二 2.1-2.4（删除 LLM HARMONIC + 程序化填充） | ~50 行 / 3 文件 | 低 — 模式与波浪/缠论一致 |
| **P1** | 优化一 1.1（Crab 增强 3.14/3.618） | ~5 行 / 1 文件 | 极低 |
| **P1** | 优化一 1.2（Deep Crab 新增） | ~15 行 / 2 文件 | 低 — 标准 PatternSpec 模式 |
| **P2** | 优化二 2.5（Arbitration 谐波同步） | ~20 行 / 1 文件 | 低 — 跟随 2.1-2.4 模式 |
| **P3** | 优化一 1.3（Shark 6 点扫描） | 待评估 | 中 — 架构变更 |