import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { AnalysisStoreService } from '../store/analysis-store.service.js';

@Controller()
export class ResultsController {
  constructor(private readonly store: AnalysisStoreService) {}

  @Get('/api/results/:accountId/:symbol')
  getResults(
    @Param('accountId') accountId: string,
    @Param('symbol') symbol: string,
    @Query('limit') limitParam?: string,
  ) {
    const limit = limitParam === undefined ? 10 : parseInt(limitParam, 10);

    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }

    const results = this.store.getRecentResults(accountId, symbol, limit);
    return {
      accountId,
      symbol,
      count: results.length,
      results,
    };
  }
}
