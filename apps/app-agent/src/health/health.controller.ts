import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_START_TIME } from '../constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { RedisService } from '../store/redis.service.js';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  redis: boolean;
  goldbot: boolean;
  timestamp: string;
}

@Controller()
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @Inject(APP_START_TIME) private readonly startTime: number,
  ) {}

  @Get('/health')
  async getHealth(): Promise<HealthResponse> {
    const [redisConnected, goldbotReachable] = await Promise.all([
      this.checkRedis(),
      this.checkGoldbot(),
    ]);
    const body: HealthResponse = {
      status: redisConnected ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      redis: redisConnected,
      goldbot: goldbotReachable,
      timestamp: new Date().toISOString(),
    };

    if (!redisConnected) {
      throw new ServiceUnavailableException(body);
    }

    return body;
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private async checkGoldbot(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${this.config.goldbot.apiUrl}/health`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.goldbot.apiToken}`,
        },
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }
}
