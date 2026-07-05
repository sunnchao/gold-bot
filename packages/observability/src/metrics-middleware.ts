import type { MetricsRegistry } from './metrics.js';
import { httpStatusClass } from './metrics.js';

export type HttpMiddlewareOptions = {
  metrics: MetricsRegistry;
  now?: () => number;
  pathNormalizer?: (method: string, url: string) => string;
};

export type HttpMiddlewareContext = {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
};

export function normalizeHttpPath(method: string, url: string): string {
  const path = new URL(url, 'http://localhost').pathname;
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return '/';
  }
  const normalized: string[] = [];
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      normalized.push(':id');
    } else {
      normalized.push(segment);
    }
  }
  return '/' + normalized.join('/');
}

export function createHttpMetricsMiddleware(options: HttpMiddlewareOptions) {
  const metrics = options.metrics;
  const now = options.now ?? (() => Date.now());
  const normalizer = options.pathNormalizer ?? normalizeHttpPath;

  function record(context: HttpMiddlewareContext): void {
    const path = normalizer(context.method, context.url);
    const status = httpStatusClass(context.statusCode);
    metrics.httpRequestsTotal.labels(context.method, path, status).inc();
    metrics.httpRequestDuration.labels(context.method, path).observe(context.durationMs / 1000);
  }

  return { record };
}
