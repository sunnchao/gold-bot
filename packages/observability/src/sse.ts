export function eventStreamHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  };
}

export function formatSseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
