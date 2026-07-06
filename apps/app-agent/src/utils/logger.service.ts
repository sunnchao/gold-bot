import { Injectable, LoggerService as NestLoggerService, OnApplicationShutdown } from '@nestjs/common';
import pino from 'pino';
import { AppConfigService } from '../config/app-config.service.js';

@Injectable()
export class PinoLoggerService implements NestLoggerService, OnApplicationShutdown {
  private readonly logger: pino.Logger;

  constructor(config: AppConfigService) {
    const isProd = process.env.NODE_ENV === 'production';
    this.logger = isProd
      ? pino({ level: config.logLevel })
      : pino({
          level: config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        });
  }

  get instance(): pino.Logger {
    return this.logger;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ optionalParams }, String(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ optionalParams }, String(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ optionalParams }, String(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ optionalParams }, String(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ optionalParams }, String(message));
  }

  onApplicationShutdown(): void {
    this.logger.flush();
  }
}
