import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ResultsController } from './results.controller.js';
import type { AnalysisStoreService } from '../store/analysis-store.service.js';

describe('ResultsController', () => {
  it('returns recent results with a valid limit', () => {
    const rows = [{ id: 1, account_id: 'acc-001', symbol: 'XAUUSD' }];
    const store = {
      getRecentResults: vi.fn().mockReturnValue(rows),
    } as unknown as AnalysisStoreService;
    const controller = new ResultsController(store);

    const result = controller.getResults('acc-001', 'XAUUSD', '5');

    expect(store.getRecentResults).toHaveBeenCalledWith('acc-001', 'XAUUSD', 5);
    expect(result).toEqual({
      accountId: 'acc-001',
      symbol: 'XAUUSD',
      count: 1,
      results: rows,
    });
  });

  it('uses default limit 10 when omitted', () => {
    const store = {
      getRecentResults: vi.fn().mockReturnValue([]),
    } as unknown as AnalysisStoreService;
    const controller = new ResultsController(store);

    controller.getResults('acc-001', 'XAUUSD');

    expect(store.getRecentResults).toHaveBeenCalledWith('acc-001', 'XAUUSD', 10);
  });

  it('throws BadRequestException for invalid limits', () => {
    const store = {
      getRecentResults: vi.fn(),
    } as unknown as AnalysisStoreService;
    const controller = new ResultsController(store);

    expect(() => controller.getResults('acc-001', 'XAUUSD', '101')).toThrow(BadRequestException);
    expect(() => controller.getResults('acc-001', 'XAUUSD', '0')).toThrow(BadRequestException);
    expect(() => controller.getResults('acc-001', 'XAUUSD', 'abc')).toThrow(BadRequestException);
  });
});
