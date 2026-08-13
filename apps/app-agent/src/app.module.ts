import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { GraphModule } from './graph/graph.module.js';
import { HealthModule } from './health/health.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { ResultsModule } from './results/results.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { StoreModule } from './store/store.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { TriggerModule } from './trigger/trigger.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';

@Module({
  imports: [
    ConfigModule,
    StoreModule,
    ToolsModule,
    AgentsModule,
    GraphModule,
    EvaluationModule,
    HealthModule,
    MetricsModule,
    ResultsModule,
    SchedulerModule,
    TriggerModule,
  ],
})
export class AppModule {}
