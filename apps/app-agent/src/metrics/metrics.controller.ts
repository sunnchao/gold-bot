import { Controller, Get, Header } from '@nestjs/common';
import { Registry } from 'prom-client';
import { llmCacheRegistry } from './llm-cache-metrics.js';

@Controller()
export class MetricsController {
  private readonly registry: Registry = llmCacheRegistry();

  @Get('/metrics')
  @Header('Content-Type', Registry.PROMETHEUS_CONTENT_TYPE)
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
