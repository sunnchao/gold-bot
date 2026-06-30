import { Module } from '@nestjs/common';
import { PinoLoggerService } from '../utils/logger.service.js';
import { AnalysisStoreService } from './analysis-store.service.js';
import { RedisService } from './redis.service.js';

@Module({
  providers: [PinoLoggerService, RedisService, AnalysisStoreService],
  exports: [PinoLoggerService, RedisService, AnalysisStoreService],
})
export class StoreModule {}
