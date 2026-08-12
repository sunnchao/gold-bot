import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

export interface MarketInsightCacheValue<T = unknown> {
  insight: T;
  benchmarkPrice: number;
  computedAt: number;
  sourceAccount: string;
}

type CacheEntry = MarketInsightCacheValue & { expiresAt: number };

@Injectable()
export class MarketInsightCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<MarketInsightCacheValue>>();

  constructor(private readonly config: AppConfigService) {}

  get<T = unknown>(canonicalSymbol: string): MarketInsightCacheValue<T> | undefined {
    const key = this.key(canonicalSymbol);
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry as MarketInsightCacheValue<T>;
  }

  async getOrBuild<T>(
    canonicalSymbol: string,
    buildFn: () => Promise<MarketInsightCacheValue<T>>,
  ): Promise<MarketInsightCacheValue<T>> {
    const cached = this.get<T>(canonicalSymbol);
    if (cached) {
      return cached;
    }

    const key = this.key(canonicalSymbol);
    const running = this.inFlight.get(key);
    if (running) {
      return running as Promise<MarketInsightCacheValue<T>>;
    }

    const promise = buildFn()
      .then((value) => {
        this.cache.set(key, {
          ...value,
          expiresAt: Date.now() + this.config.marketInsightTtlMs,
        });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise as Promise<MarketInsightCacheValue>);
    return promise;
  }

  clear(canonicalSymbol?: string): void {
    if (canonicalSymbol) {
      this.cache.delete(this.key(canonicalSymbol));
      return;
    }
    this.cache.clear();
  }

  private key(canonicalSymbol: string): string {
    return `market:insight:${canonicalSymbol.trim().toUpperCase()}`;
  }
}
