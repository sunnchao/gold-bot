import { describe, expect, it, vi } from 'vitest';
import { TriggerController } from './trigger.controller.js';
import type { WorkflowService } from '../graph/workflow.service.js';

describe('TriggerController', () => {
  const barSource = {
    accountSymbols: vi.fn().mockResolvedValue(['XAUUSD', 'GBPJPY', 'XAGUSD']),
  } as any;

  it('triggers workflow when no auth is configured', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, barSource);
    const result = await controller.triggerAnalysis('acc-001', 'XAUUSD', '', undefined);
    expect(workflow.run).toHaveBeenCalledWith('acc-001', ['XAUUSD'], { forceAnalyze: false });
    expect(result.triggered).toBe(true);
  });

  it('rejects requests with invalid symbol', async () => {
    const workflow = { run: vi.fn() } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, barSource);
    await expect(
      controller.triggerAnalysis('acc-001', 'INVALID!', ''),
    ).rejects.toThrow('not allowed');
    expect(workflow.run).not.toHaveBeenCalled();
  });

  it('rejects requests with wrong API token', async () => {
    const workflow = { run: vi.fn() } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, barSource, 'my-secret');
    await expect(
      controller.triggerAnalysis('acc-001', 'XAUUSD', 'wrong-token'),
    ).rejects.toThrow('Invalid');
  });

  it('accepts requests with correct API token', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, barSource, 'my-secret');
    const result = await controller.triggerAnalysis('acc-002', 'GBPJPY', 'my-secret');
    expect(result.triggered).toBe(true);
  });

  it('respects idempotency window', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const controller = new TriggerController(workflow, barSource);
    const r1 = await controller.triggerAnalysis('acc-003', 'XAGUSD', '');
    expect(r1.triggered).toBe(true);
    expect(workflow.run).toHaveBeenCalledTimes(1);

    const r2 = await controller.triggerAnalysis('acc-003', 'XAGUSD', '');
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('recently_triggered');
    expect(workflow.run).toHaveBeenCalledTimes(1);
  });

  it('rejects an allowed symbol that is not loaded by the account', async () => {
    const workflow = { run: vi.fn() } as unknown as WorkflowService;
    const accountAwareBarSource = {
      accountSymbols: vi.fn().mockResolvedValue(['GOLDm#']),
    } as any;
    const controller = new TriggerController(workflow, accountAwareBarSource);

    await expect(controller.triggerAnalysis('81124211', 'XAUUSD', '')).rejects.toMatchObject({
      response: { error: 'symbol_not_loaded' },
      status: 400,
    });
    expect(workflow.run).not.toHaveBeenCalled();
  });

  it('matches loaded account symbols case-insensitively and runs with the account contract name', async () => {
    const workflow = { run: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowService;
    const accountAwareBarSource = {
      accountSymbols: vi.fn().mockResolvedValue(['GOLDm#']),
    } as any;
    const controller = new TriggerController(workflow, accountAwareBarSource);

    const result = await controller.triggerAnalysis('81124211', ' goldm# ', '');

    expect(workflow.run).toHaveBeenCalledWith('81124211', ['GOLDm#'], { forceAnalyze: false });
    expect(result).toMatchObject({
      triggered: true,
      account: '81124211',
      symbol: 'GOLDm#',
    });
  });
});
