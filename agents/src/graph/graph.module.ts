import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { StoreModule } from '../store/store.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { WorkflowNodesService } from './workflow-nodes.service.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [AgentsModule, ToolsModule, StoreModule],
  providers: [WorkflowNodesService, WorkflowService],
  exports: [WorkflowService, WorkflowNodesService],
})
export class GraphModule {}
