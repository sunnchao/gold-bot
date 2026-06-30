import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module.js';
import { ChanlunAnalystService } from './chanlun-analyst.js';
import { ComprehensiveAnalystService } from './comprehensive-analyst.js';
import { MaoArbitratorService } from './mao-arbitrator.js';
import { PublisherService } from './publisher.js';
import { RiskManagerService } from './risk-manager.js';
import { SrAnalystService } from './sr-analyst.js';
import { TechnicalAnalystService } from './technical-analyst.js';
import { WaveAnalystService } from './wave-analyst.js';

@Module({
  imports: [ToolsModule],
  providers: [
    ChanlunAnalystService,
    ComprehensiveAnalystService,
    TechnicalAnalystService,
    SrAnalystService,
    RiskManagerService,
    MaoArbitratorService,
    PublisherService,
    WaveAnalystService,
  ],
  exports: [
    ChanlunAnalystService,
    ComprehensiveAnalystService,
    TechnicalAnalystService,
    SrAnalystService,
    RiskManagerService,
    MaoArbitratorService,
    PublisherService,
    WaveAnalystService,
  ],
})
export class AgentsModule {}
