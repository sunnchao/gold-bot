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

---

## 缺陷与修订补充（2026-07-08 评审）

> 本节为代码审查后追加，记录原设计方案在落地前必须修复的阻断性问题和遗漏点。原文 2.1-2.5 的写法若直接实现会导致 TypeScript 编译失败、Zod 字段被剥离、JSON 兜底路径崩溃，必须按下述修订执行。

### A. 阻断性问题（优化二落地前必须修）

#### A1. agent 侧 `HarmonicPatternSchema` 缺字段，Zod 会剥离 PRZ/止损/止盈

- **位置**: `apps/app-agent/src/types/schemas.ts:452-470`
- **现状**: `HarmonicPatternSchema` 仅声明 `type/direction/timeframe/score/x_price..d_price/各 ratio/completion_pct?/is_active?/reason`，**缺** `prz_low/prz_high/stop_loss/target_1/target_2/confidence/invalidated/status`。
- **后果**: 服务端 `app.ts` 的 `normalizeHarmonicPattern` 虽以 snake_case 发送这些字段，但经 `safeParseResponse` Zod 解析后未声明字段被 strip，`buildHarmonicFromContext` 读取时全部为 `undefined`；`ap.przLow`(camelCase) 更连属性都不存在，TS 编译失败。
- **修订**:
  1. `apps/app-agent/src/types/goldbot.ts:172-201` 的 `HarmonicPattern` 接口补全 snake_case 字段：`prz_low/prz_high/stop_loss/target_1/target_2/confidence/invalidated/status`。
  2. `schemas.ts:452-470` `HarmonicPatternSchema` 同步补全上述字段（或对整个对象 `.passthrough()`），保证 Zod 不剥离。
  3. `buildHarmonicFromContext` 内部字段访问**全部改用 snake_case**（`ap.prz_low` 等），与 payload 一致。

#### A2. `detected_pattern` 枚举缺 `deep_crab`

- **位置**: `apps/app-agent/src/types/schemas.ts:162`（`HarmonicAnalysisResultSchema.detected_pattern`）、`comprehensive-analyst.ts:926`（Markdown 解析）、`:986`（仲裁 `harmonic_pattern`）
- **现状**: 三处枚举均为 `['gartley','bat','butterfly','crab','abcd','cypher','shark','none']`，无 `deep_crab`。
- **后果**: Deep Crab 经 `buildHarmonicFromContext` 注入后，若再过 `HarmonicAnalysisResultSchema`/`normalizeComprehensive` 任何一处枚举校验即被拒。
- **修订**: 三处枚举统一追加 `'deep_crab'`。

#### A3. `ComprehensiveAnalysisDataSchema.harmonic` 必填，删 HARMONIC 章节后 JSON 路径必崩

- **位置**: `apps/app-agent/src/types/schemas.ts:176-183`
- **现状**: `harmonic: HarmonicAnalysisResultSchema` 非 optional。
- **后果**: 删除 prompt 的 `## HARMONIC` 章节后，LLM 若直吐 JSON 不带 `harmonic` → `safeParseResponse` 失败 → 走 `buildFallback`。即优化二在 JSON 输出格式下完全失效。
- **修订**: 改 `harmonic: HarmonicAnalysisResultSchema.optional()`；程序化结果由 post-parse 覆盖点注入，不再依赖 LLM 提供。

#### A4. 2.5 代码 `harmonic.active_pattern` 是 bug

- **位置**: 原文 2.5
- **现状**: `const harmonicTheory = harmonic.active_pattern ? {...}` —— `harmonic: HarmonicAnalysisResult` 上无 `active_pattern` 属性，该字段属于 `payload.harmonic_context`。
- **后果**: TS 编译错误；逻辑语义错误。
- **修订**: 重写为基于 `ctx.active_pattern` 判断：
  ```ts
  const harmonicTheory: HarmonicTheoryAnalysis = ctx?.active_pattern
    ? { pattern: harmonic.detected_pattern, direction: harmonic.direction, confidence: harmonic.confidence, rationale: harmonic.rationale }
    : { pattern: 'none', direction: 'neutral', confidence: 0, rationale: '无程序化谐波形态' };
  ```

### B. 设计遗漏（补充进方案）

#### B1. JSON 兜底路径完全未处理 → 改为 post-parse 单点覆盖

- **位置**: `comprehensive-analyst.ts:1186-1225`（双格式解析）
- **现状**: 原方案 2.3 只改 Markdown 路径（`:921-937`），JSON 路径 `safeParseResponse(raw, ComprehensiveAnalysisDataSchema)` 仍期望 LLM 产 `harmonic`。
- **修订**（替代原 2.3 与 2.5 分散改法）: 在 `normalizeComprehensive` 之后、`return` 之前新增**无条件单点覆盖**，同时覆盖 Markdown 与 JSON 两条路径：
  ```ts
  result.harmonic = buildHarmonicFromContext(payload.harmonic_context);
  result.arbitration.harmonic_theory = buildHarmonicTheoryFromContext(payload.harmonic_context);
  ```
  比原文在 `parseMarkdownResponse` 内分两处改更简洁、更不易漏，且天然覆盖 `buildFallback` 之外的真实结果。

#### B2. prompt "6 sections / ALL 6 REQUIRED" 措辞未同步

- **位置**: `comprehensive-analyst.ts:473-488`（`buildCommonSystemPrompt`）、`:762-766`（Final Reminders）
- **现状**: 多处声明 "exactly these 6 sections"、"ALL 6 sections are REQUIRED"、"Output MUST include all 6 top-level sections"。
- **后果**: 删 `## HARMONIC` 后 LLM 只剩 5 章节，prompt 仍说 6，可能硬凑空 HARMONIC 或困惑。
- **修订**: 两处 "6 → 5"，把 HARMONIC 从章节列表移除，明确 harmonic 由系统注入、LLM 无需输出。

#### B3. stable/volatile 分层与测试影响未评估

- **位置**: `comprehensive-analyst.ts:309-381`（`sanitizeHarmonicPatternStable`/`Volatile`）、`:398-467`（测试）
- **现状**: stable 层只留 type/direction/timeframe/prices/ratios；volatile 层只留 score/completion_pct/reason。`prz_low/stop_loss/target_1/target_2/confidence` 不在任何一层 → 未进 `{{HARMONIC_CTX}}`。
- **修订**:
  1. 将 PRZ/止损/止盈/confidence 归入 **stable 层**（其随形态固定，不随 tick 漂移）。
  2. 同步更新 `comprehensive-analyst.test.ts:398-428` 的 fixture 造 `prz_low/prz_high/stop_loss/target_1/target_2`。
  3. 更新 `:454-463` 断言：stable 层应含这些新字段；`not.toContain('"reason"')` 等保留（reason 仍属 volatile）。

#### B4. `completion_pct` 语义混用

- **位置**: 原方案 2.4 `buildHarmonicFromContext`
- **现状**: `completion_pct = ap.confidence ?? ap.score`、`confidence = ap.confidence ?? ap.score` 两者取同一值；trading-core 内部无 `completionPct` 字段，服务端未输出。
- **后果**: 把"LLM 时代的形态完成度"用 score/100 顶替，将完成度与置信度混为一值，下游可能误读为两个独立信号。
- **修订**: 二选一——
  - 真正计算 completion（D 距 PRZ 中心的归一化距离，落 trading-core 并经服务端输出）；或
  - 文档明确声明"暂以 confidence 同时表示 completion_pct，二者同源"，并在 `buildHarmonicFromContext` 注明。

### C. 优化一的修订

#### C1. `toleranceByRatio` 缺 1.128/2.240/3.140/3.618 容差

- **位置**: `detector.ts:53-63`
- **现状**: 仅有 0.382…2.618 九档；新增的 1.128/2.240/3.140/3.618 无条目，`target()` fallback 到 `0.05`。
- **后果**: 2.240 夹在 1.618(0.10) 与 2.618(0.15) 之间却仅给 0.05，容差不一致；3.140/3.618 用 0.05 在 XAUUSD 上过严，Deep Crab 的 CD 段几乎无法命中。
- **修订**: 显式追加
  ```ts
  1.128: 0.05,
  2.240: 0.12,
  3.140: 0.15,
  3.618: 0.18,
  ```

#### C2. Deep Crab XD=1.128 "可选" 与 PatternSpec 强制校验矛盾

- **位置**: 原方案 1.2 与 `detector.ts:342-346`
- **现状**: 1.2 表格标 XD=1.128"（可选，增加确认维度）"，但 PatternSpec `xdTargets: [target(1.128)]` 在 `validateCandidate` 里对非空 `xdTargets` 强制 `bestRatioQuality`，不命中即 `return false`——"可选"实为"强制命中"，否则整个 Deep Crab 被丢弃。
- **修订**: 澄清语义——
  - 若真可选：改 `xdTargets: [target(1.128), target(1.13)]` 并放宽 1.128 容差，或改为"XD 容忍区间 1.128–1.13"；
  - 若强制：删去"可选"二字，明确 XD 必须命中 1.128±tolerance。

#### C3. `types.ts` 类型联合描述是 no-op

- **位置**: 原方案 1.2 / 1.4 与 `types.ts`
- **现状**: `HarmonicPattern.type` 实为 `string`（非字面量联合），"在类型联合中确认 `deep_crab`"无任何类型保护作用；检测走模块私有常量 `PATTERN_DEEP_CRAB`（`detector.ts`，非 export）。
- **修订**: 文档如实说明——类型联合操作不影响运行时检测；agent 侧若需枚举约束用字符串字面量 `'deep_crab'`，不依赖 trading-core 导出常量。

### D. 实施顺序（修订后）

1. **修阻断**（否则优化二不可编译/运行）：A1 / A2 / A3 / A4
2. **重构为 post-parse 单点覆盖**：B1（替代原 2.3/2.5 分散改法）
3. **改 prompt 措辞与章节**：B2 + 原 2.1/2.2
4. **stable/volatile 分层 + 测试**：B3
5. **优化一**：C1（tolerance）/ C2（XD 可选性澄清）/ `detector.spec.ts:41` 断言扩 `deep_crab`
6. **文档自洽 + 语义说明**：C3 / B4

### E. 风险重评

| 原 P 级 | 修订后 |
|---------|--------|
| 优化二 P0 "风险低" | **不准确** —— 含 4 项阻断 + JSON 路径遗漏，实际风险中，需先修 A1-A4 与 B1 |
| 优化二 2.5 P2 "风险低" | A4 的 `harmonic.active_pattern` 属编译级 bug，不能按"跟随 2.1-2.4"轻估 |
| 优化一 1.2 P1 "风险低" | 需 C1/C2 同步修正，否则 Deep Crab 实际几乎不可命中 |