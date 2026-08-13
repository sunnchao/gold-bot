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

  it('serializes all populated theory and trade recommendation sections into the Feishu card', async () => {
    process.env.FEISHU_WEBHOOK_URL = 'https://feishu.example/webhook';
    delete process.env.FEISHU_WEBHOOK_SECRET;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PublisherService(createGoldbotApi());

    await service.sendFeishuCard('acc-001', 'XAUUSD', createSignalWithSections());

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBeTypeOf('string');
    const body = JSON.parse(request!.body as string) as unknown;
    const serializedCard = JSON.stringify(body);

    expect(serializedCard).toContain('道氏理论分析');
    expect(serializedCard).toContain('波浪理论分析');
    expect(serializedCard).toContain('缠论分析');
    expect(serializedCard).toContain('谐波理论分析');
    expect(serializedCard).toContain('交易建议');
    expect(serializedCard).not.toContain('参考入场: 0.00');
    expect(serializedCard).not.toContain('参考止损: 0.00');
    expect(serializedCard).not.toContain('参考止盈1: 0.00');
    expect(serializedCard).not.toContain('盈亏比: 1:0.0');
    expect(serializedCard).not.toContain('阶段: 吸筹');
    expect(serializedCard).toContain('暂无可靠入场价');
    expect(serializedCard).toContain('暂无可靠止损');
    expect(serializedCard).toContain('暂无可靠止盈');
    expect(serializedCard).toContain('盈亏比不可用');
  });

  it('keeps populated hold and open trade recommendations unchanged', async () => {
    process.env.FEISHU_WEBHOOK_URL = 'https://feishu.example/webhook';
    delete process.env.FEISHU_WEBHOOK_SECRET;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => jsonResponse({ code: 0, msg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PublisherService(createGoldbotApi());

    await service.sendFeishuCard('acc-001', 'XAUUSD', createSignalWithTradeRecommendation({
      direction: 'hold',
      entry_price: 3200,
      stop_loss: 3180,
      take_profit_1: 3240,
      risk_reward_ratio: 2,
      position_size_lots: '0.1',
      rationale: '等待确认',
    }));
    await service.sendFeishuCard('acc-001', 'XAUUSD', createSignalWithTradeRecommendation({
      direction: 'buy',
      entry_price: 3200,
      stop_loss: 3180,
      take_profit_1: 3240,
      risk_reward_ratio: 2,
      position_size_lots: '0.1',
      rationale: '趋势延续',
    }));

    const holdBody = JSON.stringify(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string));
    const openBody = JSON.stringify(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string));

    expect(holdBody).toContain('交易建议');
    expect(holdBody).toContain('参考入场: 3200.00');
    expect(holdBody).toContain('参考止损: 3180.00');
    expect(holdBody).toContain('参考止盈1: 3240.00');
    expect(holdBody).toContain('盈亏比: 1:2.0');
    expect(openBody).toContain('交易操作建议');
    expect(openBody).toContain('入场: 3200.00');
    expect(openBody).toContain('止损: 3180.00');
    expect(openBody).toContain('止盈1: 3240.00');
    expect(openBody).toContain('盈亏比: 1:2.0');
  });

  it('maps available Dow theory accumulation to 吸筹', async () => {
    process.env.FEISHU_WEBHOOK_URL = 'https://feishu.example/webhook';
    delete process.env.FEISHU_WEBHOOK_SECRET;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => jsonResponse({ code: 0, msg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PublisherService(createGoldbotApi());

    await service.sendFeishuCard('acc-001', 'XAUUSD', {
      ...createSignal(),
      dow_theory: {
        primary_trend: 'neutral',
        primary_phase: 'accumulation',
        secondary_trend: 'neutral',
        short_term_trend: 'neutral',
        multi_tf_confirm: false,
        rationale: 'available',
      },
    });

    const body = JSON.stringify(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string));
    expect(body).toContain('阶段: 吸筹');
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

function createSignalWithSections(): AISignalResult {
  return {
    ...createSignal(),
    dow_theory: {
      primary_trend: 'neutral',
      primary_phase: 'accumulation',
      secondary_trend: 'neutral',
      short_term_trend: 'neutral',
      multi_tf_confirm: false,
      rationale: 'unavailable',
    },
    wave_theory: {
      current_wave: 'unknown',
      wave_direction: 'unclear',
      wave_count: 'unavailable',
      next_target: 'N/A',
      confidence: 0,
      rationale: 'unavailable',
    },
    chanlun_theory: {
      trend: 'range',
      bi_direction: 'none',
      duan_direction: 'none',
      zhongshu_state: 'none',
      buy_sell_point: 'none',
      confidence: 0,
      rationale: 'unavailable',
    },
    harmonic_theory: {
      pattern: 'none',
      direction: 'neutral',
      confidence: 0,
      rationale: 'unavailable',
    },
    trade_recommendation: {
      direction: 'hold',
      entry_price: 0,
      stop_loss: 0,
      take_profit_1: 0,
      risk_reward_ratio: 0,
      position_size_lots: '0',
      rationale: '观望',
    },
  };
}

function createSignalWithTradeRecommendation(
  tradeRecommendation: NonNullable<AISignalResult['trade_recommendation']>,
): AISignalResult {
  return {
    ...createSignal(),
    trade_recommendation: tradeRecommendation,
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
