import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { BarSourceService } from '../config/bar-source.service.js';
import { StoreModule } from '../store/store.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { MarketInsightCacheService } from './market-insight-cache.service.js';
import { WorkflowNodesService } from './workflow-nodes.service.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [AgentsModule, ToolsModule, StoreModule],
  providers: [BarSourceService, MarketInsightCacheService, WorkflowNodesService, WorkflowService],
  exports: [BarSourceService, MarketInsightCacheService, WorkflowService, WorkflowNodesService],
})
export class GraphModule {}
