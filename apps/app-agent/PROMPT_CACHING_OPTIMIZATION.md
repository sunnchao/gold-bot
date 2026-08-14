# LLM Token 缓存优化方案

> ## ⚠️ 协议状态（2026-08 更新）
>
> `llm-client.ts` 已统一切换为 **OpenAI Chat Completions 标准**（`POST {LLM_BASE_URL}/chat/completions`）：
> - 移除 Anthropic Messages API（`/messages` 端点、`anthropic-version` 头、`cache_control` 块、`x-api-key`）
> - system 提示作为 `messages` 首条 `{role:'system'}` 消息；流式请求带 `stream_options: {include_usage: true}`；SSE 按 OpenAI 标准解析（`delta.content` / `data: [DONE]`）
> - 缓存策略按模型名探测（claude→auto_prefix 退化、deepseek/gpt→auto_prefix、kimi→prompt_cache_key）；`anthropic_explicit` 仅保留探测结果用于日志/指标，请求体不再携带 `cache_control`
> - 实际部署端点：`LLM_BASE_URL=https://api-eo.wochirou.com/v1`（wochirou OpenAI 兼容网关）、`LLM_MODEL=deepseek-v4-pro`、`LLM_FALLBACK_MODEL=kimi-k2.6`
>
> 本文档中"方案一：Anthropic Claude"及其代码示例仅作历史记录，不再反映当前代码行为。

## 当前问题诊断

你的项目已经实现了**逻辑分层**（system + 半静态上下文 + 实时数据），但**没有真正激活 Prompt Caching**。

### 当前代码问题（历史）

```typescript
// llm-client.ts:227 - 没有发送缓存控制标记
body: JSON.stringify({
  model: this.config.model,
  messages,  // ❌ 只是分层，但没告诉 API 哪些消息需要缓存
  temperature: 0.1,
  max_tokens: 8192,
  stream: true,
})
```

> 该问题描述的是 2026-08 前的旧实现。当前实现统一走 OpenAI Chat Completions 标准（自动前缀缓存 + `stream_options: {include_usage: true}` 统计），不再需要显式缓存标记。

## 核心优化策略

### 1. **按 LLM 模型实现缓存策略探测**

不同模型的缓存机制不同（请求体统一为 OpenAI Chat Completions 标准）：

| 模型 | 缓存机制 | 最小缓存长度 | TTL | 计费规则 |
|--------|---------|-------------|-----|---------|
| **Anthropic Claude**（历史） | `cache_control` breakpoints（已移除） | 1024 tokens | 5 min | 写入 25% 折扣，读取 90% 折扣 |
| **OpenAI / DeepSeek** | 自动缓存（API 透明） | ~1024 tokens | 5-10 min | 50% 折扣，无需显式标记 |
| **Kimi/Moonshot** | `prompt_cache_key` 显式字段 | ~1024 tokens | 5-10 min | 命中折扣 |
| **智谱 GLM** | 不支持 Prompt Caching | N/A | N/A | 无优化 |

---

## 方案一：Anthropic Claude（历史方案，2026-08 起不再使用）

> ⚠️ **该方案已废弃**：当前代码统一使用 OpenAI Chat Completions 标准。Claude 模型若需使用，经 OpenAI 兼容网关（如 wochirou）访问，请求体与 DeepSeek/OpenAI 完全一致（无 `cache_control`、无 `x-api-key`、无 `anthropic-version`）。以下内容仅作历史记录。

### 1.1 API 格式要求（历史）

```typescript
// Anthropic Messages API 格式
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 8192,
  "system": [
    {
      "type": "text",
      "text": "You are a comprehensive market analyst...",
      "cache_control": {"type": "ephemeral"}  // 🔥 缓存标记
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "## COMPUTED STRUCTURES\n...",
          "cache_control": {"type": "ephemeral"}  // 🔥 半静态层缓存
        }
      ]
    },
    {
      "role": "user",
      "content": "## REAL-TIME DATA\n..."  // 动态层，不缓存
    }
  ]
}
```

### 1.2 实现代码（历史）

```typescript
// llm-client.ts - 历史 Anthropic 专用方法（2026-08 前）
// 现已被统一 OpenAI Chat Completions 实现的 streamLayered() 取代；
// streamInvokeLayeredAnthropic() 仅作向后兼容保留，内部走 OpenAI 协议。
async streamInvokeLayeredAnthropic(
  systemMessage: string,
  userMessages: string[],
): Promise<string> {
  const logger = getLogger();
  const url = `${this.config.baseUrl.replace(/\/+$/, '')}/messages`;

  // Anthropic 格式：system 是数组，每个元素可标记 cache_control
  const systemBlocks = [
    {
      type: 'text',
      text: systemMessage,
      cache_control: { type: 'ephemeral' },  // 🔥 静态 system 缓存
    },
  ];

  // 构建 messages：倒数第二条标记缓存
  const messages = userMessages.map((content, index) => {
    const isSecondLast = index === userMessages.length - 2;
    return {
      role: 'user',
      content: isSecondLast
        ? [
            {
              type: 'text',
              text: content,
              cache_control: { type: 'ephemeral' },  // 🔥 半静态层缓存
            },
          ]
        : content,  // 最后一条是字符串，不缓存
    };
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.config.timeout);
  const startTime = Date.now();

  try {
    logger.debug(
      { url, model: this.config.model, layers: userMessages.length },
      'LLM streamInvokeLayeredAnthropic with cache_control',
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,  // Anthropic 用 x-api-key
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 8192,
        temperature: 0.1,
        system: systemBlocks,  // 🔥 system 作为独立字段
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'no body');
      throw new Error(`Anthropic API ${response.status}: ${body}`);
    }

    // Anthropic SSE 格式解析
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    let fullContent = '';
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            
            // 提取 delta 内容
            if (data.type === 'content_block_delta' && data.delta?.text) {
              fullContent += data.delta.text;
            }
            
            // 🔥 提取缓存统计（在 message_start 事件中）
            if (data.type === 'message_start' && data.message?.usage) {
              cacheReadTokens = data.message.usage.cache_read_input_tokens || 0;
              cacheCreationTokens = data.message.usage.cache_creation_input_tokens || 0;
            }
          } catch {
            // Skip unparseable SSE data
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        elapsed,
        length: fullContent.length,
        cacheReadTokens,      // 🔥 从缓存读取的 tokens
        cacheCreationTokens,  // 🔥 写入缓存的 tokens
        cacheHitRate: cacheReadTokens > 0 
          ? `${((cacheReadTokens / (cacheReadTokens + cacheCreationTokens)) * 100).toFixed(1)}%`
          : '0%',
      },
      'streamInvokeLayeredAnthropic: complete with cache stats',
    );

    return fullContent;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), elapsed },
      'streamInvokeLayeredAnthropic: failed',
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

### 1.3 缓存效果预估

**首次请求**（冷启动）
```
system prompt:        ~3000 tokens → cache_creation_input_tokens
wave/chanlun context: ~2000 tokens → cache_creation_input_tokens
realtime data:        ~1000 tokens → input_tokens (不缓存)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总输入: 6000 tokens
计费: 3000×1.25 + 2000×1.25 + 1000×1 = 7250 token等价
```

**5分钟内第二次请求**（缓存命中）
```
system prompt:        ~3000 tokens → cache_read_input_tokens (90% 折扣)
wave/chanlun context: ~2000 tokens → cache_read_input_tokens (90% 折扣)
realtime data:        ~1000 tokens → input_tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
计费: 3000×0.1 + 2000×0.1 + 1000×1 = 1500 token等价
节省: (7250 - 1500) / 7250 = 79.3%
```

**15分钟后请求**（system 缓存命中，wave/chanlun 缓存未命中）
```
system prompt:        ~3000 tokens → cache_read_input_tokens
wave/chanlun context: ~2000 tokens → cache_creation_input_tokens (重新写入)
realtime data:        ~1000 tokens → input_tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
计费: 3000×0.1 + 2000×1.25 + 1000×1 = 3800 token等价
节省: (7250 - 3800) / 7250 = 47.6%
```

---

## 方案二：OpenAI（自动缓存）

### 2.1 OpenAI Prompt Caching 特性

OpenAI 从 2024年10月起，**自动缓存**聊天补全请求的前缀，无需显式标记。

**缓存规则**
- 自动检测 `messages` 数组的公共前缀
- 最小缓存单位：~1024 tokens
- TTL: 5-10 分钟
- 折扣：50% off

### 2.2 优化策略（结构化消息顺序）

你的 `streamInvokeLayered` 已经符合 OpenAI 的最佳实践，只需调整消息顺序：

```typescript
// 确保静态内容在前，动态内容在后
const messages = [
  { role: 'system', content: systemMessage },           // Layer 1: 静态
  { role: 'user', content: userMessages[0] },           // Layer 2: 半静态（波浪/缠论）
  { role: 'user', content: userMessages[1] },           // Layer 3: 实时价格
];
```

**OpenAI 会自动缓存**：
- 如果连续两次请求的 `messages[0]` 和 `messages[1]` 完全相同
- 只有 `messages[2]`（实时数据）变化
- 则自动应用 50% 折扣到前两条消息

### 2.3 监控缓存命中

OpenAI 响应头会返回缓存统计：

```typescript
async streamInvokeLayered(
  systemMessage: string,
  userMessages: string[],
): Promise<string> {
  // ... 现有代码 ...
  
  const response = await fetch(url, { ...request, signal: controller.signal });
  
  // 🔥 读取缓存统计头
  const cachedTokens = response.headers.get('openai-prompt-cached-tokens');
  const totalTokens = response.headers.get('openai-prompt-tokens');
  
  if (cachedTokens && totalTokens) {
    const hitRate = (parseInt(cachedTokens) / parseInt(totalTokens)) * 100;
    logger.info({ cachedTokens, totalTokens, hitRate: `${hitRate.toFixed(1)}%` }, 'OpenAI cache hit');
  }
  
  // ... 继续解析响应 ...
}
```

---

## 方案三：智谱 GLM / DeepSeek（请求去重优化）

这些提供商**不支持 Prompt Caching**，优化策略转向：

### 3.1 应用层缓存（Redis）

```typescript
// llm-client.ts - 新增缓存层
import { createHash } from 'node:crypto';

export class LLMClient {
  constructor(
    config: LLMClientConfig,
    private readonly redisClient?: RedisService,  // 注入 Redis
  ) {
    this.config = config;
  }

  private getCacheKey(systemMessage: string, userMessages: string[]): string {
    const hash = createHash('sha256')
      .update(systemMessage)
      .update(userMessages.join('|||'))
      .digest('hex');
    return `llm:cache:${this.config.model}:${hash}`;
  }

  async streamInvokeLayeredWithCache(
    systemMessage: string,
    userMessages: string[],
  ): Promise<string> {
    const logger = getLogger();
    
    // 🔥 尝试从 Redis 读取缓存
    if (this.redisClient) {
      const cacheKey = this.getCacheKey(systemMessage, userMessages);
      const cached = await this.redisClient.get(cacheKey);
      
      if (cached) {
        logger.info({ cacheKey }, 'LLM response cache hit');
        return cached;
      }
    }

    // 缓存未命中，调用 LLM
    const response = await this.streamInvokeLayered(systemMessage, userMessages);

    // 🔥 写入缓存（TTL 5分钟）
    if (this.redisClient) {
      const cacheKey = this.getCacheKey(systemMessage, userMessages);
      await this.redisClient.setex(cacheKey, 300, response);
      logger.debug({ cacheKey }, 'LLM response cached');
    }

    return response;
  }
}
```

**注意**：这种方法只适用于**完全相同的输入**，实时数据层的变化会导致缓存失效。

### 3.2 部分输入哈希（更激进的缓存）

```typescript
private getPartialCacheKey(systemMessage: string, staticContext: string): string {
  // 只用静态层和半静态层计算哈希，忽略实时数据
  const hash = createHash('sha256')
    .update(systemMessage)
    .update(staticContext)
    .digest('hex');
  return `llm:partial:${this.config.model}:${hash}`;
}

async streamInvokeLayeredWithPartialCache(
  systemMessage: string,
  userMessages: string[],  // [staticContext, realtimeData]
): Promise<string> {
  const [staticContext, realtimeData] = userMessages;
  const partialKey = this.getPartialCacheKey(systemMessage, staticContext);
  
  // ⚠️ 风险：忽略实时数据的变化，可能返回过期分析
  // 适用场景：价格波动小于 0.1% 时复用之前的分析
  const cached = await this.redisClient?.get(partialKey);
  if (cached) {
    logger.warn({ partialKey }, 'Using partial cache (ignoring realtime changes)');
    return cached;
  }

  const response = await this.streamInvokeLayered(systemMessage, userMessages);
  await this.redisClient?.setex(partialKey, 180, response);  // TTL 3分钟
  return response;
}
```

---

## 实施步骤

### Step 1: 检测当前 LLM 缓存策略（按模型名，2026-08 起）

```typescript
// llm-client.ts - detectCacheStrategy(model, enablePromptCaching)
// claude → anthropic_explicit（仅日志/指标，请求体已退化为 auto_prefix）
// deepseek / gpt-* → auto_prefix
// moonshot / kimi → prompt_cache_key（请求体带 prompt_cache_key 字段）
// glm / chatglm → auto_prefix_unstable
// minimax / abab → none
```

### Step 2: 统一 OpenAI Chat Completions 请求（当前实现）

```typescript
// llm-client.ts: buildLayeredRequestBody()
// 所有策略统一构造 OpenAI messages：
const messages = [
  { role: 'system', content: systemBlocks.map(b => b.text).join('\n\n') },
  ...userLayers.map(layer => ({ role: 'user', content: layer.text })),
];

// 流式请求附带 usage 统计
body.stream = true;
body.stream_options = { include_usage: true };

// Kimi/Moonshot 策略额外携带其官方扩展字段
if (cacheStrategy.type === 'prompt_cache_key') {
  body.prompt_cache_key = 'gold-analysis';
}
```

### Step 3: 监控缓存效果

```typescript
// 在日志中追踪缓存指标
logger.info({
  strategy,
  model,
  readTokens: 4523,     // 从缓存读取
  hitTokens: 3412,      // 命中 tokens
  inputTokens: 6000,    // 总输入（命中率分母）
  cacheHitRate: '85%',  // 从流式 usage 字段计算
  savedTokens: 4500,
  estimatedCostSaving: '$0.02',
}, 'Phase 2 prompt cache stats');
```

---

## 高级优化技巧

### 1. 动态调整缓存边界

如果波浪结构 15 分钟没变化，把它移到 system 层：

```typescript
// 检测是否需要提升缓存层级
function shouldPromoteToSystem(lastWaveUpdate: Date): boolean {
  return Date.now() - lastWaveUpdate.getTime() > 15 * 60 * 1000;
}

if (shouldPromoteToSystem(lastWaveUpdate)) {
  // 合并到 system prompt
  const extendedSystem = `${systemPrompt}\n\n${staticContextPrompt}`;
  raw = await client.streamInvokeLayered(extendedSystem, [realtimeDataPrompt]);
} else {
  // 正常三层
  raw = await client.streamInvokeLayered(systemPrompt, [staticContextPrompt, realtimeDataPrompt]);
}
```

### 2. 前缀压缩（历史：Anthropic 专用，已废弃）

> ⚠️ 2026-08 起代码不再发送 `cache_control` 断点（OpenAI Chat Completions 标准无此字段）。以下为历史参考。

Anthropic 允许在一个请求中设置多个缓存断点（最多 4 个）：

```typescript
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: part1, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: part2, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: part3, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: realtimeData },  // 不缓存
    ],
  },
];
```

### 3. 预热缓存（Warm-up）

在交易时段开始前，预先发送一次请求填充缓存：

```bash
# 每日 08:55 预热缓存（09:00 开盘前）
curl -X POST http://localhost:3100/trigger/warmup \
  -H "Content-Type: application/json" \
  -d '{"symbol": "XAUUSD", "action": "cache_warmup"}'
```

---

## 成本对比（历史参考）

假设每天交易 **288 次分析**（每 5 分钟一次，24 小时）

| 提供商 | 无缓存成本 | 优化后成本 | 节省比例 |
|--------|-----------|-----------|---------|
| **Anthropic Claude Sonnet**（历史） | $4.32 | $1.08 | **75%** |
| **OpenAI GPT-4o** | $3.60 | $2.16 | **40%** |
| **智谱 GLM-4** | ¥18.00 | ¥18.00 | 0% (无API缓存) |

*计算基于：每次 6000 input tokens，缓存命中率 80%*

---

## 推荐配置

### 生产环境（当前部署）

```bash
# .env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_MODEL=deepseek-v4-pro
LLM_FALLBACK_MODEL=kimi-k2.6
LLM_API_KEY=sk-xxx
```

### 开发环境（兼容性优先）

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_MODEL=deepseek-v4-pro
```

### 国内环境（无缓存）

```bash
LLM_PROVIDER=zhipu
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4-plus
# 考虑添加 Redis 应用层缓存
```

---

## 总结

| 优化手段 | 适用模型/提供商 | 实现难度 | 效果 |
|---------|----------|---------|------|
| **显式 cache_control**（已废弃） | Anthropic（历史） | 中 | ⭐⭐⭐⭐⭐ 最佳（75-80%节省） |
| **结构化消息顺序**（当前） | OpenAI/DeepSeek | 低 | ⭐⭐⭐⭐ 良好（40-50%节省） |
| **prompt_cache_key**（当前） | Kimi/Moonshot | 低 | ⭐⭐⭐⭐ 良好 |
| **Redis 应用层缓存** | 所有 | 中 | ⭐⭐⭐ 中等（适用于完全相同输入） |
| **动态缓存层级调整** | OpenAI/DeepSeek | 高 | ⭐⭐⭐⭐ 高级优化 |

**立即行动**: 当前请求统一走 OpenAI Chat Completions 标准（`/chat/completions`），使用 wochirou 等 OpenAI 兼容网关时咨询其 Prompt Caching 支持并确认 usage 缓存字段。
