import { describe, expect, it, vi } from 'vitest';
import { SchedulerService } from './scheduler.service.js';
import type { AppConfigService } from '../config/app-config.service.js';
import type { GoldbotApiService } from '../tools/goldbot-api.js';

describe('SchedulerService', () => {
  it('registers the configured repeatable cron job on init', async () => {
    const analysisQueue = {
      getRepeatableJobs: vi.fn().mockResolvedValue([{ key: 'old-repeat' }]),
      removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const positionPollQueue = {
      getRepeatableJobs: vi.fn().mockResolvedValue([{ key: 'old-poll-repeat' }]),
      removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      scheduleCron: '*/5 * * * *',
      staticAccounts: [{ id: 'acc-001', symbols: ['XAUUSD'] }],
      updateAccountSymbols: vi.fn(),
    } as AppConfigService;
    const goldbotApi = {
      fetchAccountSymbols: vi.fn().mockResolvedValue({ symbols: ['XAUUSD', 'US100Cash'] }),
    } as unknown as GoldbotApiService;
    const service = new SchedulerService(
      analysisQueue as never,
      positionPollQueue as never,
      config,
      goldbotApi,
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(goldbotApi.fetchAccountSymbols).toHaveBeenCalledWith('acc-001');
    expect(config.updateAccountSymbols).toHaveBeenCalledWith('acc-001', ['XAUUSD', 'US100Cash']);
    expect(analysisQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-repeat');
    expect(analysisQueue.add).toHaveBeenCalledWith(
      'scheduled-analysis',
      {},
      expect.objectContaining({
        repeat: { pattern: '*/5 * * * *' },
      }),
    );
    expect(positionPollQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-poll-repeat');
    expect(positionPollQueue.add).toHaveBeenCalledWith(
      'position-poll',
      {},
      expect.objectContaining({
        repeat: { every: 15 * 60 * 1000 },
      }),
    );
    expect(service.getStatus().running).toBe(true);
    expect(service.getStatus().lastRunTime).toEqual(expect.any(String));
  });

  it('falls back to static symbols when goldbot returns no symbols', async () => {
    const analysisQueue = createQueueMock();
    const positionPollQueue = createQueueMock();
    const config = {
      scheduleCron: '*/5 * * * *',
      staticAccounts: [{ id: 'acc-001', symbols: ['XAUUSD', 'GBPJPY'] }],
      updateAccountSymbols: vi.fn(),
    } as unknown as AppConfigService;
    const goldbotApi = {
      fetchAccountSymbols: vi.fn().mockResolvedValue({ symbols: [] }),
    } as unknown as GoldbotApiService;
    const service = new SchedulerService(
      analysisQueue as never,
      positionPollQueue as never,
      config,
      goldbotApi,
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(config.updateAccountSymbols).toHaveBeenCalledWith('acc-001', ['XAUUSD', 'GBPJPY']);
  });

  it('falls back to static symbols when goldbot fetch fails', async () => {
    const analysisQueue = createQueueMock();
    const positionPollQueue = createQueueMock();
    const config = {
      scheduleCron: '*/5 * * * *',
      staticAccounts: [{ id: 'acc-001', symbols: ['XAUUSD', 'GBPJPY'] }],
      updateAccountSymbols: vi.fn(),
    } as unknown as AppConfigService;
    const goldbotApi = {
      fetchAccountSymbols: vi.fn().mockRejectedValue(new Error('goldbot unavailable')),
    } as unknown as GoldbotApiService;
    const service = new SchedulerService(
      analysisQueue as never,
      positionPollQueue as never,
      config,
      goldbotApi,
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(config.updateAccountSymbols).toHaveBeenCalledWith('acc-001', ['XAUUSD', 'GBPJPY']);
  });
});

function createQueueMock() {
  return {
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
  };
}
