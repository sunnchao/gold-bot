# Prompt Caching Usage Guide

> ## ⚠️ 协议状态（2026-08 更新）
>
> `llm-client.ts` 已统一切换为 **OpenAI Chat Completions 标准**（`POST {LLM_BASE_URL}/chat/completions`）：
> - 不再使用 Anthropic Messages API（`/messages`、`anthropic-version` 头、`cache_control` 块全部移除）
> - system 提示作为 `messages` 首条 `{role:'system'}` 消息，user 层按序排列；流式请求带 `stream_options: {include_usage: true}`
> - 缓存策略探测保留用于日志/指标（claude→auto_prefix 退化、deepseek/gpt→auto_prefix、kimi→prompt_cache_key）
> - 实际部署端点：`LLM_BASE_URL=https://api-eo.wochirou.com/v1`（wochirou OpenAI 兼容网关）、`LLM_MODEL=deepseek-v4-pro`、`LLM_FALLBACK_MODEL=kimi-k2.6`
>
> 本文档中 Anthropic 专属示例仅作历史记录。

## Quick Start

### 1. Choose Your LLM Provider

The code applies **model-name-based cache strategy detection** (provider-agnostic):

```bash
# 实际部署（OpenAI Chat Completions 标准，wochirou OpenAI 兼容网关）
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_MODEL=deepseek-v4-pro
LLM_FALLBACK_MODEL=kimi-k2.6

# 历史：Anthropic 专属端点（2026-08 前）
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_MODEL=claude-sonnet-4-6
```

### 2. How It Works

The system detects the caching strategy from the **model name** and always emits the OpenAI Chat Completions message format:

**当前（所有模型统一 OpenAI 格式）：**
```typescript
// OpenAI Chat Completions 标准请求体（无 cache_control）
{
  model: "...",
  messages: [
    { role: "system", content: "merged system blocks" },  // Cached by prefix
    { role: "user", content: "wave/chanlun" },             // Cached by prefix
    { role: "user", content: "realtime" }                  // Changes every request
  ],
  stream: true,
  stream_options: { include_usage: true }
}
```

**历史：Anthropic 显式 cache_control（2026-08 前）：**
```typescript
{
  system: [{ text: "...", cache_control: { type: "ephemeral" }}],
  messages: [
    { role: "user", content: [{ text: "wave/chanlun", cache_control: {...} }] },
    { role: "user", content: "realtime prices" }  // Not cached
  ]
}
```

### 3. Monitor Cache Performance

Check logs for cache statistics:

```bash
# 当前：缓存统计来自流式响应 usage 字段（readTokens/creationTokens/hitTokens/inputTokens）
[INFO] Phase 2 prompt cache stats
  symbol: "XAUUSD"
  strategy: "auto_prefix"   # 或 prompt_cache_key（kimi）
  model: "deepseek-v4-pro"
  cacheReadTokens: 4523     # 从缓存读取的 tokens
  cacheCreationTokens: 0    # 写入缓存的 tokens
  cacheHitRate: "100.0%"    # 缓存命中率
```

```bash
# 历史：Anthropic 网关日志（2026-08 前）
[INFO] Prompt cache stats
  symbol: "XAUUSD"
  cacheRead: 4523        # Tokens read from cache (90% discount)
  cacheCreation: 0       # Tokens written to cache (25% markup)
  hitRate: "100.0%"      # Cache hit rate
```

## Testing Cache Effectiveness

### Test 1: Cold Start (First Request)

```bash
curl -X POST http://localhost:3100/trigger/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account1",
    "symbol": "XAUUSD"
  }'
```

Expected log (当前 OpenAI 格式):
```
readTokens: 0
creationTokens: 5000
hitRate: "0%"
```

### Test 2: Warm Cache (Within 5 Minutes)

```bash
# Wait 10 seconds, then send same request
sleep 10
curl -X POST http://localhost:3100/trigger/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account1",
    "symbol": "XAUUSD"
  }'
```

Expected log (当前 OpenAI 格式):
```
readTokens: 5000
creationTokens: 0
hitRate: "100.0%"
```

### Test 3: Partial Cache Miss (After 15 Minutes)

```bash
# Wait 15 minutes (wave/chanlun context expires)
sleep 900
curl -X POST ...
```

Expected log:
```
cacheRead: 3000      # System prompt still cached
cacheCreation: 2000  # Wave/chanlun re-written
hitRate: "60.0%"
```

## Cost Comparison Example

Assuming **288 requests/day** (every 5 minutes):

### Anthropic Claude Sonnet 4.6（历史参考）

**Pricing:**
- Input: $3/M tokens
- Cached read: $0.30/M tokens (90% off)
- Cached write: $3.75/M tokens (25% markup)

**Without Caching:**
```
6000 input tokens × 288 requests = 1,728,000 tokens/day
Cost: 1.728M × $3 = $5.18/day
```

**With Caching (80% hit rate):**
```
First request:
  6000 × $3.75 (cache write) = $0.0225

Next 287 requests (80% cached):
  287 × (4800 × $0.30 + 1200 × $3) = $1.24 + $1.03 = $2.27

Total: $0.02 + $2.27 = $2.29/day
Savings: ($5.18 - $2.29) / $5.18 = 55.8%
```

> 注：当前实现不再直连 Anthropic API；若经 OpenAI 兼容网关访问 Claude，缓存计费以网关为准。

### OpenAI GPT-4o / DeepSeek（当前部署形态）

**Pricing:**
- Input: $2.50/M tokens
- Cached: $1.25/M tokens (50% off)

**Without Caching:**
```
1.728M × $2.50 = $4.32/day
```

**With Caching (50% hit rate):**
```
288 × (3000 × $1.25 + 3000 × $2.50) = $3.24/day
Savings: ($4.32 - $3.24) / $4.32 = 25%
```

## Troubleshooting

### Cache Not Working?

**Symptom:** `cacheRead: 0` on every request

**Checklist:**
1. Verify cache strategy detection:
   ```bash
   grep "strategy:" logs/app.log | tail -1
   ```
   Should show `strategy: 'auto_prefix'` / `'prompt_cache_key'` or similar

2. Check API base URL:
   ```bash
   echo $LLM_BASE_URL
   ```
   实际部署应为 `https://api-eo.wochirou.com/v1`（OpenAI Chat Completions 标准端点 `/chat/completions`）

3. Verify model supports caching:
   - DeepSeek: 自动前缀缓存（`prompt_cache_hit_tokens`）
   - OpenAI: GPT-4o, GPT-4-turbo support automatic caching
   - Kimi/Moonshot: 显式 `prompt_cache_key` 字段

4. Check request interval:
   - Cache TTL is 5 minutes
   - Requests >5min apart will miss cache

### High Cache Miss Rate?

**If `hitRate < 50%`:**

1. Check if content is truly static:
   ```typescript
   // Bad: timestamp in system prompt
   const system = `Current time: ${new Date()}...`;
   
   // Good: timestamp in realtime layer only
   const realtime = `Current time: ${new Date()}...`;
   ```

2. Verify layer boundaries:
   - Layer 1 (system): Never changes per symbol
   - Layer 2 (wave/chanlun): Changes every ~15min
   - Layer 3 (price/positions): Changes every request

3. Monitor wave structure updates:
   ```bash
   # If wave structure changes every request, move to Layer 3
   grep "Elliott Wave Structure" logs/app.log | md5sum
   ```

4. 检查网关 usage 字段（OpenAI 格式）：
   - DeepSeek 直连：`usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
   - OpenAI 格式网关：`usage.prompt_tokens_details.cached_tokens`（或嵌套 `billing_usage.openai_usage.*`）
   - 流式请求必须带 `stream_options: {include_usage: true}` 才能在流末 chunk 拿到 usage

## Advanced Optimization

### Dynamic Layer Promotion

If wave structure rarely changes, promote it to system layer:

```typescript
// In comprehensive-analyst.ts
const waveLastUpdated = this.getWaveLastUpdate(symbol);
const shouldPromote = Date.now() - waveLastUpdated > 30 * 60 * 1000; // 30min

if (shouldPromote) {
  const mergedSystem = `${systemPrompt}\n\n${staticContextPrompt}`;
  raw = await this.client.streamInvokeLayered(mergedSystem, [realtimeDataPrompt]);
} else {
  raw = await this.client.streamInvokeLayered(systemPrompt, [staticContextPrompt, realtimeDataPrompt]);
}
```

### Multi-Symbol Optimization

For multiple symbols, system prompt can be shared:

```typescript
// shared-system.ts
export const TRADING_SYSTEM_PROMPT = `
You are a comprehensive market analysis orchestrator.
...base rules that apply to all symbols...
`;

// In comprehensive-analyst.ts
const systemPrompt = `${SHARED_SYSTEM_PROMPT}\n\n${buildSymbolSpecificPrompt(profile)}`;
```

This maximizes cache reuse across XAUUSD, EURUSD, etc.

## Monitoring Dashboard

Track cache performance over time:

```bash
# Extract cache stats from logs
grep "Prompt cache stats" logs/app.log | \
  jq '{time: .time, symbol: .symbol, hitRate: .hitRate}' | \
  jq -s 'group_by(.symbol) | map({symbol: .[0].symbol, avgHitRate: (map(.hitRate | rtrimstr("%") | tonumber) | add / length)})'
```

Expected output:
```json
[
  {
    "symbol": "XAUUSD",
    "avgHitRate": 78.5
  }
]
```

## References

- [OpenAI Prompt Caching (Automatic)](https://platform.openai.com/docs/guides/prompt-caching)
- [DeepSeek API 文档（自动上下文缓存）](https://api-docs.deepseek.com/guides/kv_cache)
- [Moonshot/Kimi API 文档（prompt_cache_key）](https://platform.moonshot.cn/docs/intro)
- [Project Implementation: PROMPT_CACHING_OPTIMIZATION.md](./PROMPT_CACHING_OPTIMIZATION.md)
