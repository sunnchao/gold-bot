# OpenAI Chat Completions API - Prompt Caching 深度优化

> ## ⚠️ 协议状态（2026-08 更新）
>
> 本文档描述的 **OpenAI Chat Completions 自动前缀缓存**即当前 `llm-client.ts` 的唯一协议（`POST {LLM_BASE_URL}/chat/completions`，实际部署端点 `https://api-eo.wochirou.com/v1`，模型 `deepseek-v4-pro`）。Anthropic `cache_control` 显式标记已移除；流式请求通过 `stream_options: {include_usage: true}` 获取 usage 缓存统计。

## 核心机制

OpenAI 从 **2024年10月** 开始在 Chat Completions API 中引入**自动 Prompt Caching**：

- **无需显式标记** - 不像 Anthropic 需要 `cache_control`
- **前缀匹配** - 自动检测连续请求的公共前缀
- **透明计费** - 响应中包含缓存统计
- **50% 折扣** - 缓存命中的 tokens

---

## ⚠️ 关键限制

### 1. 最小缓存单位

```typescript
// ❌ 太短，不会被缓存
const systemPrompt = "You are a helpful assistant.";  // ~10 tokens

// ✅ 足够长，会被缓存
const systemPrompt = `You are a comprehensive market analyst...
[3000+ tokens of schema and rules]`;  // >1024 tokens
```

**规则：**
- 最小缓存单位：**~1024 tokens**
- 小于此阈值不会缓存
- 你的 system prompt (~3000 tokens) 完全符合

### 2. 前缀严格匹配

```typescript
// Request 1
messages: [
  { role: "system", content: "ABC" },
  { role: "user", content: "DEF" },
  { role: "user", content: "GHI" }
]

// Request 2 - ✅ 缓存命中（前两条完全相同）
messages: [
  { role: "system", content: "ABC" },
  { role: "user", content: "DEF" },
  { role: "user", content: "XYZ" }  // 只有最后一条变了
]

// Request 3 - ❌ 缓存未命中（第二条改变了）
messages: [
  { role: "system", content: "ABC" },
  { role: "user", content: "DIFFERENT" },  // 改变了前缀
  { role: "user", content: "GHI" }
]
```

**规则：**
- 必须**逐字节完全相同**（包括空格、换行）
- 只要前缀中任何一条消息改变，缓存失效
- 只有最后几条消息可以变化

---

## 🎯 针对你的项目的优化策略

### 当前实现分析

你的代码已经有了正确的结构：

```typescript
// src/agents/comprehensive-analyst.ts
const messages = [
  { role: 'system', content: systemPrompt },           // Layer 1: 静态
  { role: 'user', content: staticContextPrompt },      // Layer 2: 半静态
  { role: 'user', content: realtimeDataPrompt },       // Layer 3: 动态
];
```

**问题：**
- Layer 2 包含波浪/缠论结构，每 ~15 分钟更新一次
- 一旦 Layer 2 变化，Layer 1 的缓存也会失效（前缀匹配）

---

## 🔥 优化方案

### 方案 1: 合并静态层到 System Message（推荐）

将尽可能多的静态内容合并到 system message：

```typescript
// ❌ 之前：分散在多条消息
const systemPrompt = buildSystemPrompt(profile);  // 3000 tokens
const staticContext = buildStaticContext(...);    // 2000 tokens

// ✅ 优化：合并静态 + 半静态到 system
function buildEnhancedSystemPrompt(profile: SymbolProfile, payload: GoldbotPayload) {
  const basePrompt = buildSystemPrompt(profile);
  
  // 检查波浪/缠论结构是否在最近 20 分钟内更新过
  const waveStructure = analyzeElliottWave(extractWavePrices(payload));
  const chanlunStructure = analyzeChanlun(extractChanlunBars(payload));
  
  return `${basePrompt}

## PRE-COMPUTED TECHNICAL STRUCTURES (Semi-static)

### Elliott Wave Analysis
${JSON.stringify(waveStructure, null, 2)}

### Chanlun Structure
${JSON.stringify(chanlunStructure, null, 2)}

### Candlestick Patterns
${JSON.stringify(summarizeCandlestickPatterns(payload), null, 2)}

---
**Note:** Above structures are pre-computed. Use them directly in your analysis.
`;
}
```

**优势：**
- System message 现在包含 ~5000 tokens（远超 1024 阈值）
- 只要 K线结构不变（15-30分钟），system 完全缓存
- 实时数据在最后一条 user message，不影响缓存

---

### 方案 2: 动态缓存层级调整

根据内容变化频率动态调整层级：

```typescript
// src/agents/comprehensive-analyst.ts

async run(payload: GoldbotPayload, symbol: string, pendingSignal?: PendingSignal) {
  const logger = getLogger();
  const profile = getSymbolProfile(symbol);
  const currentPrice = payload.market.bid || payload.market.ask || 0;

  // 检查波浪结构是否稳定（20分钟内未变化）
  const waveStable = await this.isWaveStructureStable(symbol, payload);
  
  let systemPrompt: string;
  let userMessages: string[];

  if (waveStable) {
    // 🔥 优化路径：波浪结构稳定，合并到 system
    systemPrompt = this.buildEnhancedSystemPrompt(profile, payload);
    userMessages = [
      buildRealtimeDataPrompt(payload, pendingSignal, symbol, profile)
    ];
    logger.debug({ symbol, cacheStrategy: 'merged-static' }, 'Using merged system prompt');
  } else {
    // 标准路径：波浪结构变化中，保持三层
    systemPrompt = buildSystemPrompt(profile);
    userMessages = [
      buildStaticContextPrompt(payload, currentPrice, symbol, profile),
      buildRealtimeDataPrompt(payload, pendingSignal, symbol, profile),
    ];
    logger.debug({ symbol, cacheStrategy: 'three-layer' }, 'Using standard three-layer');
  }

  const raw = await this.client.streamInvokeLayered(systemPrompt, userMessages);
  // ... rest of the code
}

// 新增辅助方法：检查波浪结构稳定性
private async isWaveStructureStable(symbol: string, payload: GoldbotPayload): Promise<boolean> {
  const currentWave = analyzeElliottWave(extractWavePrices(payload));
  const waveHash = this.hashWaveStructure(currentWave);
  
  // 从 Redis 获取上次的 hash
  const cacheKey = `wave:stable:${symbol}`;
  const lastHash = await this.redis.get(cacheKey);
  
  if (lastHash === waveHash) {
    // 结构未变化，检查时间戳
    const timestamp = await this.redis.get(`${cacheKey}:time`);
    const elapsed = Date.now() - parseInt(timestamp || '0');
    return elapsed < 20 * 60 * 1000;  // 20分钟内
  }
  
  // 结构变化了，更新 hash
  await this.redis.set(cacheKey, waveHash);
  await this.redis.set(`${cacheKey}:time`, Date.now().toString());
  return false;
}

private hashWaveStructure(wave: any): string {
  return createHash('sha256')
    .update(JSON.stringify(wave))
    .digest('hex')
    .slice(0, 16);
}
```

---

### 方案 3: 去除动态时间戳

确保 system prompt 不包含任何动态内容：

```typescript
// ❌ 错误：包含时间戳
const systemPrompt = `
You are a market analyst.
Current time: ${new Date().toISOString()}  // 每次都不同！
`;

// ✅ 正确：时间戳放在 user message
const systemPrompt = `
You are a market analyst for ${profile.name}.
[static rules...]
`;

const realtimePrompt = `
## REAL-TIME CONTEXT
Current time: ${new Date().toISOString()}
Current price: ${currentPrice}
`;
```

**检查清单：**
- ❌ 时间戳（`Date.now()`, `new Date()`）
- ❌ 随机数（`Math.random()`）
- ❌ 请求 ID（`requestId = uuid()`）
- ❌ 动态生成的示例（每次不同）

---

### 方案 4: 消息顺序标准化

确保 assistant/user 消息的顺序一致：

```typescript
// ❌ 错误：有时用 assistant，有时不用
const messages = shouldIncludeExample 
  ? [
      { role: 'system', content: '...' },
      { role: 'assistant', content: 'Example...' },  // 条件性的
      { role: 'user', content: '...' }
    ]
  : [
      { role: 'system', content: '...' },
      { role: 'user', content: '...' }
    ];

// ✅ 正确：始终保持相同结构
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: staticContext },
  { role: 'user', content: realtimeData }
];
```

---

## 📊 OpenAI 缓存监控

### 读取响应头

```typescript
// src/tools/llm-client.ts

async streamInvokeLayered(
  systemMessage: string,
  userMessages: string[],
): Promise<string> {
  // ... existing code ...
  
  const response = await fetch(url, { ...request, signal: controller.signal });
  
  // 🔥 读取缓存统计（如果可用）
  const usage = {
    promptTokens: response.headers.get('x-openai-prompt-tokens'),
    cachedTokens: response.headers.get('x-openai-cached-tokens'),
    completionTokens: response.headers.get('x-openai-completion-tokens'),
  };
  
  if (usage.cachedTokens && usage.promptTokens) {
    const cached = parseInt(usage.cachedTokens);
    const total = parseInt(usage.promptTokens);
    const hitRate = (cached / total * 100).toFixed(1);
    
    logger.info({
      promptTokens: total,
      cachedTokens: cached,
      hitRate: `${hitRate}%`,
    }, 'OpenAI cache stats (from headers)');
  }
  
  // ... rest of the code
}
```

### 从响应体读取（非流式）

```typescript
// 非流式响应包含 usage 对象
const json = await response.json();

if (json.usage) {
  const { prompt_tokens, cached_tokens, completion_tokens } = json.usage;
  const hitRate = cached_tokens > 0 
    ? (cached_tokens / prompt_tokens * 100).toFixed(1) 
    : '0';
  
  logger.info({
    promptTokens: prompt_tokens,
    cachedTokens: cached_tokens,
    hitRate: `${hitRate}%`,
  }, 'OpenAI cache stats (from response body)');
}
```

**注意：** OpenAI 的缓存统计字段名称可能因 API 版本而异，需要查看最新文档。

---

## 🔬 实际测试

### 测试脚本

```bash
#!/bin/bash
# test-openai-cache.sh

API_URL="http://localhost:3100"
SYMBOL="XAUUSD"

echo "=== Test 1: Cold start ==="
curl -X POST "$API_URL/trigger/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"account1\",\"symbol\":\"$SYMBOL\"}" \
  -s | jq '.analysisId'

echo ""
echo "=== Test 2: Immediate follow-up (should hit cache) ==="
sleep 5
curl -X POST "$API_URL/trigger/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"account1\",\"symbol\":\"$SYMBOL\"}" \
  -s | jq '.analysisId'

echo ""
echo "=== Test 3: Check logs ==="
docker logs gold-analysis-nj 2>&1 | grep -E "(cache|OpenAI)" | tail -10
```

### 预期日志

```json
// First request
{
  "level": "info",
  "msg": "OpenAI cache stats",
  "promptTokens": 6000,
  "cachedTokens": 0,
  "hitRate": "0%"
}

// Second request (5s later)
{
  "level": "info",
  "msg": "OpenAI cache stats",
  "promptTokens": 6000,
  "cachedTokens": 5000,    // Layer 1 + Layer 2 cached
  "hitRate": "83.3%"
}
```

---

## 💰 成本对比

### 场景 A: 无优化（每层都变化）

```
Request 1: 6000 tokens × $2.50/M = $0.015
Request 2: 6000 tokens × $2.50/M = $0.015
...
Daily (288 req): 1.728M × $2.50 = $4.32
```

### 场景 B: 基础优化（Layer 1 缓存）

```
Request 1: 6000 tokens × $2.50/M = $0.015
Request 2: 3000 cached × $1.25 + 3000 regular × $2.50 = $0.0113
...
Daily: ~$3.25 (25% 节省)
```

### 场景 C: 深度优化（Layer 1+2 合并缓存）

```
Request 1: 6000 tokens × $2.50/M = $0.015
Request 2: 5000 cached × $1.25 + 1000 regular × $2.50 = $0.00875
...
Daily: ~$2.75 (36% 节省)
```

### 场景 D: 极致优化（20分钟波浪结构不变）

```
Request 1: 6000 tokens × $2.50/M = $0.015
Requests 2-4 (20min内): 5000 cached × $1.25 + 1000 regular × $2.50 = $0.00875
...
Daily: ~$2.52 (42% 节省)
```

---

## 🎯 推荐实施方案

### 针对你的 DeepSeek 场景

即使 DeepSeek 不支持缓存，采用 OpenAI 风格的优化也有好处：

```typescript
// src/agents/comprehensive-analyst.ts

// 1. 合并静态内容到 system（未来兼容性）
const systemPrompt = this.buildMergedSystemPrompt(profile, payload);

// 2. 只保留真正动态的内容在最后
const realtimePrompt = buildRealtimeDataPrompt(payload, pendingSignal, symbol, profile);

// 3. 使用标准 API
const raw = await this.client.streamInvokeLayered(systemPrompt, [realtimePrompt]);
```

**好处：**
- 代码更简洁（2层 vs 3层）
- 未来迁移到 OpenAI 时自动获得缓存优化
- 如果 DeepSeek 实现类似机制，无需改代码

---

## 📋 实施检查清单

- [ ] System prompt 不包含时间戳或动态内容
- [ ] System prompt 长度 > 1024 tokens
- [ ] 将尽可能多的静态内容合并到 system
- [ ] 消息顺序保持一致（不要条件性插入 assistant 消息）
- [ ] 实时数据只在最后一条 user message
- [ ] 添加缓存统计日志
- [ ] 测试连续请求的缓存命中率

---

## 🔗 参考资料

- [OpenAI Prompt Caching 文档](https://platform.openai.com/docs/guides/prompt-caching)
- [OpenAI API 响应格式](https://platform.openai.com/docs/api-reference/chat/object)
- 你的项目文档：`PROMPT_CACHING_OPTIMIZATION.md`

---

## 总结

**OpenAI Chat Completions 缓存优化的核心：**

1. **前缀匹配** - 只有前面的消息完全相同才能缓存
2. **合并静态层** - 将 Layer 1+2 合并到 system，最大化缓存范围
3. **去除动态内容** - System 必须完全静态
4. **监控命中率** - 通过响应头或 usage 对象跟踪

你的项目已经有了正确的基础结构，加上这些优化，未来迁移到 OpenAI 或其他支持缓存的提供商时，可以立即获得 **35-45% 的成本节省**！🚀
