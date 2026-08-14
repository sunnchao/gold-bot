# Token 缓存优化实施总结

> ## ⚠️ 协议状态（2026-08 更新）
>
> `llm-client.ts` 已统一切换为 **OpenAI Chat Completions 标准**（`POST {LLM_BASE_URL}/chat/completions`）：
> - 移除 Anthropic Messages API（`/messages` 端点、`anthropic-version` 头、`cache_control` 块、`x-api-key`）
> - system 提示作为 `messages` 首条 `{role:'system'}` 消息；流式请求带 `stream_options: {include_usage: true}`；SSE 按 OpenAI 标准解析
> - 缓存策略按模型名探测（claude→auto_prefix 退化、deepseek/gpt→auto_prefix、kimi→prompt_cache_key），探测结果用于日志/指标
> - 实际部署端点：`LLM_BASE_URL=https://api-eo.wochirou.com/v1`（wochirou OpenAI 兼容网关）、`LLM_MODEL=deepseek-v4-pro`、`LLM_FALLBACK_MODEL=kimi-k2.6`
>
> 本文档中 Anthropic 专属内容仅作历史记录。

## ✅ 已完成的优化

### 1. 核心代码实现

#### `src/tools/llm-client.ts`
- ✅ `streamLayered()` / `invokeLayered()` - 统一 OpenAI Chat Completions 协议（含 tools / tool_choice / SSE / usage 解析）
- ✅ `streamInvokeLayeredAnthropic()` - 历史兼容包装（内部走 OpenAI 协议，不再发 cache_control）
- ✅ 自动提取缓存统计（readTokens, creationTokens, hitTokens, hitRate）

#### `src/config/app-config.service.ts`
- ✅ `LLM_ENABLE_PROMPT_CACHING` 开关 + 模型名驱动的策略探测（`detectCacheStrategy`）

#### `src/agents/comprehensive-analyst.ts`
- ✅ 运行时缓存策略日志输出
- ✅ 自动路由到对应缓存策略（auto_prefix / prompt_cache_key / none）

### 2. 文档和工具

- ✅ `PROMPT_CACHING_OPTIMIZATION.md` - 完整优化方案文档
- ✅ `CACHE_USAGE_GUIDE.md` - 使用指南和故障排查
- ✅ `scripts/test-cache.sh` - 缓存效果测试脚本

## 🎯 使用方法

### 配置 OpenAI 兼容网关（当前部署，推荐）

```bash
# .env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api-eo.wochirou.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-v4-pro
LLM_FALLBACK_MODEL=kimi-k2.6
```

**预期效果：40-50% 成本节省（自动前缀缓存）**

### 配置 Anthropic（历史方案，2026-08 前）

```bash
# .env（历史示例）
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_API_KEY=sk-ant-api03-xxx
LLM_MODEL=claude-sonnet-4-6
```

**预期效果：75-80% 成本节省（历史）**

## 📊 缓存策略详解

### 三层结构设计

```typescript
// Layer 1: 静态 System Prompt (~3000 tokens)
const systemPrompt = buildSystemPrompt(profile);
// 包含: JSON schema, trading rules, symbol characteristics
// 缓存策略: 长期缓存（TTL 5min+），除非切换品种

// Layer 2: 半静态上下文 (~2000 tokens)
const staticContextPrompt = buildStaticContextPrompt(payload, ...);
// 包含: Elliott Wave 结构, 缠论分析, K线形态
// 缓存策略: 中期缓存（~15min），K线数据更新时失效

// Layer 3: 实时数据 (~1000 tokens)
const realtimeDataPrompt = buildRealtimeDataPrompt(payload, ...);
// 包含: 当前价格, 持仓状态, 技术指标值
// 缓存策略: 不缓存，每次请求都是新数据
```

### 当前请求格式（OpenAI Chat Completions 标准，2026-08 起）

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "merged system blocks" },
    { "role": "user", "content": "static context" },
    { "role": "user", "content": "realtime data" }
  ],
  "max_tokens": 8192,
  "temperature": 0.1,
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

### 历史：Anthropic 缓存标记（2026-08 前）

```json
{
  "system": [
    {
      "type": "text",
      "text": "...",
      "cache_control": {"type": "ephemeral"}  // 👈 Layer 1 缓存
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "...",
          "cache_control": {"type": "ephemeral"}  // 👈 Layer 2 缓存
        }
      ]
    },
    {
      "role": "user",
      "content": "..."  // 👈 Layer 3 不缓存
    }
  ]
}
```

## 🧪 测试缓存效果

```bash
# 运行测试脚本
cd /Users/sunchaowang/Downloads/Development/gold-analysis-nj
./scripts/test-cache.sh

# 查看缓存日志
docker logs gold-analysis-nj 2>&1 | grep "cache"
```

**预期输出（当前 OpenAI 格式）：**
```
[INFO] Phase 2 prompt cache stats
  elapsed: 3245
  length: 2847
  readTokens: 4523        # 从缓存读取
  creationTokens: 0       # 未写入新缓存
  cacheHitRate: "100.0%"  # 完全命中
```

## 💰 成本对比（历史参考）

假设每天 **288 次分析**（每 5 分钟一次）

| 场景 | 无缓存 | Anthropic 优化（历史） | OpenAI 优化（当前形态） |
|------|--------|---------------|------------|
| 单次输入 token | 6000 | 6000 | 6000 |
| 有效计费 token | 6000 | ~1500 (75%↓) | ~3600 (40%↓) |
| 日成本 (Claude Sonnet) | $5.18 | $1.30 | - |
| 日成本 (GPT-4o) | $4.32 | - | $2.59 |
| 月成本 (Claude) | $155 | $39 | - |
| **年节省 (Claude)** | - | **$1,393** | - |

## 🔍 监控指标

### 关键日志字段（当前实现）

```json
{
  "level": "info",
  "msg": "Phase 2 prompt cache stats",
  "symbol": "XAUUSD",
  "strategy": "auto_prefix",
  "model": "deepseek-v4-pro",
  "readTokens": 4523,         // 👈 从缓存读取的 tokens
  "creationTokens": 1477,     // 👈 写入缓存的 tokens
  "hitTokens": 3412,          // 👈 命中的缓存 tokens
  "inputTokens": 6000,        // 👈 总输入 tokens（命中率分母）
  "cacheHitRate": "75.4%"     // 👈 命中率 = readTokens / inputTokens
}
```

### 健康指标

- ✅ **优秀**: hitRate > 70%
- ⚠️ **一般**: hitRate 40-70%
- ❌ **需优化**: hitRate < 40%

### 常见问题

**Q: hitRate 始终为 0%？**
- 检查 `LLM_BASE_URL` 是否正确（实际部署：`https://api-eo.wochirou.com/v1`）
- 流式请求必须带 `stream_options: {include_usage: true}`，否则流末 chunk 无 usage 可读
- 确认网关返回缓存字段（DeepSeek 直连：`prompt_cache_hit_tokens`；OpenAI 格式网关：`prompt_tokens_details.cached_tokens`）
- 查看请求间隔（超过 5 分钟缓存过期）

**Q: creationTokens 每次都很高？**
- 可能是 Layer 2 内容频繁变化
- 检查 K线数据更新频率
- 考虑调整 `PREFERRED_BAR_TIMEFRAMES` 使用更长周期

**Q: 如何验证缓存生效？**
- 连续发两次相同请求，第二次应该 hitRate 接近 100%
- 查看响应时间，缓存命中通常快 30-50%

## 🚀 下一步优化

### 1. 动态层级提升
如果波浪结构 30 分钟未变化，将其提升到 system 层：

```typescript
if (Date.now() - lastWaveUpdate > 30 * 60 * 1000) {
  const mergedSystem = `${systemPrompt}\n\n${staticContextPrompt}`;
  await client.streamInvokeLayered(mergedSystem, [realtimeDataPrompt]);
}
```

### 2. 多品种共享缓存
提取通用规则到共享 system prompt：

```typescript
const SHARED_RULES = `/* 通用交易规则 */`;
const symbolSpecific = buildSymbolPrompt(profile);
const systemPrompt = `${SHARED_RULES}\n\n${symbolSpecific}`;
```

### 3. Redis 应用层缓存
对于不支持原生缓存的提供商（智谱、DeepSeek）：

```typescript
const cacheKey = hash(systemPrompt + staticContext);
const cached = await redis.get(cacheKey);
if (cached) return cached;
```

## 📚 参考资料

- [OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)
- [DeepSeek API 文档（自动上下文缓存）](https://api-docs.deepseek.com/guides/kv_cache)
- [项目完整方案](./PROMPT_CACHING_OPTIMIZATION.md)
- [使用指南](./CACHE_USAGE_GUIDE.md)

## ✨ 核心优势

1. **零业务逻辑改动** - 完全向后兼容现有代码
2. **自动提供商检测** - 根据配置自动选择最优策略
3. **实时性能监控** - 日志中自动记录缓存命中率
4. **成本透明** - 清晰的缓存统计和成本节省计算
5. **渐进式部署** - 可以先测试，验证后再切换到生产

---

**立即开始**：修改 `.env` 文件，重启服务，运行 `./scripts/test-cache.sh` 验证效果。
