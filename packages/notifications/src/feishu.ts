import { createHmac } from 'node:crypto';

export type FeishuCardOptions = {
  title: string;
  content: string;
  template?: string;
};

export type FeishuNotifierOptions = {
  webhookUrl: string;
  secret?: string;
  cooldownMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
};

export const DEFAULT_FEISHU_COOLDOWN_MS = 10 * 60 * 1_000;

export function signFeishuPayload(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  const mac = createHmac('sha256', stringToSign);
  return mac.digest('base64');
}

export class FeishuNotifier {
  private readonly webhookUrl: string;
  private readonly secret: string;
  private readonly cooldownMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private lastSentMs = 0;

  constructor(options: FeishuNotifierOptions) {
    this.webhookUrl = options.webhookUrl;
    this.secret = options.secret ?? '';
    this.cooldownMs = options.cooldownMs ?? DEFAULT_FEISHU_COOLDOWN_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  isConfigured(): boolean {
    return this.webhookUrl.trim() !== '';
  }

  async send(card: FeishuCardOptions): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }
    const nowMs = this.now().getTime();
    if (this.lastSentMs > 0 && nowMs - this.lastSentMs < this.cooldownMs) {
      return false;
    }
    this.lastSentMs = nowMs;

    const timestamp = Math.floor(this.now().getTime() / 1000);
    const payload: Record<string, unknown> = {
      timestamp,
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: card.title },
          template: card.template ?? 'blue'
        },
        elements: [{ tag: 'markdown', content: card.content }]
      }
    };
    if (this.secret !== '') {
      payload.sign = signFeishuPayload(timestamp, this.secret);
    }

    void this.fire(payload).catch((err) => {
      this.log(`[FEISHU] send notification failed: ${String(err)}`);
    });
    return true;
  }

  private async fire(payload: Record<string, unknown>): Promise<void> {
    let body: string;
    try {
      body = JSON.stringify(payload);
    } catch (err) {
      this.log(`[FEISHU] marshal payload failed: ${String(err)}`);
      return;
    }
    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (response.status !== 200) {
      this.log(`[FEISHU] webhook status: ${response.status}`);
    }
  }
}
