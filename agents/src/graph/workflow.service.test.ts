import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service.js';
import { WorkflowNodesService } from './workflow-nodes.service.js';

describe('WorkflowService', () => {
  it('runs the compiled workflow for a single symbol and appends duration', async () => {
    const nodes = {
      fetchData: vi.fn().mockResolvedValue({
        payload: {
          market_status: { market_open: false },
        },
        logs: [],
      }),
      dispatchAnalysis: vi.fn().mockResolvedValue({}),
      comprehensiveAnalysis: vi.fn(),
      composeSignal: vi.fn(),
      publishResult: vi.fn(),
      skipNode: vi.fn().mockResolvedValue({ logs: [] }),
      errorNode: vi.fn(),
    } as unknown as WorkflowNodesService;
    const service = new WorkflowService(nodes);

    const result = await service.run('acc-001', 'XAUUSD');

    expect(result.accountId).toBe('acc-001');
    expect(result.symbol).toBe('XAUUSD');
    expect(result.symbols).toEqual(['XAUUSD']);
    expect(result.duration).toEqual(expect.any(Number));
    expect(nodes.fetchData).toHaveBeenCalled();
    expect(nodes.skipNode).toHaveBeenCalled();
  });

  it('runs the compiled workflow for multiple symbols in one invocation', async () => {
    const nodes = {
      fetchData: vi.fn().mockResolvedValue({
        payloads: {
          XAUUSD: { market_status: { market_open: false } },
          XAGUSD: { market_status: { market_open: false } },
        },
        logs: [],
      }),
      dispatchAnalysis: vi.fn().mockResolvedValue({}),
      comprehensiveAnalysis: vi.fn(),
      composeSignal: vi.fn(),
      publishResult: vi.fn(),
      skipNode: vi.fn().mockResolvedValue({ logs: [] }),
      errorNode: vi.fn(),
    } as unknown as WorkflowNodesService;
    const service = new WorkflowService(nodes);

    const result = await service.run('acc-001', ['XAUUSD', 'XAGUSD']);

    expect(result.accountId).toBe('acc-001');
    expect(result.symbol).toBe('XAUUSD');
    expect(result.symbols).toEqual(['XAUUSD', 'XAGUSD']);
    expect(result.duration).toEqual(expect.any(Number));
    expect(nodes.fetchData).toHaveBeenCalled();
    expect(nodes.skipNode).toHaveBeenCalled();
  });
});
