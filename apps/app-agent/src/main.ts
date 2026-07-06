import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { PinoLoggerService } from './utils/logger.service.js';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(PinoLoggerService);
  const config = app.get(AppConfigService);

  app.useLogger(logger);
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.instance.info({ port: config.port }, `Gold Analysis Agent listening on port ${config.port}`);
  logger.instance.info({ accounts: config.accounts.length }, 'Registered accounts');
  logger.instance.info(
    { cron: config.scheduleCron, model: config.llm.model },
    'Configuration',
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
