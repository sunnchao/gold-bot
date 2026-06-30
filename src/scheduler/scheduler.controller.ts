import { Controller, Get, Inject } from '@nestjs/common';
import { APP_START_TIME } from '../constants.js';
import { SchedulerService } from './scheduler.service.js';

@Controller()
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    @Inject(APP_START_TIME) private readonly startTime: number,
  ) {}

  @Get('/api/status')
  getStatus() {
    return {
      scheduler: this.scheduler.getStatus(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
