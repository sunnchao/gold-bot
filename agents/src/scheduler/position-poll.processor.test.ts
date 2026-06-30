import { describe, expect, it, vi } from 'vitest';
import { PositionPollProcessor } from './position-poll.processor.js';
import type { AppConfigService } from '../config/app-config.service.js';
import type { WorkflowService } from '../graph/workflow.service.js';
import type { AISignalResult } from '../types/agent.js';

describe('PositionPollProcessor', () => {
  it('runs workflow for every configured symbol without prefetching payload and posts non-hold results', async () => {
    const holdSignal: AISignalResult = {
      bias: 'neutral',
      confidence: 60,
      exit_suggestion: 'hold',
      risk_alert: false,
    };
    const closeSignal: AISignalResult = {
      bias: 'bearish',
      confidence: 85,
      exit_suggestion: 'close',
      risk_alert: true,
    };
    const config = {
      accounts: [
        { id: 'acc-001', symbols: ['XAUUSD', 'XAGUSD'] },
        { id: 'acc-002', symbols: ['XAUEUR'] },
      ],
    } as AppConfigService;
    const workflow = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ finalSignal: holdSignal })
        .mockResolvedValueOnce({ finalSignal: holdSignal })
        .mockResolvedValueOnce({ finalSignal: closeSignal }),
    } as unknown as WorkflowService;
    const processor = new PositionPollProcessor(config, workflow);

    const result = await processor.process({ id: 'job-1', name: 'position-poll' } as never);

    expect(workflow.run).toHaveBeenCalledTimes(3);
    expect(workflow.run).toHaveBeenNthCalledWith(1, 'acc-001', ['XAUUSD'], { skipFeishu: true });
    expect(workflow.run).toHaveBeenNthCalledWith(2, 'acc-001', ['XAGUSD'], { skipFeishu: true });
    expect(workflow.run).toHaveBeenNthCalledWith(3, 'acc-002', ['XAUEUR'], { skipFeishu: true });
    expect(result).toMatchObject({
      analyzed: 3,
      posted: 1,
      skipped: 2,
      total: 3,
    });
  });
});
