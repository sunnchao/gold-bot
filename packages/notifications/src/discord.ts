export type DiscordPayload = Record<string, unknown>;

export type DiscordNotifierOptions = {
  webhookUrl: string;
  cooldownMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
};

export const DEFAULT_DISCORD_COOLDOWN_MS = 15 * 60 * 1_000;

export class DiscordNotifier {
  private readonly webhookUrl: string;
  private readonly cooldownMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private lastSentMs = 0;

  constructor(options: DiscordNotifierOptions) {
    this.webhookUrl = options.webhookUrl;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_DISCORD_COOLDOWN_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  isConfigured(): boolean {
    return this.webhookUrl.trim() !== '';
  }

  async send(payload: DiscordPayload): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }
    const nowMs = this.now().getTime();
    if (this.lastSentMs > 0 && nowMs - this.lastSentMs < this.cooldownMs) {
      return false;
    }
    this.lastSentMs = nowMs;

    void this.fire(payload).catch((err) => {
      this.log(`[DISCORD] send notification failed: ${String(err)}`);
    });
    return true;
  }

  private async fire(payload: DiscordPayload): Promise<void> {
    let body: string;
    try {
      body = JSON.stringify(payload);
    } catch (err) {
      this.log(`[DISCORD] marshal payload failed: ${String(err)}`);
      return;
    }
    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (response.status !== 200 && response.status !== 204) {
      this.log(`[DISCORD] webhook status: ${response.status}`);
    }
  }
}
