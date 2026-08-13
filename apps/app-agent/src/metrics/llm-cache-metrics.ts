import { Counter, Gauge, Registry } from 'prom-client';

/**
 * LLM prompt-cache metrics for the app-agent.
 *
 * The app-server already exposes `goldbot_*` metrics on port 8880. This module
 * adds a small, self-contained Prometheus registry for the agent so cache
 * hit-rate can be observed independently of the trading engine (prom-client is
 * shared via the pnpm workspace, no new download is required).
 *
 * Hit-rate semantics differ by cache strategy:
 *   - anthropic_explicit: cached tokens arrive via `cache_read_input_tokens`
 *     (readTokens), hit rate = readTokens / inputTokens.
 *   - auto_prefix (DeepSeek/OpenAI/Kimi): cached tokens arrive via
 *     `prompt_cache_hit_tokens` / `cached_tokens` (hitTokens), hit rate =
 *     hitTokens / inputTokens.
 * `recordLlmCacheUsage` normalizes both onto a single `goldbot_llm_cache_hit_rate`
 * gauge by taking max(readTokens, hitTokens) — the two fields are never both
 * non-zero for a single provider.
 */

const registry = new Registry();

const cacheReadTokens = new Counter({
  name: 'goldbot_llm_cache_read_tokens_total',
  help: 'Cumulative cache-read input tokens (Anthropic cache_read_input_tokens).',
  labelNames: ['model'],
  registers: [registry],
});

const cacheHitTokens = new Counter({
  name: 'goldbot_llm_cache_hit_tokens_total',
  help: 'Cumulative cached input tokens reported by DeepSeek/OpenAI/Kimi gateways.',
  labelNames: ['model'],
  registers: [registry],
});

const cacheCreationTokens = new Counter({
  name: 'goldbot_llm_cache_creation_tokens_total',
  help: 'Cumulative cache-creation input tokens.',
  labelNames: ['model'],
  registers: [registry],
});

const cacheInputTokens = new Counter({
  name: 'goldbot_llm_cache_input_tokens_total',
  help: 'Cumulative total input tokens across LLM requests.',
  labelNames: ['model'],
  registers: [registry],
});

const cacheHitRate = new Gauge({
  name: 'goldbot_llm_cache_hit_rate',
  help: 'Cache hit rate (cached / total input tokens) of the most recent request.',
  labelNames: ['model'],
  registers: [registry],
});

export interface LlmCacheUsage {
  readTokens: number;
  hitTokens: number;
  creationTokens: number;
  inputTokens: number;
}

export function recordLlmCacheUsage(usage: LlmCacheUsage, model: string): void {
  const labels = { model };
  cacheReadTokens.inc(labels, usage.readTokens);
  cacheHitTokens.inc(labels, usage.hitTokens);
  cacheCreationTokens.inc(labels, usage.creationTokens);
  cacheInputTokens.inc(labels, usage.inputTokens);

  if (usage.inputTokens > 0) {
    const cached = Math.max(usage.readTokens, usage.hitTokens);
    cacheHitRate.set(labels, cached / usage.inputTokens);
  }
}

export function llmCacheRegistry(): Registry {
  return registry;
}
