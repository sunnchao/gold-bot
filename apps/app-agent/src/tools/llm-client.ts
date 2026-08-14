import { Injectable } from '@nestjs/common';
import { getLogger } from '../utils/logger.js';
import { AppConfigService } from '../config/app-config.service.js';
import { recordLlmCacheUsage } from '../metrics/llm-cache-metrics.js';

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.1;
const LAYER_SEPARATOR = '\n\n----------------------------------------\n\n';

export type CacheStrategyType =
  | 'anthropic_explicit'
  | 'auto_prefix'
  | 'prompt_cache_key'
  | 'auto_prefix_unstable'
  | 'none';

export interface CacheStrategy {
  type: CacheStrategyType;
  ttl?: '5m' | '1h';
}

export interface SystemBlock {
  text: string;
  cacheable: boolean;
}

export interface UserLayer {
  text: string;
  cacheable: boolean;
}

export interface CacheStats {
  readTokens: number;
  creationTokens: number;
  hitTokens: number;
  missTokens: number;
  /** Fresh (non-cached) input tokens — denominator for cache hit rate. */
  inputTokens: number;
}

/**
 * Cache hit rate = cache_read_input_tokens / input_tokens. Both are on the
 * same "full input" scale on this gateway (input_tokens stays full on a hit),
 * so the ratio is directly the fraction of input served from cache.
 */
export function computeCacheHitRate(stats: Pick<CacheStats, 'readTokens' | 'inputTokens'>): number {
  if (!stats.inputTokens || stats.inputTokens <= 0) {
    return 0;
  }
  return stats.readTokens / stats.inputTokens;
}

interface ModelPattern {
  keywords: string[];
  strategy: CacheStrategy;
}

const MODEL_CACHE_PATTERNS: ModelPattern[] = [
  {
    keywords: ['claude'],
    strategy: { type: 'anthropic_explicit', ttl: '1h' },
  },
  {
    keywords: ['deepseek'],
    strategy: { type: 'auto_prefix' },
  },
  {
    keywords: ['gpt-', 'gpt4', 'gpt-4', '-o1', '-o3', '-o4'],
    strategy: { type: 'auto_prefix' },
  },
  {
    keywords: ['moonshot', 'kimi'],
    strategy: { type: 'prompt_cache_key' },
  },
  {
    keywords: ['glm', 'chatglm'],
    strategy: { type: 'auto_prefix_unstable' },
  },
  {
    keywords: ['minimax', 'abab'],
    strategy: { type: 'none' },
  },
];

export function detectCacheStrategy(model: string, enablePromptCaching: boolean): CacheStrategy {
  if (!enablePromptCaching) return { type: 'none' };

  const modelLower = model.toLowerCase();
  for (const pattern of MODEL_CACHE_PATTERNS) {
    if (pattern.keywords.some((keyword) => modelLower.includes(keyword))) {
      return { ...pattern.strategy };
    }
  }

  return { type: 'auto_prefix' };
}

export interface LLMClientConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  timeout: number;
  maxRetries: number;
  enablePromptCaching: boolean;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionsStreamResult {
  content: string;
  chunks: number;
  cacheStats: CacheStats;
  toolUse?: AnthropicToolUse;
}

export interface AnthropicToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface InvokeOpts {
  tools?: ReadonlyArray<{ name: string; description: string; input_schema: unknown }>;
  toolChoice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

interface PendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

interface ChatCompletionsSseParseState {
  pendingToolUses: Map<number, PendingToolUse>;
  done: boolean;
}

/**
 * LLM client using the OpenAI Chat Completions API.
 *
 * Request shape:
 *   - a non-empty system prompt is the first messages[] entry
 *   - user prompts follow as ordered messages[] entries
 * Response shape:
 *   - non-streaming text is read from choices[0].message.content
 *   - streaming text is read from choices[0].delta.content
 */
export class LLMClient {
  private readonly config: LLMClientConfig;
  private readonly cacheStrategy: CacheStrategy;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.cacheStrategy = detectCacheStrategy(config.model, config.enablePromptCaching);
  }

  /**
   * @deprecated Use getCacheStrategy() and streamLayered()/invokeLayered() instead.
   */
  isPromptCachingSupported(): boolean {
    return this.cacheStrategy.type === 'anthropic_explicit';
  }

  /** @deprecated OpenAI prompt caching fields are not exposed by this client. */
  isOpenAIPromptCachingEnabled(): boolean {
    return false;
  }

  /** @deprecated Use isPromptCachingSupported() instead. */
  isAnthropicPromptCachingEnabled(): boolean {
    return this.isPromptCachingSupported();
  }

  getCacheStrategy(): CacheStrategy {
    return { ...this.cacheStrategy };
  }

  getModel(): string {
    return this.config.model;
  }

  private buildMessages(prompt: string, systemMessage?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  private buildRequest(prompt: string, systemMessage?: string, stream = false): RequestInit {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: this.buildMessages(prompt, systemMessage),
      temperature: DEFAULT_TEMPERATURE,
    };

    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    };
  }

  private completionsUrl(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private combineUserMessages(userMessages: string[]): string {
    return userMessages.join(LAYER_SEPARATOR);
  }

  private buildLayeredRequestBody(
    systemBlocks: SystemBlock[],
    userLayers: UserLayer[],
    stream: boolean,
    opts?: InvokeOpts,
  ): Record<string, unknown> {
    const systemMessage = systemBlocks.map((block) => block.text).join('\n\n');
    const messages: ChatMessage[] = [];
    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }
    messages.push(...userLayers.map((layer) => ({ role: 'user' as const, content: layer.text })));

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages,
      temperature: DEFAULT_TEMPERATURE,
    };

    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    if (this.cacheStrategy.type === 'prompt_cache_key') {
      body.prompt_cache_key = 'gold-analysis';
    }

    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }));
      switch (opts.toolChoice?.type) {
        case 'any':
          body.tool_choice = 'required';
          break;
        case 'tool':
          body.tool_choice = {
            type: 'function',
            function: { name: opts.toolChoice.name },
          };
          break;
        case 'auto':
        default:
          body.tool_choice = 'auto';
      }
    }

    return body;
  }

  private buildLayeredRequest(
    systemBlocks: SystemBlock[],
    userLayers: UserLayer[],
    stream: boolean,
    opts?: InvokeOpts,
  ): RequestInit {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(this.buildLayeredRequestBody(systemBlocks, userLayers, stream, opts)),
    };
  }

  private parseResponseText(raw: Record<string, unknown>): string {
    if (!Array.isArray(raw.choices)) {
      return '';
    }
    const choice = raw.choices[0];
    if (!choice || typeof choice !== 'object') {
      return '';
    }
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== 'object') {
      return '';
    }
    const content = (message as Record<string, unknown>).content;
    return typeof content === 'string' ? content : '';
  }

  private readCacheUsage(usage: unknown, current: CacheStats): CacheStats {
    if (!usage || typeof usage !== 'object') {
      return current;
    }

    const rec = (v: unknown): Record<string, unknown> | undefined =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;

    const usageRecord = usage as Record<string, unknown>;

    // Legacy top-level cache fields are still emitted by some OpenAI-compatible gateways.
    const readTokens = usageRecord.cache_read_input_tokens;
    const creationTokens = usageRecord.cache_creation_input_tokens;
    const inputTokens = usageRecord.input_tokens;
    const promptTokens = usageRecord.prompt_tokens;

    // DeepSeek-native cache fields (present only when talking to DeepSeek directly).
    const deepseekHitTokens = usageRecord.prompt_cache_hit_tokens;
    const deepseekMissTokens = usageRecord.prompt_cache_miss_tokens;

    // OpenAI-style cached tokens: top-level prompt_tokens_details, and nested under
    // billing_usage.openai_usage.prompt_tokens_details (this gateway's real location).
    const openAiCachedTokens = rec(usageRecord.prompt_tokens_details)?.cached_tokens;
    const openaiUsage = rec(rec(usageRecord.billing_usage)?.openai_usage);
    const nestedCachedTokens = rec(openaiUsage?.prompt_tokens_details)?.cached_tokens;

    const kimiCachedTokens = usageRecord.cached_tokens;

    const read = typeof readTokens === 'number' ? readTokens : current.readTokens;
    const created = typeof creationTokens === 'number' ? creationTokens : current.creationTokens;
    const fresh = typeof inputTokens === 'number'
      ? inputTokens
      : typeof promptTokens === 'number'
        ? promptTokens
        : current.inputTokens;
    const hit = typeof deepseekHitTokens === 'number'
      ? deepseekHitTokens
      : typeof openAiCachedTokens === 'number'
        ? openAiCachedTokens
        : typeof nestedCachedTokens === 'number'
          ? nestedCachedTokens
          : typeof kimiCachedTokens === 'number'
            ? kimiCachedTokens
            : current.hitTokens;
    const miss = typeof deepseekMissTokens === 'number' ? deepseekMissTokens : current.missTokens;

    return {
      readTokens: read,
      creationTokens: created,
      hitTokens: hit,
      missTokens: miss,
      inputTokens: fresh,
    };
  }

  private processChatCompletionsSseEvent(
    rawEvent: string,
    result: ChatCompletionsStreamResult,
    parseState: ChatCompletionsSseParseState,
  ): ChatCompletionsStreamResult {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return result;
    }

    const dataStr = dataLines.join('\n').trim();
    if (!dataStr) {
      return result;
    }
    if (dataStr === '[DONE]') {
      parseState.done = true;
      return result;
    }

    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;
      let nextResult: ChatCompletionsStreamResult = {
        ...result,
        cacheStats: this.readCacheUsage(data.usage, result.cacheStats),
      };
      const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
      if (!choice || typeof choice !== 'object') {
        return nextResult;
      }

      const choiceRecord = choice as Record<string, unknown>;
      const delta = choiceRecord.delta;
      if (delta && typeof delta === 'object') {
        const deltaRecord = delta as Record<string, unknown>;
        if (typeof deltaRecord.content === 'string') {
          nextResult = {
            ...nextResult,
            content: nextResult.content + deltaRecord.content,
            chunks: nextResult.chunks + 1,
          };
        }

        if (Array.isArray(deltaRecord.tool_calls)) {
          for (const rawToolCall of deltaRecord.tool_calls) {
            if (!rawToolCall || typeof rawToolCall !== 'object') continue;
            const toolCall = rawToolCall as Record<string, unknown>;
            if (typeof toolCall.index !== 'number') continue;

            const pending = parseState.pendingToolUses.get(toolCall.index) ?? {
              id: '',
              name: '',
              inputJson: '',
            };
            if (typeof toolCall.id === 'string') {
              pending.id = toolCall.id;
            }
            const fn = toolCall.function;
            if (fn && typeof fn === 'object') {
              const functionRecord = fn as Record<string, unknown>;
              if (typeof functionRecord.name === 'string') {
                pending.name = functionRecord.name;
              }
              if (typeof functionRecord.arguments === 'string') {
                pending.inputJson += functionRecord.arguments;
              }
            }
            parseState.pendingToolUses.set(toolCall.index, pending);
          }
        }
      }

      if (choiceRecord.finish_reason === 'tool_calls') {
        for (const [, pendingToolUse] of [...parseState.pendingToolUses].sort(([a], [b]) => a - b)) {
          try {
            const input = JSON.parse(pendingToolUse.inputJson) as unknown;
            if (input && typeof input === 'object' && !Array.isArray(input)) {
              nextResult = {
                ...nextResult,
                toolUse: {
                  id: pendingToolUse.id,
                  name: pendingToolUse.name,
                  input: input as Record<string, unknown>,
                },
              };
              break;
            }
          } catch (err) {
            getLogger().warn(
              {
                err: err instanceof Error ? err.message : String(err),
                rawJson: pendingToolUse.inputJson,
              },
              'tool_use input parse failed',
            );
          }
        }
        parseState.pendingToolUses.clear();
      }

      return nextResult;
    } catch {
      return result;
    }
  }

  private async readChatCompletionsStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<ChatCompletionsStreamResult> {
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ChatCompletionsStreamResult = {
      content: '',
      chunks: 0,
      cacheStats: {
        readTokens: 0,
        creationTokens: 0,
        hitTokens: 0,
        missTokens: 0,
        inputTokens: 0,
      },
    };
    const parseState: ChatCompletionsSseParseState = {
      pendingToolUses: new Map(),
      done: false,
    };

    while (!parseState.done) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const event of events) {
        if (event.trim()) {
          result = this.processChatCompletionsSseEvent(event, result, parseState);
          if (parseState.done) break;
        }
      }
    }

    buffer += decoder.decode();
    if (!parseState.done && buffer.trim()) {
      result = this.processChatCompletionsSseEvent(buffer, result, parseState);
    }

    return result;
  }

  /**
   * Non-streaming invoke - sends one Chat Completions request and returns the
   * full assistant text.
   */
  async invoke(prompt: string, systemMessage?: string): Promise<string> {
    const logger = getLogger();
    const url = this.completionsUrl();
    const request = this.buildRequest(prompt, systemMessage, false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      logger.debug({ url, model: this.config.model }, 'LLM invoke (OpenAI Chat Completions)');
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`OpenAI Chat Completions API ${response.status}: ${body}`);
      }

      const json = await response.json() as Record<string, unknown>;
      return this.parseResponseText(json);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Streaming invoke - collects OpenAI Chat Completions SSE text chunks.
   */
  async streamInvoke(prompt: string, systemMessage?: string): Promise<string> {
    const logger = getLogger();
    const url = this.completionsUrl();
    const request = this.buildRequest(prompt, systemMessage, true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    const startTime = Date.now();
    try {
      logger.debug({ url, model: this.config.model }, 'LLM streamInvoke (OpenAI Chat Completions)');
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`OpenAI Chat Completions API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readChatCompletionsStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        { elapsed, chunks: result.chunks, length: result.content.length },
        'streamInvoke: complete (OpenAI Chat Completions)',
      );

      return result.content;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), elapsed },
        'streamInvoke: failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Strategy-aware layered streaming invoke. Preserves cacheable layers as
   * independent request messages so providers can match stable prefixes.
   */
  async streamLayered(
    systemBlocks: SystemBlock[],
    userLayers: UserLayer[],
    opts?: InvokeOpts,
  ): Promise<{ content: string; cacheStats: CacheStats; toolUse?: AnthropicToolUse }> {
    const logger = getLogger();
    const url = this.completionsUrl();
    const request = this.buildLayeredRequest(systemBlocks, userLayers, true, opts);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const startTime = Date.now();

    try {
      logger.debug(
        {
          url,
          model: this.config.model,
          strategy: this.cacheStrategy.type,
          systemBlocks: systemBlocks.length,
          userLayers: userLayers.length,
        },
        'LLM streamLayered (OpenAI Chat Completions)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`OpenAI Chat Completions API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readChatCompletionsStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        {
          elapsed,
          chunks: result.chunks,
          length: result.content.length,
          strategy: this.cacheStrategy.type,
          cacheStats: result.cacheStats,
        },
        'streamLayered: complete (OpenAI Chat Completions)',
      );

      const responseBody: { content: string; cacheStats: CacheStats; toolUse?: AnthropicToolUse } = {
        content: result.content,
        cacheStats: result.cacheStats,
      };
      if (result.toolUse) {
        responseBody.toolUse = result.toolUse;
      }

      recordLlmCacheUsage(result.cacheStats, this.config.model);

      return responseBody;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), elapsed },
        'streamLayered: failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @deprecated Use streamLayered(systemBlocks, userLayers). This compatibility
   * wrapper intentionally preserves the old merged single-user-message request.
   */
  async streamInvokeLayered(
    systemMessage: string,
    userMessages: string[],
  ): Promise<string> {
    const logger = getLogger();
    const prompt = this.combineUserMessages(userMessages);
    const url = this.completionsUrl();
    const request = this.buildRequest(prompt, systemMessage, true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const startTime = Date.now();

    try {
      logger.debug(
        { url, model: this.config.model, layers: userMessages.length },
        'LLM streamInvokeLayered (OpenAI Chat Completions)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`OpenAI Chat Completions API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readChatCompletionsStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        { elapsed, chunks: result.chunks, length: result.content.length, layers: userMessages.length },
        'streamInvokeLayered: complete (OpenAI Chat Completions)',
      );

      return result.content;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), elapsed },
        'streamInvokeLayered: failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Compatibility wrapper retaining the legacy method name and cache shape.
   * The request uses Chat Completions and reads cache counters from stream usage.
   */
  async streamInvokeLayeredAnthropic(
    systemMessage: string,
    userMessages: string[],
  ): Promise<{ content: string; cacheStats: { readTokens: number; creationTokens: number } }> {
    const result = await this.streamLayered(
      [{ text: systemMessage, cacheable: true }],
      userMessages.map((message, index) => ({
        text: message,
        cacheable: index < userMessages.length - 1,
      })),
    );
    return {
      content: result.content,
      cacheStats: {
        readTokens: result.cacheStats.readTokens,
        creationTokens: result.cacheStats.creationTokens,
      },
    };
  }

  /**
   * Non-streaming fallback for layered invocations.
   */
  async invokeLayered(
    systemMessage: string | SystemBlock[],
    userMessages: string[] | UserLayer[],
    opts?: InvokeOpts,
  ): Promise<string> {
    const logger = getLogger();
    const url = this.completionsUrl();
    const request = typeof systemMessage === 'string'
      ? this.buildRequest(
          this.combineUserMessages(userMessages as string[]),
          systemMessage,
          false,
        )
      : this.buildLayeredRequest(systemMessage, userMessages as UserLayer[], false, opts);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      logger.debug(
        { url, model: this.config.model, layers: userMessages.length },
        'LLM invokeLayered (OpenAI Chat Completions)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`OpenAI Chat Completions API ${response.status}: ${body}`);
      }

      const json = await response.json() as Record<string, unknown>;
      return this.parseResponseText(json);
    } finally {
      clearTimeout(timer);
    }
  }
}

@Injectable()
export class LlmClientService extends LLMClient {
  constructor(config: AppConfigService) {
    super({
      provider: config.llm.provider,
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      fallbackModel: config.llm.fallbackModel,
      timeout: config.llm.timeout,
      maxRetries: config.llm.maxRetries,
      enablePromptCaching: config.llm.enablePromptCaching,
    });
  }
}
