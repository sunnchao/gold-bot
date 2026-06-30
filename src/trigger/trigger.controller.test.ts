import { describe, expect, it, vi } from 'vitest';
import { TriggerController } from './trigger.controller.js';
import type { WorkflowService } from '../graph/workflow.service.js';

describe('TriggerController', () => {
  it('triggers workflow when no auth is configured', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow);
    const result = await controller.triggerAnalysis('acc-001', 'XAUUSD', '', undefined);
    expect(workflow.run).toHaveBeenCalledWith('acc-001', ['XAUUSD'], { forceAnalyze: false });
    expect(result.triggered).toBe(true);
  });

  it('rejects requests with invalid symbol', async () => {
    const workflow = { run: vi.fn() } as unknown as WorkflowService;
    const controller = new TriggerController(workflow);
    await expect(
      controller.triggerAnalysis('acc-001', 'INVALID!', ''),
    ).rejects.toThrow('not allowed');
    expect(workflow.run).not.toHaveBeenCalled();
  });

  it('rejects requests with wrong API token', async () => {
    const workflow = { run: vi.fn() } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, 'my-secret');
    await expect(
      controller.triggerAnalysis('acc-001', 'XAUUSD', 'wrong-token'),
    ).rejects.toThrow('Invalid');
  });

  it('accepts requests with correct API token', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, 'my-secret');
    const result = await controller.triggerAnalysis('acc-002', 'GBPJPY', 'my-secret');
    expect(result.triggered).toBe(true);
  });

  it('respects idempotency window', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow);
    const r1 = await controller.triggerAnalysis('acc-003', 'XAGUSD', '');
    expect(r1.triggered).toBe(true);
    expect(workflow.run).toHaveBeenCalledTimes(1);

    const r2 = await controller.triggerAnalysis('acc-003', 'XAGUSD', '');
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('recently_triggered');
    expect(workflow.run).toHaveBeenCalledTimes(1);
  });
});
