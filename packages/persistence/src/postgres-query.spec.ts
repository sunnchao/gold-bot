import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryCall = {
  text: string;
  values: unknown[];
};

const fakePg = vi.hoisted(() => {
  const queryCalls: QueryCall[] = [];

  class FakePool {
    async connect(): Promise<{ query: (text: string, values?: unknown[]) => Promise<unknown>; release: () => void }> {
      return {
        query: (text: string, values: unknown[] = []) => this.query(text, values),
        release: () => undefined
      };
    }

    async query(text: string, values: unknown[] = []): Promise<unknown> {
      queryCalls.push({ text, values });
      if (text.includes('FROM decision_events')) {
        return {
          rows: [
            {
              id: '7',
              decision_id: 'decision_7',
              account_id: '90011087',
              symbol: 'XAUUSD',
              stage: 'risk_gate',
              status: 'rejected',
              reason_codes_json: '["risk.spread.wide"]',
              summary_json: '{"max_lots":0}',
              related_command_id: 'cmd_7',
              created_at: '2026-04-13T08:01:00.000Z'
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }

    async end(): Promise<void> {
      return undefined;
    }
  }

  return { FakePool, queryCalls };
});

vi.mock('pg', () => ({
  default: {
    Pool: fakePg.FakePool
  }
}));

vi.mock('./migrate.js', () => ({
  runMigrationsPostgres: vi.fn(async () => undefined)
}));

describe('createPostgresEaStore query generation', () => {
  beforeEach(() => {
    fakePg.queryCalls.length = 0;
  });

  it('places decision-event LIMIT after ORDER BY instead of inside WHERE filters', async () => {
    const { createPostgresEaStore } = await import('./postgres.js');
    const store = await createPostgresEaStore('postgres://goldbot:test@localhost/goldbot');

    expect(store).not.toBeNull();
    await store!.listDecisionEvents({
      account_id: '90011087',
      symbol: 'XAUUSD',
      status: 'rejected',
      limit: 1
    });
    await store!.close?.();

    const decisionQuery = fakePg.queryCalls.find((call) => call.text.includes('FROM decision_events'));
    expect(decisionQuery?.text).toContain('WHERE account_id = $1 AND symbol = $2 AND status = $3 ORDER BY created_at DESC, id DESC LIMIT $4');
    expect(decisionQuery?.text).not.toContain('AND LIMIT');
    expect(decisionQuery?.values).toEqual(['90011087', 'XAUUSD', 'rejected', 1]);
  });
});
