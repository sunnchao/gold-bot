import { Module } from '@nestjs/common';
import { ReplayEvaluationService } from './replay-runner.js';

@Module({
  providers: [ReplayEvaluationService],
  exports: [ReplayEvaluationService],
})
export class EvaluationModule {}
