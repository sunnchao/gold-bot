import { beforeEach, describe, expect, it } from 'vitest';
import { llmCacheRegistry, recordLlmCacheUsage } from './llm-cache-metrics.js';
import { Registry } from 'prom-client';

describe('llm-cache-metrics', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = llmCacheRegistry();
    // Reset metric values so each test observes a clean slate. (clear() would
    // unregister the module-level collectors entirely.)
    registry.resetMetrics();
  });

  it('computes hit rate as max(readTokens, hitTokens) / inputTokens', async () => {
    // Anthropic explicit: readTokens carries the cache hit.
    recordLlmCacheUsage(
      { readTokens: 800, hitTokens: 0, creationTokens: 200, inputTokens: 1000 },
      'claude-opus-4-8',
    );
    // DeepSeek auto_prefix: hitTokens carries the cache hit.
    recordLlmCacheUsage(
      { readTokens: 0, hitTokens: 300, creationTokens: 0, inputTokens: 1000 },
      'deepseek-v4-pro',
    );

    const metrics = await registry.metrics();
    expect(metrics).toContain('goldbot_llm_cache_hit_rate{model="claude-opus-4-8"} 0.8');
    expect(metrics).toContain('goldbot_llm_cache_hit_rate{model="deepseek-v4-pro"} 0.3');
  });

  it('does not emit a hit rate when inputTokens is zero', async () => {
    recordLlmCacheUsage(
      { readTokens: 0, hitTokens: 0, creationTokens: 0, inputTokens: 0 },
      'gpt-4o',
    );

    const metrics = await registry.metrics();
    expect(metrics).not.toContain('goldbot_llm_cache_hit_rate{model="gpt-4o"}');
  });

  it('accumulates token counters across requests', async () => {
    recordLlmCacheUsage(
      { readTokens: 100, hitTokens: 0, creationTokens: 50, inputTokens: 500 },
      'gpt-4o',
    );
    recordLlmCacheUsage(
      { readTokens: 0, hitTokens: 200, creationTokens: 0, inputTokens: 400 },
      'gpt-4o',
    );

    const metrics = await registry.metrics();
    expect(metrics).toContain('goldbot_llm_cache_input_tokens_total{model="gpt-4o"} 900');
    expect(metrics).toContain('goldbot_llm_cache_hit_tokens_total{model="gpt-4o"} 200');
  });
});
