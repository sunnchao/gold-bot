import type { EaRecord } from '@gold-bot/persistence';

export function parseJsonObject(rawBody: string): { ok: true; body: EaRecord } | { ok: false } {
  try {
    const parsed = rawBody.trim() === '' ? {} : (JSON.parse(rawBody) as unknown);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: true, body: {} };
    }
    return { ok: true, body: parsed as EaRecord };
  } catch {
    return { ok: false };
  }
}
