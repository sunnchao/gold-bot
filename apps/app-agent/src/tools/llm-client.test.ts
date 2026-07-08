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
    baseUrl: 'https://gateway.example/v1',
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

  function mockAnthropicJson(content = 'Hello world') {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: 'text', text: content }],
        }),
    });
  }

  function mockAnthropicStream(events: string[]) {
    const encoder = new TextEncoder();
    const mockStream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
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

  it('sends non-streaming requests to the Anthropic Messages endpoint', async () => {
    mockAnthropicJson('Hello world');

    const client = new LLMClient(defaultConfig);
    const result = await client.invoke('Say hello', 'You are terse');

    expect(result).toBe('Hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/messages');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-key',
      'anthropic-version': '2023-06-01',
    });
    expect(bodyFromFetchCall()).toMatchObject({
      model: 'gpt-4o',
      max_tokens: 8192,
      temperature: 0.1,
      system: 'You are terse',
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    expect(bodyFromFetchCall().stream).toBeUndefined();
  });

  it('detects cache strategy from model name rather than provider name', () => {
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
    const kimi = new LLMClient({
      ...defaultConfig,
      model: 'moonshot-v1-128k',
    });
    const glm = new LLMClient({
      ...defaultConfig,
      model: 'glm-4.5',
    });
    const minimax = new LLMClient({
      ...defaultConfig,
      model: 'abab6.5s-chat',
    });
    const disabled = new LLMClient({
      ...defaultConfig,
      model: 'claude-sonnet-4',
      enablePromptCaching: false,
    });

    expect(claudeViaGateway.getCacheStrategy()).toEqual({ type: 'anthropic_explicit', ttl: '1h' });
    expect(deepseekViaAnthropicProvider.getCacheStrategy()).toEqual({ type: 'auto_prefix' });
    expect(kimi.getCacheStrategy()).toEqual({ type: 'prompt_cache_key' });
    expect(glm.getCacheStrategy()).toEqual({ type: 'auto_prefix_unstable' });
    expect(minimax.getCacheStrategy()).toEqual({ type: 'none' });
    expect(disabled.getCacheStrategy()).toEqual({ type: 'none' });
  });

  it('builds Claude layered requests with 1h cache_control on cacheable layers only', async () => {
    mockAnthropicStream([
      'event: content_block_delta\ndata: {"delta":{"text":"ok"}}\n\n',
      'event: message_delta\ndata: {"usage":{"cache_read_input_tokens":200,"cache_creation_input_tokens":100}}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'claude-opus-4-8',
    });
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
      },
    });

    const body = bodyFromFetchCall();
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'common rules',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
      {
        type: 'text',
        text: 'symbol rules',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ]);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'computed structures',
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
      },
      {
        role: 'user',
        content: 'live market data',
      },
    ]);
    expect(body.stream).toBe(true);
  });

  it('keeps automatic-prefix providers free of explicit cache fields while preserving layer order', async () => {
    mockAnthropicJson('ok');

    const client = new LLMClient({
      ...defaultConfig,
      model: 'deepseek-v4-pro',
    });
    await client.invokeLayered(
      [
        { text: 'common rules', cacheable: true },
        { text: 'symbol rules', cacheable: true },
      ],
      [
        { text: 'computed structures', cacheable: true },
        { text: 'live market data', cacheable: false },
      ],
    );

    const body = bodyFromFetchCall();
    expect(body.system).toBe('common rules\n\nsymbol rules');
    expect(body.messages).toEqual([
      { role: 'user', content: 'computed structures' },
      { role: 'user', content: 'live market data' },
    ]);
    expect(JSON.stringify(body)).not.toContain('cache_control');
    expect(body.prompt_cache_key).toBeUndefined();
  });

  it('adds prompt_cache_key only for Kimi/Moonshot strategy', async () => {
    mockAnthropicJson('ok');

    const client = new LLMClient({
      ...defaultConfig,
      model: 'kimi-k2',
    });
    await client.invokeLayered([{ text: 'system', cacheable: true }], [{ text: 'user', cacheable: true }]);

    const body = bodyFromFetchCall();
    expect(body.prompt_cache_key).toBe('gold-analysis');
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('extracts DeepSeek, OpenAI, and Kimi cache stats from streaming usage chunks', async () => {
    mockAnthropicStream([
      'event: content_block_delta\ndata: {"delta":{"text":"cached"}}\n\n',
      'event: message_delta\ndata: {"usage":{"prompt_cache_hit_tokens":300,"prompt_cache_miss_tokens":50,"prompt_tokens_details":{"cached_tokens":120},"cached_tokens":90}}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'deepseek-v4-pro',
    });
    const result = await client.streamLayered([{ text: 'system', cacheable: true }], [{ text: 'user', cacheable: true }]);

    expect(result.content).toBe('cached');
    expect(result.cacheStats).toEqual({
      readTokens: 0,
      creationTokens: 0,
      hitTokens: 300,
      missTokens: 50,
    });
  });

  it('parses tool_use from Anthropic stream', async () => {
    mockAnthropicStream([
      'event: message_start\ndata: {"message":{"usage":{"input_tokens":100,"cache_read_input_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"place_pending_order"}}\n\n',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"side\\":\\"buy\\",\\"entry_price\\":4145"}}\n\n',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":",\\"stop_loss\\":4125}"}}\n\n',
      'event: content_block_stop\ndata: {"index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'claude-opus-4-8',
    });
    const result = await client.streamLayered(
      [{ text: 'sys', cacheable: true }],
      [{ text: 'user', cacheable: true }],
      { tools: TRADE_ACTION_TOOLS, toolChoice: { type: 'any' } },
    );

    expect(bodyFromFetchCall().tools).toEqual(TRADE_ACTION_TOOLS);
    expect(bodyFromFetchCall().tool_choice).toEqual({ type: 'any' });
    expect(result.toolUse).toEqual({
      id: 'toolu_01',
      name: 'place_pending_order',
      input: { side: 'buy', entry_price: 4145, stop_loss: 4125 },
    });
  });

  it('falls back to OpenAI cached_tokens when DeepSeek hit tokens are absent', async () => {
    mockAnthropicStream([
      'event: content_block_delta\ndata: {"delta":{"text":"cached"}}\n\n',
      'event: message_delta\ndata: {"usage":{"prompt_tokens_details":{"cached_tokens":120}}}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'gpt-4o',
    });
    const result = await client.streamLayered([{ text: 'system', cacheable: true }], [{ text: 'user', cacheable: true }]);

    expect(result.cacheStats.hitTokens).toBe(120);
  });

  it('falls back to Kimi cached_tokens when other cached token fields are absent', async () => {
    mockAnthropicStream([
      'event: content_block_delta\ndata: {"delta":{"text":"cached"}}\n\n',
      'event: message_delta\ndata: {"usage":{"cached_tokens":90}}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'kimi-k2',
    });
    const result = await client.streamLayered([{ text: 'system', cacheable: true }], [{ text: 'user', cacheable: true }]);

    expect(result.cacheStats.hitTokens).toBe(90);
  });

  it('keeps deprecated string layered methods compatible', async () => {
    mockAnthropicStream([
      'event: content_block_delta\ndata: {"delta":{"text":"ok"}}\n\n',
    ]);

    const client = new LLMClient({
      ...defaultConfig,
      model: 'gpt-4o',
    });
    const result = await client.streamInvokeLayered('system', ['static', 'dynamic']);

    expect(result).toBe('ok');
    expect(bodyFromFetchCall().system).toBe('system');
    expect(bodyFromFetchCall().messages).toEqual([
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

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const client = new LLMClient(defaultConfig);
    await expect(client.invoke('test')).rejects.toThrow('401');
  });
});
