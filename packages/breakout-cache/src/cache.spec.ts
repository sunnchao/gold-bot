import { describe, expect, it, vi } from 'vitest';
import {
  RedisBreakoutCache,
  InMemoryBreakoutCache,
  breakoutKey
} from './cache.js';

type RedisStub = {
  ping: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
};

function makeRedisStub(overrides: Partial<RedisStub> = {}): RedisStub & { calls: unknown[] } {
  return {
    ping: vi.fn(async () => 'PONG'),
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    quit: vi.fn(async () => 'OK'),
    ...overrides,
    calls: []
  };
}

const redisCtor = (stub: RedisStub) => () => stub as unknown as import('ioredis').default;

describe('breakoutKey', () => {
  it('uppercases and escapes symbol/side', () => {
    expect(breakoutKey('xau usd', 'buy')).toBe('breakout_confirm:XAU%20USD:BUY');
    expect(breakoutKey('XAUUSD', 'SELL')).toBe('breakout_confirm:XAUUSD:SELL');
  });
});

describe('RedisBreakoutCache', () => {
  it('create() returns null for empty url', async () => {
    expect(await RedisBreakoutCache.create({ url: '' })).toBe(null);
    expect(await RedisBreakoutCache.create({ url: '   ' })).toBe(null);
  });

  it('create() returns null for invalid url', async () => {
    const logs: string[] = [];
    expect(await RedisBreakoutCache.create({ url: 'not-a-url', log: (m) => logs.push(m) })).toBe(null);
    expect(logs.some((m) => m.includes('invalid REDIS_URL'))).toBe(true);
  });

  it('create() returns null when ping fails', async () => {
    const stub = makeRedisStub({ ping: vi.fn(async () => { throw new Error('connect refused'); }) });
    const logs: string[] = [];
    const cache = await RedisBreakoutCache.create({
      url: 'redis://localhost:6379',
      redisCtor: redisCtor(stub),
      log: (m) => logs.push(m)
    });
    expect(cache).toBe(null);
    expect(stub.quit).toHaveBeenCalledTimes(1);
    expect(logs.some((m) => m.includes('ping failed'))).toBe(true);
  });

  it('create() returns null on ping timeout', async () => {
    const stub = makeRedisStub({ ping: vi.fn(() => new Promise(() => {})) });
    const cache = await RedisBreakoutCache.create({
      url: 'redis://localhost:6379',
      redisCtor: redisCtor(stub),
      pingTimeoutMs: 50
    });
    expect(cache).toBe(null);
    expect(stub.quit).toHaveBeenCalledTimes(1);
  });

  it('set/get/del round-trip with 1h TTL', async () => {
    const stub = makeRedisStub({ get: vi.fn(async () => null) });
    const now = new Date('2026-01-01T00:00:00Z');
    const cache = await RedisBreakoutCache.create({
      url: 'redis://localhost:6379',
      redisCtor: redisCtor(stub),
      now: () => now
    });
    expect(cache).not.toBe(null);

    await cache!.set('xauusd', 'buy', 2050.5);
    expect(stub.set).toHaveBeenCalledTimes(1);
    const [key, value, ...rest] = stub.set.mock.calls[0]!;
    expect(key).toBe('breakout_confirm:XAUUSD:BUY');
    const parsed = JSON.parse(value as string) as { bb_level: number; trigger_time: string };
    expect(parsed.bb_level).toBe(2050.5);
    expect(parsed.trigger_time).toBe(now.toISOString());
    expect(rest).toEqual(['EX', 3600]);

    stub.get.mockImplementationOnce(async () => value as string);
    const got = await cache!.get('xauusd', 'buy');
    expect(got).toEqual({ bbLevel: 2050.5 });

    await cache!.del('xauusd', 'buy');
    expect(stub.del).toHaveBeenCalledTimes(1);
    expect(stub.del.mock.calls[0]![0]).toBe('breakout_confirm:XAUUSD:BUY');
  });

  it('get returns null on missing key', async () => {
    const stub = makeRedisStub({ get: vi.fn(async () => null) });
    const cache = await RedisBreakoutCache.create({
      url: 'redis://localhost:6379',
      redisCtor: redisCtor(stub)
    });
    expect(await cache!.get('xau', 'buy')).toBe(null);
  });

  it('get returns null on malformed payload', async () => {
    const stub = makeRedisStub({ get: vi.fn(async () => 'not-json{') });
    const cache = await RedisBreakoutCache.create({
      url: 'redis://localhost:6379',
      redisCtor: redisCtor(stub)
    });
    expect(await cache!.get('xau', 'buy')).toBe(null);
  });
});

describe('InMemoryBreakoutCache', () => {
  it('set/get/del round-trip', async () => {
    const cache = new InMemoryBreakoutCache();
    await cache.set('xauusd', 'sell', 1990);
    expect(await cache.get('xauusd', 'sell')).toEqual({ bbLevel: 1990 });
    await cache.del('xauusd', 'sell');
    expect(await cache.get('xauusd', 'sell')).toBe(null);
  });

  it('expires after TTL', async () => {
    let clockMs = Date.parse('2026-01-01T00:00:00Z');
    const cache = new InMemoryBreakoutCache({ now: () => new Date(clockMs), ttlMs: 1000 });
    await cache.set('xau', 'buy', 100);
    clockMs += 500;
    expect(await cache.get('xau', 'buy')).toEqual({ bbLevel: 100 });
    clockMs += 600;
    expect(await cache.get('xau', 'buy')).toBe(null);
  });

  it('normalizes key like redis variant', async () => {
    const cache = new InMemoryBreakoutCache();
    await cache.set('xauusd', 'buy', 100);
    expect(await cache.get('XAUUSD', 'BUY')).toEqual({ bbLevel: 100 });
    expect(await cache.get('xau usd', 'buy')).toBe(null);
  });
});
