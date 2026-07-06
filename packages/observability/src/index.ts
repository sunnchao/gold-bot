export function healthPayload(status: string): { status: string } {
  return { status };
}

export * from './sse.js';
export * from './shadow-report.js';
export * from './metrics.js';
export * from './metrics-middleware.js';
export * from './metrics-collector.js';
