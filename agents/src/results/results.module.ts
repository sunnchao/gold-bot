import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module.js';
import { ResultsController } from './results.controller.js';

@Module({
  imports: [StoreModule],
  controllers: [ResultsController],
})
export class ResultsModule {}
