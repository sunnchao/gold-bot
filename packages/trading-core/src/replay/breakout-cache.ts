// M30 Breakout Cache - Two-step Bollinger Band breakout confirmation
// Ported from Go: internal/strategy/breakoutcache/cache.go + engine.go:1899-1963

/**
 * Breakout Cache Entry
 * Stores pending H1 BB breakout waiting for M30 confirmation
 */
export type BreakoutCacheEntry = {
  bbLevel: number;
  triggerTime: number; // Unix timestamp in milliseconds
  side: 'BUY' | 'SELL';
};

/**
 * In-memory breakout cache
 * In production, this should be replaced with Redis for multi-instance support
 */
class BreakoutCache {
  private cache: Map<string, BreakoutCacheEntry>;
  private readonly ttl: number = 3600 * 1000; // 1 hour in milliseconds

  constructor() {
    this.cache = new Map();
  }

  private makeKey(symbol: string, side: 'BUY' | 'SELL'): string {
    return `${symbol.toUpperCase().trim()}:${side}`;
  }

  set(symbol: string, side: 'BUY' | 'SELL', bbLevel: number): void {
    const key = this.makeKey(symbol, side);
    this.cache.set(key, {
      bbLevel,
      triggerTime: Date.now(),
      side
    });
  }

  get(symbol: string, side: 'BUY' | 'SELL'): BreakoutCacheEntry | null {
    const key = this.makeKey(symbol, side);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.triggerTime > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  delete(symbol: string, side: 'BUY' | 'SELL'): void {
    const key = this.makeKey(symbol, side);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
let breakoutCacheInstance: BreakoutCache | null = null;

export function getBreakoutCache(): BreakoutCache {
  if (!breakoutCacheInstance) {
    breakoutCacheInstance = new BreakoutCache();
  }
  return breakoutCacheInstance;
}

export type BreakoutConfirmResult = {
  confirmed: boolean;
  signal: any | null;
  reason: string;
};

/**
 * Confirm breakout pyramid signal with M30 second-step verification
 *
 * Two-step process:
 * 1. H1 close breaks BB → cache the level
 * 2. M30 close still outside BB → confirm signal
 *
 * This reduces false breakouts by ~30%
 */
export function confirmBreakoutPyramid(
  symbol: string,
  side: 'BUY' | 'SELL',
  bbLevel: number,
  m30Bars: Array<{ close: number }>,
  signal: any,
  signalMessage: string
): BreakoutConfirmResult {
  const cache = getBreakoutCache();

  // Check if there's a pending breakout waiting for confirmation
  const pending = cache.get(symbol, side);

  if (pending) {
    // Delete the cache entry (confirmed or rejected)
    cache.delete(symbol, side);

    // Check M30 confirmation
    if (m30Bars.length === 0) {
      return {
        confirmed: true,
        signal,
        reason: `${signalMessage} | 二次确认: M30数据不足,按H1突破降级发信号`
      };
    }

    const m30Close = m30Bars[m30Bars.length - 1].close;
    const confirmed = (side === 'BUY' && m30Close > pending.bbLevel) ||
                      (side === 'SELL' && m30Close < pending.bbLevel);

    if (confirmed) {
      return {
        confirmed: true,
        signal,
        reason: `${signalMessage} | 二次确认: M30收盘价=${m30Close.toFixed(2)} 仍在BB外(阈值=${pending.bbLevel.toFixed(2)})`
      };
    }

    // False breakout detected
    return {
      confirmed: false,
      signal: null,
      reason: `假突破: ${side} M30收盘价=${m30Close.toFixed(2)} 回到BB内(阈值=${pending.bbLevel.toFixed(2)})`
    };
  }

  // No pending entry → first step: cache and wait for M30
  cache.set(symbol, side, bbLevel);

  return {
    confirmed: false,
    signal: null,
    reason: `待确认: ${side} H1收盘价突破BB阈值=${bbLevel.toFixed(2)},等待M30二次确认`
  };
}
