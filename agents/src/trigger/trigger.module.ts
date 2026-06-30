import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module.js';
import { TriggerController } from './trigger.controller.js';

@Module({
  imports: [GraphModule],
  controllers: [TriggerController],
  providers: [
    {
      provide: 'GOLD_AGENT_API_TOKEN',
      useFactory: () => process.env.GOLD_AGENT_API_TOKEN || '',
    },
  ],
})
export class TriggerModule {}
