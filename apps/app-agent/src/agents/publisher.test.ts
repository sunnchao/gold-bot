import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublisherService } from './publisher.js';
import type { GoldbotApiService } from '../tools/goldbot-api.js';
import type { AISignalResult } from '../types/agent.js';

describe('PublisherService', () => {
  const originalFeishuUrl = process.env.FEISHU_WEBHOOK_URL;
  const originalFeishuSecret = process.env.FEISHU_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.FEISHU_WEBHOOK_URL = originalFeishuUrl;
    process.env.FEISHU_WEBHOOK_SECRET = originalFeishuSecret;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serializes concurrent Feishu webhook posts in this process', async () => {
    process.env.FEISHU_WEBHOOK_URL = 'https://feishu.example/webhook';
    delete process.env.FEISHU_WEBHOOK_SECRET;
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    vi.stubGlobal('fetch', fetchMock);
    const service = new PublisherService(createGoldbotApi());

    const first = service.sendFeishuCard('acc-001', 'XAUUSD', createSignal());
    const second = service.sendFeishuCard('acc-001', 'XAGUSD', createSignal());

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    firstResponse.resolve(jsonResponse({ code: 0, msg: 'ok' }));
    await expect(first).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    secondResponse.resolve(jsonResponse({ code: 0, msg: 'ok' }));
    await expect(second).resolves.toBeUndefined();
  });

  it('retries Feishu frequency-limited responses with backoff', async () => {
    vi.useFakeTimers();
    process.env.FEISHU_WEBHOOK_URL = 'https://feishu.example/webhook';
    delete process.env.FEISHU_WEBHOOK_SECRET;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 11232, msg: 'frequency limited' }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PublisherService(createGoldbotApi());

    const sent = service.sendFeishuCard('acc-001', 'XAUUSD', createSignal());

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function createGoldbotApi(): GoldbotApiService {
  return {
    postAIResult: vi.fn(),
  } as unknown as GoldbotApiService;
}

function createSignal(): AISignalResult {
  return {
    bias: 'bullish',
    confidence: 80,
    exit_suggestion: 'hold',
    risk_alert: false,
    arbitration: {
      direction: 'buy',
      action: 'buy',
      reasoning: 'test signal',
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
