import { Injectable } from '@nestjs/common';
import { getLogger } from '../utils/logger.js';
import { AppConfigService } from '../config/app-config.service.js';
import { recordLlmCacheUsage } from '../metrics/llm-cache-metrics.js';

const ANTHROPIC_VERSION = '2023-06-01';
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

interface AnthropicMessage {
  role: 'user';
  content: string;
}

interface AnthropicStreamResult {
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

interface AnthropicSseParseState {
  pendingToolUse?: PendingToolUse;
}

/**
 * LLM client using Anthropic Messages API (/v1/messages).
 *
 * Request shape:
 *   - system prompt is sent as the top-level "system" field
 *   - messages[] contains only user role messages
 * Response shape:
 *   - non-streaming text is read from content[].text
 *   - streaming text is read from content_block_delta events
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

  /** @deprecated OpenAI prompt caching fields are not supported by this client. */
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

  /**
   * Build Anthropic Messages API messages. System prompts are intentionally not
   * included here; callers pass them through the top-level "system" field.
   */
  private buildMessages(prompt: string): AnthropicMessage[] {
    return [{ role: 'user', content: prompt }];
  }

  private buildRequest(prompt: string, systemMessage?: string, stream = false): RequestInit {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: this.buildMessages(prompt),
      temperature: DEFAULT_TEMPERATURE,
    };

    if (systemMessage) {
      body.system = systemMessage;
    }
    if (stream) {
      body.stream = true;
    }

    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    };
  }

  private messagesUrl(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/messages`;
  }

  private combineUserMessages(userMessages: string[]): string {
    return userMessages.join(LAYER_SEPARATOR);
  }

  private cacheControl(): Record<string, string> {
    return this.cacheStrategy.ttl === '1h'
      ? { type: 'ephemeral', ttl: '1h' }
      : { type: 'ephemeral' };
  }

  private buildLayeredRequestBody(
    systemBlocks: SystemBlock[],
    userLayers: UserLayer[],
    stream: boolean,
    opts?: InvokeOpts,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [],
      temperature: DEFAULT_TEMPERATURE,
    };

    if (stream) {
      body.stream = true;
    }

    switch (this.cacheStrategy.type) {
      case 'anthropic_explicit': {
        let breakpointCount = 0;
        body.system = systemBlocks.map((block) => {
          const systemBlock: Record<string, unknown> = {
            type: 'text',
            text: block.text,
          };
          if (block.cacheable && breakpointCount < 4) {
            systemBlock.cache_control = this.cacheControl();
            breakpointCount += 1;
          }
          return systemBlock;
        });

        body.messages = userLayers.map((layer) => {
          if (layer.cacheable && breakpointCount < 4) {
            breakpointCount += 1;
            return {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: layer.text,
                  cache_control: this.cacheControl(),
                },
              ],
            };
          }
          return { role: 'user', content: layer.text };
        });
        break;
      }

      case 'auto_prefix':
      case 'auto_prefix_unstable':
      case 'none': {
        body.system = systemBlocks.map((block) => block.text).join('\n\n');
        body.messages = userLayers.map((layer) => ({
          role: 'user',
          content: layer.text,
        }));
        break;
      }

      case 'prompt_cache_key': {
        body.system = systemBlocks.map((block) => block.text).join('\n\n');
        body.messages = userLayers.map((layer) => ({
          role: 'user',
          content: layer.text,
        }));
        body.prompt_cache_key = 'gold-analysis';
        break;
      }
    }

    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? { type: 'auto' };
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
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(this.buildLayeredRequestBody(systemBlocks, userLayers, stream, opts)),
    };
  }

  private parseResponseText(raw: Record<string, unknown>): string {
    const content = raw.content;
    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((block) => {
        if (!block || typeof block !== 'object') {
          return '';
        }
        const text = (block as Record<string, unknown>).text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }

  private readCacheUsage(usage: unknown, current: CacheStats): CacheStats {
    if (!usage || typeof usage !== 'object') {
      return current;
    }

    const rec = (v: unknown): Record<string, unknown> | undefined =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;

    const usageRecord = usage as Record<string, unknown>;

    // Anthropic-style top-level fields — also emitted by OpenAI-semantic gateways
    // (this deployment's gateway returns these even for DeepSeek models).
    const readTokens = usageRecord.cache_read_input_tokens;
    const creationTokens = usageRecord.cache_creation_input_tokens;
    const inputTokens = usageRecord.input_tokens;

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
    const fresh = typeof inputTokens === 'number' ? inputTokens : current.inputTokens;
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

  private processAnthropicSseEvent(
    rawEvent: string,
    result: AnthropicStreamResult,
    parseState: AnthropicSseParseState,
  ): AnthropicStreamResult {
    const lines = rawEvent.split(/\r?\n/);
    let eventName = '';
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    if (!eventName || dataLines.length === 0) {
      return result;
    }

    const dataStr = dataLines.join('\n').trim();
    if (!dataStr || dataStr === '[DONE]') {
      return result;
    }

    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;

      if (eventName === 'content_block_start') {
        const block = data.content_block as Record<string, unknown> | undefined;
        if (block?.type === 'tool_use') {
          const id = typeof block.id === 'string' ? block.id : '';
          const name = typeof block.name === 'string' ? block.name : '';
          if (id && name) {
            parseState.pendingToolUse = { id, name, inputJson: '' };
          }
        }
      }

      if (eventName === 'content_block_delta') {
        const delta = data.delta as Record<string, unknown> | undefined;
        if (
          parseState.pendingToolUse &&
          delta?.type === 'input_json_delta' &&
          typeof delta.partial_json === 'string'
        ) {
          parseState.pendingToolUse.inputJson += delta.partial_json;
          return result;
        }
        if (delta && typeof delta.text === 'string') {
          return {
            ...result,
            content: result.content + delta.text,
            chunks: result.chunks + 1,
          };
        }
      }

      if (eventName === 'content_block_stop' && parseState.pendingToolUse) {
        const pendingToolUse = parseState.pendingToolUse;
        parseState.pendingToolUse = undefined;
        try {
          const input = JSON.parse(pendingToolUse.inputJson) as unknown;
          if (input && typeof input === 'object' && !Array.isArray(input)) {
            return {
              ...result,
              toolUse: {
                id: pendingToolUse.id,
                name: pendingToolUse.name,
                input: input as Record<string, unknown>,
              },
            };
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

      if (eventName === 'message_start' && data.message && typeof data.message === 'object') {
        const message = data.message as Record<string, unknown>;
        return {
          ...result,
          cacheStats: this.readCacheUsage(message.usage, result.cacheStats),
        };
      }

      if (eventName === 'message_delta') {
        return {
          ...result,
          cacheStats: this.readCacheUsage(data.usage, result.cacheStats),
        };
      }
    } catch {
      return result;
    }

    return result;
  }

  private async readAnthropicStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<AnthropicStreamResult> {
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AnthropicStreamResult = {
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
    const parseState: AnthropicSseParseState = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const event of events) {
        if (event.trim()) {
          result = this.processAnthropicSseEvent(event, result, parseState);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      result = this.processAnthropicSseEvent(buffer, result, parseState);
    }

    return result;
  }

  /**
   * Non-streaming invoke - sends a single Messages API request and returns the
   * full assistant text.
   */
  async invoke(prompt: string, systemMessage?: string): Promise<string> {
    const logger = getLogger();
    const url = this.messagesUrl();
    const request = this.buildRequest(prompt, systemMessage, false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      logger.debug({ url, model: this.config.model }, 'LLM invoke (Anthropic Messages)');
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`Anthropic Messages API ${response.status}: ${body}`);
      }

      const json = await response.json() as Record<string, unknown>;
      return this.parseResponseText(json);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Streaming invoke - collects Anthropic SSE content_block_delta text chunks.
   */
  async streamInvoke(prompt: string, systemMessage?: string): Promise<string> {
    const logger = getLogger();
    const url = this.messagesUrl();
    const request = this.buildRequest(prompt, systemMessage, true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    const startTime = Date.now();
    try {
      logger.debug({ url, model: this.config.model }, 'LLM streamInvoke (Anthropic Messages)');
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`Anthropic Messages API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readAnthropicStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        { elapsed, chunks: result.chunks, length: result.content.length },
        'streamInvoke: complete (Anthropic Messages)',
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
   * independent request blocks/messages so providers can match stable prefixes.
   */
  async streamLayered(
    systemBlocks: SystemBlock[],
    userLayers: UserLayer[],
    opts?: InvokeOpts,
  ): Promise<{ content: string; cacheStats: CacheStats; toolUse?: AnthropicToolUse }> {
    const logger = getLogger();
    const url = this.messagesUrl();
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
        'LLM streamLayered (Anthropic Messages)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`Anthropic Messages API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readAnthropicStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        {
          elapsed,
          chunks: result.chunks,
          length: result.content.length,
          strategy: this.cacheStrategy.type,
          cacheStats: result.cacheStats,
        },
        'streamLayered: complete (Anthropic Messages)',
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
    const url = this.messagesUrl();
    const request = this.buildRequest(prompt, systemMessage, true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const startTime = Date.now();

    try {
      logger.debug(
        { url, model: this.config.model, layers: userMessages.length },
        'LLM streamInvokeLayered (Anthropic Messages)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`Anthropic Messages API ${response.status}: ${body}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const result = await this.readAnthropicStream(reader);
      const elapsed = Date.now() - startTime;
      logger.debug(
        { elapsed, chunks: result.chunks, length: result.content.length, layers: userMessages.length },
        'streamInvokeLayered: complete (Anthropic Messages)',
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
   * Compatibility wrapper for callers that expect Anthropic cache statistics.
   * The request still uses the standard Messages format; any cache counters are
   * read from message_start/message_delta usage fields when the gateway sends
   * them.
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
    const url = this.messagesUrl();
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
        'LLM invokeLayered (Anthropic Messages)',
      );
      const response = await fetch(url, { ...request, signal: controller.signal });

      if (!response.ok) {
        const body = await response.text().catch(() => 'no body');
        throw new Error(`Anthropic Messages API ${response.status}: ${body}`);
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
