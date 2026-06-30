import { Module } from '@nestjs/common';
import { GoldbotApiService } from './goldbot-api.js';
import { LlmClientService } from './llm-client.js';

@Module({
  providers: [GoldbotApiService, LlmClientService],
  exports: [GoldbotApiService, LlmClientService],
})
export class ToolsModule {}
