import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [StoreModule],
  controllers: [HealthController],
})
export class HealthModule {}
