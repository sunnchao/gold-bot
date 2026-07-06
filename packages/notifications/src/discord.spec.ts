import { describe, expect, it, vi } from 'vitest';
import { DiscordNotifier } from './discord.js';

function makeResponse(status = 204) {
  return { status } as Response;
}

describe('DiscordNotifier', () => {
  it('returns false when webhook URL is empty', async () => {
    const notifier = new DiscordNotifier({ webhookUrl: '' });
    expect(await notifier.send({ content: 'x' })).toBe(false);
  });

  it('sends payload as JSON POST', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(204));
    const now = new Date('2026-01-01T00:00:00Z');
    const notifier = new DiscordNotifier({
      webhookUrl: 'https://discord.test/hook',
      fetchImpl,
      now: () => now
    });

    const sent = await notifier.send({ content: 'hello' });

    expect(sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://discord.test/hook');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe(JSON.stringify({ content: 'hello' }));
  });

  it('suppressed within cooldown window', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(204));
    let clockMs = Date.parse('2026-01-01T00:00:00Z');
    const notifier = new DiscordNotifier({
      webhookUrl: 'https://discord.test/hook',
      cooldownMs: 15 * 60 * 1_000,
      fetchImpl,
      now: () => new Date(clockMs)
    });

    expect(await notifier.send({ content: 'a' })).toBe(true);
    clockMs += 5 * 60 * 1_000;
    expect(await notifier.send({ content: 'b' })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends again after cooldown expires', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(204));
    let clockMs = Date.parse('2026-01-01T00:00:00Z');
    const notifier = new DiscordNotifier({
      webhookUrl: 'https://discord.test/hook',
      cooldownMs: 15 * 60 * 1_000,
      fetchImpl,
      now: () => new Date(clockMs)
    });

    expect(await notifier.send({ content: 'a' })).toBe(true);
    clockMs += 15 * 60 * 1_000 + 1;
    expect(await notifier.send({ content: 'b' })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('logs on non-2xx status but does not reject the caller', async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => makeResponse(500));
    const now = new Date('2026-01-01T00:00:00Z');
    const notifier = new DiscordNotifier({
      webhookUrl: 'https://discord.test/hook',
      fetchImpl,
      now: () => now,
      log: (m) => logs.push(m)
    });

    expect(await notifier.send({ content: 'x' })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(logs.some((m) => m.includes('webhook status: 500'))).toBe(true);
  });
});
