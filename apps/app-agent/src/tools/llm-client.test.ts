import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClient, LlmClientService } from './llm-client.js';
import type { AppConfigService } from '../config/app-config.service.js';
import { TRADE_ACTION_TOOLS } from '../types/trade-action.js';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  getLogger: () => loggerMock,
}));

describe('LLMClient', () => {
  const defaultConfig = {
    provider: 'custom',
    baseUrl: 'https://gateway.example/v1/',
    apiKey: 'sk-test-key',
    model: 'gpt-4o',
    fallbackModel: 'gpt-4o-mini',
    timeout: 120000,
    maxRetries: 3,
    enablePromptCaching: true,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.clearAllMocks();
  });

  function mockOpenAiJson(content: string | null = 'Hello world') {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });
  }

  function mockOpenAiResponse(body: Record<string, unknown>) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
  }

  function sse(data: unknown): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  function mockOpenAiStream(parts: string[]) {
    const encoder = new TextEncoder();
    const mockStream = new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      body: mockStream,
    });
  }

  function bodyFromFetchCall(index = 0): Record<string, any> {
    return JSON.parse(fetchMock.mock.calls[index][1].body);
  }

  it('uses the OpenAI Chat Completions endpoint, headers, and messages', async () => {
    mockOpenAiJson();

    const client = new LLMClient(defaultConfig);
    const result = await client.invoke('Say hello', 'You are terse');

    expect(result).toBe('Hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/chat/completions');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-key',
    });
    expect(bodyFromFetchCall()).toEqual({
      model: 'gpt-4o',
      max_tokens: 8192,
      messages: [
        { role: 'system', content: 'You are terse' },
        { role: 'user', content: 'Say hello' },
      ],
      temperature: 0.1,
    });
  });

  it('omits an empty system prompt and returns empty text for null or missing content', async () => {
    mockOpenAiJson(null);
    const client = new LLMClient(defaultConfig);

    await expect(client.invoke('first', '')).resolves.toBe('');
    expect(bodyFromFetchCall().messages).toEqual([{ role: 'user', content: 'first' }]);

    mockOpenAiResponse({ choices: [{ message: {} }] });
    await expect(client.invoke('second')).resolves.toBe('');
  });

  it('detects cache strategy from model name and preserves compatibility methods', () => {
    const claudeViaGateway = new LLMClient({
      ...defaultConfig,
      provider: 'wochirou',
      model: 'claude-opus-4-8',
    });
    const deepseekViaAnthropicProvider = new LLMClient({
      ...defaultConfig,
      provider: 'anthropic',
      model: 'deepseek-v4-pro',
    });
    const kimi = new LLMClient({ ...defaultConfig, model: 'moonshot-v1-128k' });
    const glm = new LLMClient({ ...defaultConfig, model: 'glm-4.5' });
    const minimax = new LLMClient({ ...defaultConfig, model: 'abab6.5s-chat' });
    const disabled = new LLMClient({
      ...defaultConfig,
      model: 'claude-sonnet-4',
      enablePromptCaching: false,
    });

    expect(claudeViaGateway.getCacheStrategy()).toEqual({ type: 'anthropic_explicit', ttl: '1h' });
    expect(claudeViaGateway.isPromptCachingSupported()).toBe(true);
    expect(claudeViaGateway.isAnthropicPromptCachingEnabled()).toBe(true);
    expect(claudeViaGateway.isOpenAIPromptCachingEnabled()).toBe(false);
    expect(deepseekViaAnthropicProvider.getCacheStrategy()).toEqual({ type: 'auto_prefix' });
    expect(kimi.getCacheStrategy()).toEqual({ type: 'prompt_cache_key' });
    expect(glm.getCacheStrategy()).toEqual({ type: 'auto_prefix_unstable' });
    expect(minimax.getCacheStrategy()).toEqual({ type: 'none' });
    expect(disabled.getCacheStrategy()).toEqual({ type: 'none' });
  });

  it('builds layered messages without cache_control and includes streaming usage', async () => {
    mockOpenAiStream([
      sse({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] }),
      sse({
        choices: [],
        usage: {
          input_tokens: 300,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
      }),
      'data: [DONE]\n\n',
    ]);

    const client = new LLMClient({ ...defaultConfig, model: 'claude-opus-4-8' });
    const result = await client.streamLayered(
      [
        { text: 'common rules', cacheable: true },
        { text: 'symbol rules', cacheable: true },
      ],
      [
        { text: 'computed structures', cacheable: true },
        { text: 'live market data', cacheable: false },
      ],
    );

    expect(result).toEqual({
      content: 'ok',
      cacheStats: {
        readTokens: 200,
        creationTokens: 100,
        hitTokens: 0,
        missTokens: 0,
        inputTokens: 300,
      },
    });
    expect(bodyFromFetchCall()).toMatchObject({
      messages: [
        { role: 'system', content: 'common rules\n\nsymbol rules' },
        { role: 'user', content: 'computed structures' },
        { role: 'user', content: 'live market data' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(JSON.stringify(bodyFromFetchCall())).not.toContain('cache_control');
    expect(bodyFromFetchCall().prompt_cache_key).toBeUndefined();
  });

  it('keeps automatic-prefix providers free of explicit cache fields', async () => {
    mockOpenAiJson('ok');

    const client = new LLMClient({ ...defaultConfig, model: 'deepseek-v4-pro' });
    await client.invokeLayered(
      [{ text: 'system', cacheable: true }],
      [{ text: 'user', cacheable: true }],
    );

    expect(JSON.stringify(bodyFromFetchCall())).not.toContain('cache_control');
    expect(bodyFromFetchCall().prompt_cache_key).toBeUndefined();
  });

  it('adds prompt_cache_key only for Kimi/Moonshot strategy', async () => {
    mockOpenAiJson('ok');

    const client = new LLMClient({ ...defaultConfig, model: 'kimi-k2' });
    await client.invokeLayered(
      [{ text: 'system', cacheable: true }],
      [{ text: 'user', cacheable: true }],
    );

    expect(bodyFromFetchCall().prompt_cache_key).toBe('gold-analysis');
    expect(JSON.stringify(bodyFromFetchCall())).not.toContain('cache_control');
  });

  it.each([
    ['missing choice', undefined, 'auto'],
    ['auto choice', { type: 'auto' as const }, 'auto'],
    ['any choice', { type: 'any' as const }, 'required'],
    [
      'named choice',
      { type: 'tool' as const, name: 'place_pending_order' },
      { type: 'function', function: { name: 'place_pending_order' } },
    ],
  ])('maps tools and %s to OpenAI function calling', async (_label, toolChoice, expectedChoice) => {
    mockOpenAiJson('ok');
    const client = new LLMClient(defaultConfig);

    await client.invokeLayered(
      [{ text: 'system', cacheable: true }],
      [{ text: 'user', cacheable: false }],
      { tools: TRADE_ACTION_TOOLS, toolChoice },
    );

    expect(bodyFromFetchCall().tools).toEqual(
      TRADE_ACTION_TOOLS.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
    );
    expect(bodyFromFetchCall().tool_choice).toEqual(expectedChoice);
  });

  it('accumulates indexed streaming tool call arguments and returns the public toolUse shape', async () => {
    mockOpenAiStream([
      sse({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_01',
              type: 'function',
              function: { name: 'place_pending_order', arguments: '{"side":"buy",' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sse({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"entry_price":4145,"stop_loss":4125}' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ]);

    const client = new LLMClient(defaultConfig);
    const result = await client.streamLayered(
      [{ text: 'sys', cacheable: true }],
      [{ text: 'user', cacheable: true }],
      { tools: TRADE_ACTION_TOOLS, toolChoice: { type: 'any' } },
    );

    expect(result.toolUse).toEqual({
      id: 'call_01',
      name: 'place_pending_order',
      input: { side: 'buy', entry_price: 4145, stop_loss: 4125 },
    });
  });

  it('preserves the warning behavior for invalid streaming tool JSON', async () => {
    mockOpenAiStream([
      sse({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_bad',
              function: { name: 'place_pending_order', arguments: '{bad' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ]);

    const result = await new LLMClient(defaultConfig).streamLayered(
      [{ text: 'sys', cacheable: true }],
      [{ text: 'user', cacheable: false }],
    );

    expect(result.toolUse).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawJson: '{bad' }),
      'tool_use input parse failed',
    );
  });

  it('preserves usage field precedence and input_tokens over prompt_tokens', async () => {
    mockOpenAiStream([
      sse({ choices: [{ delta: { content: 'cached' }, finish_reason: null }] }),
      sse({
        choices: [],
        usage: {
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
          input_tokens: 400,
          prompt_tokens: 999,
          prompt_cache_hit_tokens: 300,
          prompt_cache_miss_tokens: 50,
          prompt_tokens_details: { cached_tokens: 120 },
          billing_usage: { openai_usage: { prompt_tokens_details: { cached_tokens: 110 } } },
          cached_tokens: 90,
        },
      }),
      'data: [DONE]\n\n',
    ]);

    const result = await new LLMClient(defaultConfig).streamLayered(
      [{ text: 'system', cacheable: true }],
      [{ text: 'user', cacheable: true }],
    );

    expect(result).toEqual({
      content: 'cached',
      cacheStats: {
        readTokens: 200,
        creationTokens: 100,
        hitTokens: 300,
        missTokens: 50,
        inputTokens: 400,
      },
    });
  });

  it('falls back from input_tokens to OpenAI prompt_tokens', async () => {
    mockOpenAiStream([
      sse({ choices: [], usage: { prompt_tokens: 321 } }),
      'data: [DONE]\n\n',
    ]);

    const result = await new LLMClient(defaultConfig).streamLayered([], []);

    expect(result.cacheStats.inputTokens).toBe(321);
  });

  it.each([
    ['OpenAI cached tokens', { prompt_tokens_details: { cached_tokens: 120 } }, 120],
    [
      'nested gateway cached tokens',
      { billing_usage: { openai_usage: { prompt_tokens_details: { cached_tokens: 110 } } } },
      110,
    ],
    ['Kimi cached tokens', { cached_tokens: 90 }, 90],
  ])('falls back to %s', async (_label, usage, expected) => {
    mockOpenAiStream([
      sse({ choices: [], usage }),
      'data: [DONE]\n\n',
    ]);

    const result = await new LLMClient(defaultConfig).streamLayered([], []);

    expect(result.cacheStats.hitTokens).toBe(expected);
  });

  it('streams text from content deltas and stops at DONE', async () => {
    mockOpenAiStream([
      sse({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }),
      sse({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
      sse({ choices: [{ delta: { content: ' ignored' }, finish_reason: null }] }),
    ]);

    const client = new LLMClient(defaultConfig);
    await expect(client.streamInvoke('prompt', 'system')).resolves.toBe('Hello world');
    expect(bodyFromFetchCall()).toMatchObject({
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'prompt' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('keeps deprecated layered invocation methods compatible', async () => {
    mockOpenAiStream([
      sse({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] }),
      'data: [DONE]\n\n',
    ]);
    const client = new LLMClient(defaultConfig);

    await expect(client.streamInvokeLayered('system', ['static', 'dynamic'])).resolves.toBe('ok');
    expect(bodyFromFetchCall().messages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: 'static\n\n----------------------------------------\n\ndynamic',
      },
    ]);

    mockOpenAiStream([
      sse({ choices: [{ delta: { content: 'cached' }, finish_reason: null }] }),
      sse({
        choices: [],
        usage: { cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
      }),
      'data: [DONE]\n\n',
    ]);
    await expect(client.streamInvokeLayeredAnthropic('system', ['user'])).resolves.toEqual({
      content: 'cached',
      cacheStats: { readTokens: 20, creationTokens: 10 },
    });

    mockOpenAiJson('fallback');
    await expect(client.invokeLayered('system', ['static', 'dynamic'])).resolves.toBe('fallback');
    expect(bodyFromFetchCall(2).messages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: 'static\n\n----------------------------------------\n\ndynamic',
      },
    ]);
  });

  it('constructs LlmClientService from AppConfigService', () => {
    const service = new LlmClientService({
      llm: {
        provider: 'custom',
        baseUrl: defaultConfig.baseUrl,
        apiKey: defaultConfig.apiKey,
        model: defaultConfig.model,
        fallbackModel: defaultConfig.fallbackModel,
        timeout: defaultConfig.timeout,
        maxRetries: defaultConfig.maxRetries,
        enablePromptCaching: defaultConfig.enablePromptCaching,
      },
    } as AppConfigService);

    expect(service).toBeDefined();
  });

  it('reports OpenAI Chat Completions errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const client = new LLMClient(defaultConfig);
    await expect(client.invoke('test')).rejects.toThrow(
      'OpenAI Chat Completions API 401: Unauthorized',
    );
  });
});
