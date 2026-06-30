import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';
import { PinoLoggerService } from '../utils/logger.service.js';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: Redis;

  constructor(
    config: AppConfigService,
    logger: PinoLoggerService,
  ) {
    const redisUrl = config.redisUrl;
    const log = logger.instance;

    this.client = new Redis(redisUrl, {
      retryStrategy(times: number): number | null {
        if (times > 10) {
          log.error('Redis: max reconnect attempts reached, giving up');
          return null;
        }
        const delay = Math.min(times * 500, 5000);
        log.warn({ attempt: times, delayMs: delay }, 'Redis: reconnecting...');
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('connect', () => {
      log.info({ url: redisUrl }, 'Redis: connected');
    });
    this.client.on('ready', () => {
      log.info('Redis: ready');
    });
    this.client.on('error', (err: Error) => {
      log.error({ err }, 'Redis: connection error');
    });
    this.client.on('close', () => {
      log.warn('Redis: connection closed');
    });
    this.client.on('reconnecting', (delayMs: number) => {
      log.info({ delayMs }, 'Redis: reconnecting');
    });
  }

  get connection(): Redis {
    return this.client;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
