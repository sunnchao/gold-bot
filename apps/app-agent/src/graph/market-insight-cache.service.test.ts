import { describe, expect, it, vi } from 'vitest';
import { MarketInsightCacheService } from './market-insight-cache.service.js';
import type { AppConfigService } from '../config/app-config.service.js';

describe('MarketInsightCacheService', () => {
  it('reuses a cached insight until TTL expiry', async () => {
    vi.useFakeTimers();
    const service = new MarketInsightCacheService({
      marketInsightTtlMs: 1000,
    } as AppConfigService);
    const build = vi.fn().mockResolvedValue({
      insight: { trend_bias: 'bullish' },
      benchmarkPrice: 100,
      computedAt: Date.now(),
      sourceAccount: '90011087',
    });

    await service.getOrBuild('XAUUSD', build);
    await service.getOrBuild('xauusd', build);
    expect(build).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    await service.getOrBuild('XAUUSD', build);
    expect(build).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('single-flights concurrent builders for the same key', async () => {
    let resolveBuild: ((value: any) => void) | undefined;
    const buildPromise = new Promise((resolve) => {
      resolveBuild = resolve;
    });
    const service = new MarketInsightCacheService({
      marketInsightTtlMs: 600000,
    } as AppConfigService);
    const build = vi.fn().mockReturnValue(buildPromise);

    const first = service.getOrBuild('XAUUSD', build);
    const second = service.getOrBuild('XAUUSD', build);
    expect(build).toHaveBeenCalledTimes(1);

    resolveBuild?.({
      insight: { trend_bias: 'neutral' },
      benchmarkPrice: 100,
      computedAt: Date.now(),
      sourceAccount: '90011087',
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
