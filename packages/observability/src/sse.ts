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

export type SseEvent = {
  event_id: string;
  event_type: string;
  account_id?: string;
  source: string;
  timestamp: string;
  payload: unknown;
};

export type SseSubscriber<T> = (event: T) => void;

export class SseHub<T = SseEvent> {
  private readonly subscribers = new Set<SseSubscriber<T>>();

  subscribe(subscriber: SseSubscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(event: T): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }
}

export function createSseHub<T = SseEvent>(): SseHub<T> {
  return new SseHub<T>();
}
