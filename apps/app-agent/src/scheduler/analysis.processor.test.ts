import { describe, expect, it, vi } from 'vitest';
import { AnalysisProcessor } from './analysis.processor.js';
import type { AppConfigService } from '../config/app-config.service.js';
import type { WorkflowService } from '../graph/workflow.service.js';
import type { AnalysisStoreService } from '../store/analysis-store.service.js';
import type { AISignalResult } from '../types/agent.js';
import type { Queue } from 'bullmq';

describe('AnalysisProcessor', () => {
  it('runs workflow once per account with all configured symbols and saves final signals', async () => {
    const finalSignal: AISignalResult = {
      bias: 'bullish',
      confidence: 80,
      exit_suggestion: 'hold',
      risk_alert: false,
    };
    const config = {
      accounts: [
        { id: 'acc-001', symbols: ['XAUUSD', 'XAGUSD'] },
        { id: 'acc-002', symbols: ['XAUUSD'] },
      ],
    } as AppConfigService;
    const workflow = {
      run: vi.fn().mockImplementation(async (_accountId: string, symbols: string[]) => ({
        symbols,
        finalSignals: Object.fromEntries(
          symbols.map((symbol) => [symbol, finalSignal]),
        ),
        durations: Object.fromEntries(symbols.map((symbol) => [symbol, 123])),
      })),
    } as unknown as WorkflowService;
    const store = {
      saveResult: vi.fn(),
    } as unknown as AnalysisStoreService;
    const queue = {
      clean: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const processor = new AnalysisProcessor(config, workflow, store, queue);

    const result = await processor.process({ id: 'job-1', name: 'scheduled-analysis' } as never);

    expect(workflow.run).toHaveBeenCalledTimes(2);
    expect(workflow.run).toHaveBeenNthCalledWith(1, 'acc-001', ['XAUUSD', 'XAGUSD']);
    expect(workflow.run).toHaveBeenNthCalledWith(2, 'acc-002', ['XAUUSD']);
    expect(store.saveResult).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ succeeded: 3, failed: 0, saveFailed: 0, total: 3 });
  });

  it('cleans completed and failed jobs on module init', async () => {
    const config = {
      accounts: [],
    } as AppConfigService;
    const workflow = {
      run: vi.fn(),
    } as unknown as WorkflowService;
    const store = {
      saveResult: vi.fn(),
    } as unknown as AnalysisStoreService;
    const queue = {
      clean: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const processor = new AnalysisProcessor(config, workflow, store, queue);

    await processor.onModuleInit();

    expect(queue.clean).toHaveBeenCalledTimes(2);
    expect(queue.clean).toHaveBeenNthCalledWith(1, 0, 100, 'completed');
    expect(queue.clean).toHaveBeenNthCalledWith(2, 0, 50, 'failed');
  });

  it('tracks save failures in the job result instead of reporting full success', async () => {
    const finalSignal: AISignalResult = {
      bias: 'bullish',
      confidence: 80,
      exit_suggestion: 'hold',
      risk_alert: false,
    };
    const config = {
      accounts: [{ id: 'acc-001', symbols: ['XAUUSD', 'XAGUSD'] }],
    } as AppConfigService;
    const workflow = {
      run: vi.fn().mockResolvedValue({
        finalSignals: {
          XAUUSD: finalSignal,
          XAGUSD: finalSignal,
        },
        durations: {
          XAUUSD: 100,
          XAGUSD: 110,
        },
      }),
    } as unknown as WorkflowService;
    const store = {
      saveResult: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('disk full');
        })
        .mockImplementationOnce(() => undefined),
    } as unknown as AnalysisStoreService;
    const queue = {
      clean: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const processor = new AnalysisProcessor(config, workflow, store, queue);

    const result = await processor.process({ id: 'job-2', name: 'scheduled-analysis' } as never);

    expect(store.saveResult).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      succeeded: 2,
      failed: 0,
      saveFailed: 1,
      total: 2,
    });
  });
});
