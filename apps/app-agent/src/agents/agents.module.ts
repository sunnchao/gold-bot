import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module.js';
import { ComprehensiveAnalystService } from './comprehensive-analyst.js';
import { MaoArbitratorService } from './mao-arbitrator.js';
import { PublisherService } from './publisher.js';
import { RiskManagerService } from './risk-manager.js';
import { SrAnalystService } from './sr-analyst.js';
import { TechnicalAnalystService } from './technical-analyst.js';

@Module({
  imports: [ToolsModule],
  providers: [
    ComprehensiveAnalystService,
    TechnicalAnalystService,
    SrAnalystService,
    RiskManagerService,
    MaoArbitratorService,
    PublisherService,
  ],
  exports: [
    ComprehensiveAnalystService,
    TechnicalAnalystService,
    SrAnalystService,
    RiskManagerService,
    MaoArbitratorService,
    PublisherService,
  ],
})
export class AgentsModule {}
