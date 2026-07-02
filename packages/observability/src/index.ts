export function healthPayload(status: string): { status: string } {
  return { status };
}

export * from './sse.js';
export * from './shadow-report.js';
