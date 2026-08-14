# LLM Token 缓存优化 - 最终实施方案

> ## ⚠️ 协议状态（2026-08 更新）
>
> `llm-client.ts` 已统一切换为 **OpenAI Chat Completions 标准**：
> - 端点：`POST {LLM_BASE_URL}/chat/completions`（不再使用 Anthropic `/messages`）
> - 不再发送 `anthropic-version` 头，不再发送 `cache_control` 字段
> - system 提示作为 `messages` 首条 `{role:'system'}` 消息；user 层按序排列
> - 流式请求带 `stream_options: {include_usage: true}`；SSE 按 OpenAI 标准解析（`delta.content` / `data: [DONE]`）
> - 缓存策略探测（`detectCacheStrategy`）保留用于日志/指标，但 `anthropic_explicit` 策略的请求体已退化为与 `auto_prefix` 相同的 OpenAI messages 形态
> - Kimi/Moonshot 保留其官方 OpenAI 兼容 API 的 `prompt_cache_key` 扩展字段
>
> 实际部署端点（`.env`）：`LLM_BASE_URL=https://api-eo.wochirou.com/v1`（wochirou / Chirou OpenAI 兼容网关）、`LLM_MODEL=deepseek-v4-pro`、`LLM_FALLBACK_MODEL=kimi-k2.6`。
>
> 本文档以下 Anthropic 专属内容仅作历史记录，不再反映当前代码行为。

## ✅ 优化完成

### 核心改进

移除了硬编码的提供商检测，改为**完全基于配置的策略选择**：

```bash
# 之前：硬编码判断（不灵活）
const isAnthropic = this.client['config'].baseUrl.includes('anthropic.com');

# 现在：配置驱动（灵活可控）
LLM_ENABLE_PROMPT_CACHING=true  # 或 false
```

---

## 🎯 适用场景

### 1. DeepSeek（你的主要场景）

```bash
# .env
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
LLM_ENABLE_PROMPT_CACHING=false  # DeepSeek 不支持原生缓存
```

**行为：**
- 使用标准 OpenAI-compatible `/chat/completions` API
- 自动采用三层消息结构（为未来迁移做好准备）
- 如果 DeepSeek 未来支持缓存，只需改为 `true`

**成本：**
- 无法使用 Prompt Caching（DeepSeek 暂不支持）
- 建议监控 DeepSeek 官方文档，查看是否推出缓存功能

---

### 2. Anthropic Claude（历史方案，已退化为 OpenAI 格式）

> ⚠️ **当前实现**：Claude 模型也走 OpenAI Chat Completions 标准。`anthropic_explicit` 策略仍会被探测到（用于日志/指标），但请求体不再携带 `cache_control` 块，与 `auto_prefix` 相同（system 合并为单条 system 消息 + user 层消息）。

```bash
# .env（历史示例）
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_API_KEY=sk-ant-api03-xxx
LLM_MODEL=claude-sonnet-4-6
LLM_ENABLE_PROMPT_CACHING=true  # 启用显式缓存控制
```

**历史行为（2026-08 前）：**
- 使用 Anthropic Messages API (`/messages`)
- 自动在 system 和半静态层添加 `cache_control` 标记
- 记录详细的缓存统计（cacheRead, cacheCreation, hitRate）

**当前行为：**
- 同一 OpenAI `/chat/completions` 端点，Claude 经 OpenAI 兼容网关（如 wochirou）访问
- 依赖网关/提供方的自动前缀缓存；usage 字段（`prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens` 等）仍被提取用于命中率统计

**成本节省（历史参考）：**
- 首次请求：写入缓存（25% markup）
- 后续请求（5分钟内）：90% 折扣
- 平均节省：**75-80%**

---

### 3. OpenAI（自动缓存，当前统一协议）

```bash
# .env（实际部署形态）
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-v4-pro
LLM_FALLBACK_MODEL=kimi-k2.6
LLM_ENABLE_PROMPT_CACHING=false  # 自动缓存，不需要显式标记
```

**行为：**
- 使用标准 `/chat/completions` API（当前所有模型的唯一协议）
- OpenAI 自动检测消息前缀并缓存
- 无需显式 `cache_control` 标记

**成本节省：**
- 自动 50% 折扣（前缀匹配部分）
- 平均节省：**40-50%**

---

## 🔧 配置说明

### `LLM_ENABLE_PROMPT_CACHING`

这是**缓存策略开关**，控制是否按模型名探测缓存策略：

| 值 | 含义 | API 格式 | 适用提供商 |
|----|------|---------|-----------|
| `true` | 启用按模型名的策略探测 | OpenAI Chat Completions API（统一） | claude→auto_prefix 退化、deepseek/gpt→auto_prefix、kimi→prompt_cache_key |
| `false` | 标准 API 调用 | OpenAI Chat Completions API | DeepSeek, OpenAI, 智谱, 其他 |

> **注意（2026-08 起）**：无论何种策略，请求体一律为 OpenAI Chat Completions 标准（`messages` 数组，system 为首条 role 消息），不再发送 Anthropic `cache_control`。`anthropic_explicit` 探测结果仅用于日志/指标与向后兼容方法。

### 何时设置为 `true`（历史参考）

✅ 使用 Anthropic 官方 API (`api.anthropic.com`) —— **已不再适用**  
✅ 想要最大化成本节省（75-80%）—— **已不再适用**  
✅ 接受 Anthropic 特有的 API 格式 —— **已不再适用**  

### 何时设置为 `false`（当前默认）

✅ 使用 DeepSeek / 智谱 GLM / 其他国内模型  
✅ 使用 OpenAI（自动缓存更好）  
✅ 使用 API 代理/网关（wochirou 等 OpenAI 兼容网关）  
✅ 测试或调试阶段  

---

## 📊 代码行为

### 当 `LLM_ENABLE_PROMPT_CACHING=false` 时

```typescript
// comprehensive-analyst.ts
const cachingEnabled = this.client['config'].enablePromptCaching; // false

// 使用标准 OpenAI-compatible API
raw = await this.client.streamInvokeLayered(
  systemPrompt,
  [staticContextPrompt, realtimeDataPrompt]
);
```

**发送的 API 请求：**
```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "wave/chanlun structures..." },
    { "role": "user", "content": "realtime prices..." }
  ],
  "temperature": 0.1,
  "max_tokens": 8192,
  "stream": true
}
```

---

### 当 `LLM_ENABLE_PROMPT_CACHING=true` 时（历史参考）

> ⚠️ 2026-08 起 `streamInvokeLayeredAnthropic()` 仅作向后兼容保留，内部已走同一 OpenAI Chat Completions 协议（`streamLayered`），不再发送 `cache_control`。

```typescript
// 历史：Anthropic Messages API with cache_control（2026-08 前）
const result = await this.client.streamInvokeLayeredAnthropic(
  systemPrompt,
  [staticContextPrompt, realtimeDataPrompt]
);
raw = result.content;

// 记录缓存统计
logger.info({
  cacheRead: 4523,
  cacheCreation: 0,
  hitRate: "100.0%"
}, 'Prompt cache stats');
```

**历史请求格式（Anthropic，2026-08 前）：**
```json
{
  "model": "claude-sonnet-4-6",
  "system": [
    {
      "type": "text",
      "text": "...",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "wave/chanlun structures...",
          "cache_control": { "type": "ephemeral" }
        }
      ]
    },
    {
      "role": "user",
      "content": "realtime prices..."
    }
  ],
  "max_tokens": 8192,
  "temperature": 0.1,
  "stream": true
}
```

**当前请求格式（OpenAI Chat Completions 标准，2026-08 起）：**
```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "system blocks merged with \\n\\n" },
    { "role": "user", "content": "wave/chanlun structures..." },
    { "role": "user", "content": "realtime prices..." }
  ],
  "max_tokens": 8192,
  "temperature": 0.1,
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

---

## 🚀 实施步骤（DeepSeek 用户）

### Step 1: 更新配置

```bash
# 编辑 .env 文件（实际部署形态）
vim .env

# 确保以下配置正确
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_API_KEY=sk-your-actual-key
LLM_MODEL=deepseek-v4-pro
LLM_FALLBACK_MODEL=kimi-k2.6
LLM_ENABLE_PROMPT_CACHING=false
```

### Step 2: 重新编译和部署

```bash
npm run build
npm start
# 或
pm2 restart gold-analysis-nj
```

### Step 3: 验证运行

```bash
# 发起分析请求
curl -X POST http://localhost:3100/trigger/analyze \
  -H "Content-Type: application/json" \
  -d '{"accountId":"account1","symbol":"XAUUSD"}'

# 查看日志
docker logs gold-analysis-nj 2>&1 | grep "cachingEnabled"
```

**预期日志：**
```json
{
  "level": "debug",
  "msg": "Using standard layered invoke",
  "symbol": "XAUUSD",
  "cachingEnabled": false
}
```

---

## 💡 未来迁移路径

### 如果 DeepSeek 支持 Prompt Caching

```bash
# 1. 查看 DeepSeek 官方文档，确认支持缓存
# 2. 更新配置
LLM_ENABLE_PROMPT_CACHING=true

# 3. 重启服务
pm2 restart gold-analysis-nj

# 4. 观察日志中的缓存统计
docker logs gold-analysis-nj | grep "cache stats"
```

### 迁移到 Anthropic（历史选项，2026-08 起不再需要）

> ⚠️ Claude 模型现在也经 OpenAI 兼容网关走 `/chat/completions`，无需单独配置 Anthropic 端点。

```bash
# .env（历史示例）
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_API_KEY=sk-ant-api03-xxx
LLM_MODEL=claude-sonnet-4-6
LLM_ENABLE_PROMPT_CACHING=true

# 成本对比（假设每天 288 次分析）
# DeepSeek: ¥X/天（无缓存）
# Anthropic: $1.30/天（75% 缓存节省）
```

---

## 🔍 技术细节

### 三层消息结构的优势

即使 DeepSeek 不支持缓存，代码仍然使用三层结构：

```typescript
// Layer 1: System prompt (静态)
const systemPrompt = buildSystemPrompt(profile);

// Layer 2: 半静态上下文（15分钟更新一次）
const staticContextPrompt = buildStaticContextPrompt(...);

// Layer 3: 实时数据（每次都变）
const realtimeDataPrompt = buildRealtimeDataPrompt(...);
```

**好处：**
1. **代码清晰**：明确区分静态/半静态/动态内容
2. **易于调试**：可以单独检查每一层的内容
3. **未来兼容**：一旦提供商支持缓存，只需改配置
4. **性能优化**：即使无 API 缓存，也能做应用层优化

### 应用层缓存建议（DeepSeek 用户）

由于 DeepSeek 不支持原生缓存，可以考虑：

```typescript
// 在 Redis 中缓存 Layer 1 + Layer 2 的分析结果
const cacheKey = `analysis:${symbol}:${hash(staticContextPrompt)}`;
const cached = await redis.get(cacheKey);

if (cached && priceChangePercent < 0.1) {
  // 价格变化小于 0.1%，复用之前的分析
  return JSON.parse(cached);
}

// 调用 LLM
const result = await llm.invoke(...);

// 缓存 3 分钟
await redis.setex(cacheKey, 180, JSON.stringify(result));
```

---

## 📚 文档更新

所有文档已更新以反映配置驱动的设计：

- ✅ `PROMPT_CACHING_OPTIMIZATION.md` - 技术方案
- ✅ `CACHE_USAGE_GUIDE.md` - 使用指南
- ✅ `CACHE_IMPLEMENTATION_SUMMARY.md` - 实施总结
- ✅ `.env.example.updated` - 配置示例（含 DeepSeek）

---

## 🎯 总结

### 关键改进

1. **移除硬编码** - 不再基于 URL 判断提供商
2. **配置驱动** - 通过 `LLM_ENABLE_PROMPT_CACHING` 控制行为
3. **DeepSeek 友好** - 默认使用标准 API，无缓存开销
4. **未来可扩展** - 提供商支持缓存时，只需改配置

### DeepSeek 用户建议

- ✅ 保持 `LLM_ENABLE_PROMPT_CACHING=false`
- ✅ 关注 DeepSeek 官方缓存功能更新
- ✅ 考虑添加 Redis 应用层缓存（可选）
- ✅ 如果成本是主要考虑，评估迁移到 Anthropic

### 成本优化路径

| 阶段 | 方案 | 成本节省 |
|------|------|---------|
| **当前** | DeepSeek + 标准 API | 0% |
| **短期** | DeepSeek + Redis 应用缓存 | ~20-30% |
| **长期** | Anthropic + Prompt Caching | ~75-80% |

现在代码已经完全适配你的 DeepSeek 使用场景，同时为未来的优化留好了接口！🎉
