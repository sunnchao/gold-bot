import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_START_TIME } from '../constants.js';
import { APP_CONFIG, AppConfigService, validateConfig } from './app-config.service.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      validate: validateConfig,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => validateConfig(process.env),
    },
    {
      provide: APP_START_TIME,
      useValue: Date.now(),
    },
    AppConfigService,
  ],
  exports: [APP_CONFIG, APP_START_TIME, AppConfigService],
})
export class ConfigModule {}
