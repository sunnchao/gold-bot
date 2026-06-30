# Prompt Caching Usage Guide

## Quick Start

### 1. Choose Your LLM Provider

The code now supports **provider-aware caching**:

```bash
# For best caching (75-80% cost reduction)
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_MODEL=claude-sonnet-4-6

# For automatic caching (40-50% cost reduction)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

### 2. How It Works

The system automatically detects your provider and applies the optimal caching strategy:

**Anthropic Claude:**
```typescript
// Automatically adds cache_control breakpoints:
{
  system: [{ text: "...", cache_control: { type: "ephemeral" }}],
  messages: [
    { role: "user", content: [{ text: "wave/chanlun", cache_control: {...} }] },
    { role: "user", content: "realtime prices" }  // Not cached
  ]
}
```

**OpenAI:**
```typescript
// Relies on automatic prefix caching:
{
  messages: [
    { role: "system", content: "..." },        // Cached automatically
    { role: "user", content: "wave/chanlun" }, // Cached automatically
    { role: "user", content: "realtime" }      // Changes every request
  ]
}
```

### 3. Monitor Cache Performance

Check logs for cache statistics:

```bash
# Anthropic logs show detailed cache stats
[INFO] Prompt cache stats
  symbol: "XAUUSD"
  cacheRead: 4523        # Tokens read from cache (90% discount)
  cacheCreation: 0       # Tokens written to cache (25% markup)
  hitRate: "100.0%"      # Cache hit rate
```

```bash
# OpenAI logs show header-based stats (if available)
[INFO] OpenAI cache hit
  cachedTokens: "3500"
  totalTokens: "5000"
  hitRate: "70.0%"
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

Expected log (Anthropic):
```
cacheRead: 0
cacheCreation: 5000
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

Expected log (Anthropic):
```
cacheRead: 5000
cacheCreation: 0
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

### Anthropic Claude Sonnet 4.6

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

### OpenAI GPT-4o

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
1. Verify provider detection:
   ```bash
   grep "provider:" logs/app.log | tail -1
   ```
   Should show `provider: 'anthropic'` or similar

2. Check API base URL:
   ```bash
   echo $LLM_BASE_URL
   ```
   Must be `https://api.anthropic.com/v1` for Anthropic caching

3. Verify model supports caching:
   - Anthropic: All Claude 3+ models support caching
   - OpenAI: GPT-4o, GPT-4-turbo support automatic caching

4. Check request interval:
   - Cache TTL is 5 minutes
   - Requests >5min apart will miss cache

### High Cache Miss Rate?

**If `hitRate < 50%` on Anthropic:**

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

- [Anthropic Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI Prompt Caching (Automatic)](https://platform.openai.com/docs/guides/prompt-caching)
- [Project Implementation: PROMPT_CACHING_OPTIMIZATION.md](./PROMPT_CACHING_OPTIMIZATION.md)
