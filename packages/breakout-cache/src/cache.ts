import Ioredis from 'ioredis';

export type BreakoutRecord = {
  bb_level: number;
  trigger_time: string;
};

export interface BreakoutCache {
  set(symbol: string, side: string, bbLevel: number): Promise<void>;
  get(symbol: string, side: string): Promise<{ bbLevel: number } | null>;
  del(symbol: string, side: string): Promise<void>;
}

type RedisLike = {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...rest: unknown[]): Promise<string>;
  del(key: string): Promise<number>;
  quit(): Promise<string>;
};

type RedisCtor = (options: { url: string }) => RedisLike;

const TTL_SECONDS = 60 * 60;

function normalizePart(value: string): string {
  return encodeURIComponent(value.trim().toUpperCase());
}

export function breakoutKey(symbol: string, side: string): string {
  return `breakout_confirm:${normalizePart(symbol)}:${normalizePart(side)}`;
}

export type RedisBreakoutCacheOptions = {
  url: string;
  redisCtor?: RedisCtor;
  now?: () => Date;
  log?: (message: string) => void;
  pingTimeoutMs?: number;
};

const defaultRedisCtor: RedisCtor = (opts) => {
  const Ctor = Ioredis as unknown as new (url: string) => RedisLike;
  return new Ctor(opts.url);
};

export class RedisBreakoutCache implements BreakoutCache {
  private readonly client: RedisLike;
  private readonly now: () => Date;

  constructor(options: RedisBreakoutCacheOptions) {
    const RedisCtor = options.redisCtor ?? defaultRedisCtor;
    this.client = RedisCtor({ url: options.url });
    this.now = options.now ?? (() => new Date());
  }

  static async create(options: RedisBreakoutCacheOptions): Promise<RedisBreakoutCache | null> {
    const url = options.url?.trim();
    if (!url) return null;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      options.log?.(`[STRATEGY] Redis breakout cache disabled: invalid REDIS_URL`);
      return null;
    }
    if (parsedUrl.protocol !== 'redis:' && parsedUrl.protocol !== 'rediss:') {
      options.log?.(`[STRATEGY] Redis breakout cache disabled: invalid REDIS_URL`);
      return null;
    }

    const cache = new RedisBreakoutCache(options);
    const pingTimeoutMs = options.pingTimeoutMs ?? 500;
    try {
      await Promise.race([
        cache.client.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('ping timeout')), pingTimeoutMs)
        )
      ]);
    } catch (err) {
      await cache.client.quit().catch(() => {});
      options.log?.(`[STRATEGY] Redis breakout cache disabled: ping failed: ${String(err)}`);
      return null;
    }
    return cache;
  }

  async set(symbol: string, side: string, bbLevel: number): Promise<void> {
    const record: BreakoutRecord = {
      bb_level: bbLevel,
      trigger_time: this.now().toISOString()
    };
    await this.client.set(breakoutKey(symbol, side), JSON.stringify(record), 'EX', TTL_SECONDS);
  }

  async get(symbol: string, side: string): Promise<{ bbLevel: number } | null> {
    const data = await this.client.get(breakoutKey(symbol, side));
    if (data === null) return null;
    let rec: BreakoutRecord;
    try {
      rec = JSON.parse(data) as BreakoutRecord;
    } catch {
      return null;
    }
    return { bbLevel: rec.bb_level };
  }

  async del(symbol: string, side: string): Promise<void> {
    await this.client.del(breakoutKey(symbol, side));
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => {});
  }
}

export type InMemoryBreakoutCacheOptions = {
  now?: () => Date;
  ttlMs?: number;
};

export class InMemoryBreakoutCache implements BreakoutCache {
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly store = new Map<string, { bbLevel: number; expiresAt: number }>();

  constructor(options: InMemoryBreakoutCacheOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? TTL_SECONDS * 1_000;
  }

  async set(symbol: string, side: string, bbLevel: number): Promise<void> {
    this.store.set(breakoutKey(symbol, side), {
      bbLevel,
      expiresAt: this.now().getTime() + this.ttlMs
    });  }

  async get(symbol: string, side: string): Promise<{ bbLevel: number } | null> {
    const entry = this.store.get(breakoutKey(symbol, side));
    if (!entry) return null;
    if (this.now().getTime() >= entry.expiresAt) {
      this.store.delete(breakoutKey(symbol, side));
      return null;
    }
    return { bbLevel: entry.bbLevel };
  }

  async del(symbol: string, side: string): Promise<void> {
    this.store.delete(breakoutKey(symbol, side));
  }
}

export const BREAKOUT_CACHE_TTL_SECONDS = TTL_SECONDS;
