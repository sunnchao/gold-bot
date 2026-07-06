import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ANALYSIS_QUEUE, POSITION_POLL_QUEUE } from '../constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { GraphModule } from '../graph/graph.module.js';
import { StoreModule } from '../store/store.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { AnalysisProcessor } from './analysis.processor.js';
import { PositionPollProcessor } from './position-poll.processor.js';
import { SchedulerController } from './scheduler.controller.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          url: config.redisUrl,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({
      name: ANALYSIS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    }),
    BullModule.registerQueue({
      name: POSITION_POLL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    }),
    GraphModule,
    StoreModule,
    ToolsModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService, AnalysisProcessor, PositionPollProcessor],
  exports: [SchedulerService],
})
export class SchedulerModule {}
