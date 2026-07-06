import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { FeishuNotifier, signFeishuPayload } from './feishu.js';

function makeResponse(status = 200) {
  return { status } as Response;
}

function expectedSign(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac('sha256', stringToSign).digest('base64');
}

describe('signFeishuPayload', () => {
  it('matches Go HMAC-SHA256 over "timestamp\\nsecret"', () => {
    const timestamp = 1_735_688_600;
    const secret = 'my-secret';
    expect(signFeishuPayload(timestamp, secret)).toBe(expectedSign(timestamp, secret));
  });
});

describe('FeishuNotifier', () => {
  it('returns false when webhook URL is empty', async () => {
    const notifier = new FeishuNotifier({ webhookUrl: '' });
    expect(await notifier.send({ title: 't', content: 'c' })).toBe(false);
  });

  it('sends interactive card with sign when secret is set', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200));
    const now = new Date('2026-01-01T00:00:00Z');
    const notifier = new FeishuNotifier({
      webhookUrl: 'https://feishu.test/hook',
      secret: 'shh',
      fetchImpl,
      now: () => now
    });

    const sent = await notifier.send({ title: 'Alert', content: 'price up' });

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://feishu.test/hook');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.msg_type).toBe('interactive');
    const timestamp = body.timestamp as number;
    expect(body.sign).toBe(expectedSign(timestamp, 'shh'));
    const card = body.card as { header: { title: { content: string }; template: string }; elements: Array<{ tag: string; content: string }> };
    expect(card.header.title.content).toBe('Alert');
    expect(card.header.template).toBe('blue');
    expect(card.elements[0]!.tag).toBe('markdown');
    expect(card.elements[0]!.content).toBe('price up');
  });

  it('omits sign when secret is empty', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200));
    const now = new Date('2026-01-01T00:00:00Z');
    const notifier = new FeishuNotifier({
      webhookUrl: 'https://feishu.test/hook',
      fetchImpl,
      now: () => now
    });

    await notifier.send({ title: 't', content: 'c' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBe(Math.floor(now.getTime() / 1000));
  });

  it('suppressed within cooldown window', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200));
    let clockMs = Date.parse('2026-01-01T00:00:00Z');
    const notifier = new FeishuNotifier({
      webhookUrl: 'https://feishu.test/hook',
      cooldownMs: 10 * 60 * 1_000,
      fetchImpl,
      now: () => new Date(clockMs)
    });

    expect(await notifier.send({ title: 't', content: 'a' })).toBe(true);
    clockMs += 5 * 60 * 1_000;
    expect(await notifier.send({ title: 't', content: 'b' })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('logs on non-200 status', async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => makeResponse(400));
    const now = new Date('2026-01-01T00:00:00Z');
    const notifier = new FeishuNotifier({
      webhookUrl: 'https://feishu.test/hook',
      fetchImpl,
      now: () => now,
      log: (m) => logs.push(m)
    });

    expect(await notifier.send({ title: 't', content: 'c' })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(logs.some((m) => m.includes('webhook status: 400'))).toBe(true);
  });
});
