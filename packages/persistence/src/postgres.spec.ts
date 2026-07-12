import { beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createPostgresEaStore, type EaCommand } from './index.js';
import { numericField } from './helpers.js';

const postgresDsn = process.env.GB_TEST_POSTGRES_DSN ?? '';

const describePostgres = postgresDsn !== '' ? describe : describe.skip;

async function withStore<T>(callback: (store: Awaited<NonNullable<ReturnType<typeof createPostgresEaStore>>>) => Promise<T>): Promise<T> {
  const store = await createPostgresEaStore(postgresDsn);
  if (store === null) {
    throw new Error('createPostgresEaStore returned null for GB_TEST_POSTGRES_DSN');
  }
  try {
    return await callback(store);
  } finally {
    await store.close?.();
  }
}

async function truncateAll(): Promise<void> {
  const client = new pg.Client({ connectionString: postgresDsn });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE ea_events, ea_snapshots, position_states, runtime_commands, runtime_state, decision_events, shadow_comparisons, shadow_snapshots, tokens, token_accounts RESTART IDENTITY CASCADE'
    );
  } finally {
    await client.end();
  }
}

describePostgres('createPostgresEaStore', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns null when the DSN is unreachable', async () => {
    const store = await createPostgresEaStore('postgres://nobody:nobody@127.0.0.1:1/none');
    expect(store).toBeNull();
  });

  it('runs migrations and stores the EA lifecycle by account', async () => {
    await withStore(async (store) => {
      await store.saveRegistration({
        account_id: '90011087',
        broker: 'Demo Broker',
        ai_symbols: ['XAUUSD', 'GBPJPY']
      });
      await store.saveHeartbeat({
        account_id: '90011087',
        symbol: 'US100Cash',
        balance: 1000.5,
        equity: 1100.25,
        max_spread: 62,
        ai_symbols: ['XAUUSD']
      });
      await store.saveTick({
        account_id: '90011087',
        symbol: 'XAUUSD',
        bid: 3335.5,
        ask: 3335.8
      });
      await store.saveBars({
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: [{ time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 }]
      });
      await store.savePositions({
        account_id: '90011087',
        positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
      });
      await store.saveOrderResult({
        account_id: '90011087',
        command_id: 'sig_1',
        result: 'filled',
        ticket: 1001
      });

      expect(await store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
      expect(await store.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25, max_spread: 62 });
      expect(await store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.8 });
      const bars = await store.getBars('90011087', 'XAUUSD', 'H1');
      expect(bars).toHaveLength(1);
      expect(bars[0]).toMatchObject({
        time: '2026.04.13 07:00',
        open: 3331.25,
        high: 3337.1,
        low: 3330.9,
        close: 3335.75
      });
      expect(bars[0]).not.toHaveProperty('bars');
      expect(bars[0]).not.toHaveProperty('account_id');
      expect(await store.getPositions('90011087')).toHaveLength(1);
      expect(await store.getOrderResults('90011087')).toEqual([
        {
          account_id: '90011087',
          command_id: 'sig_1',
          result: 'filled',
          ticket: 1001
        }
      ]);
    });
  });

  it('returns the inner bars array, not the snapshot wrapper', async () => {
    await withStore(async (store) => {
      await store.saveBars({
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: [
          { time: '2026.04.13 07:00', open: 3331.25, high: 3337.1, low: 3330.9, close: 3335.75 },
          { time: '2026.04.13 08:00', open: 3335.75, high: 3340.0, low: 3334.5, close: 3338.25 },
          { time: '2026.04.13 09:00', open: 3338.25, high: 3342.5, low: 3337.0, close: 3341.0 }
        ]
      });

      const bars = await store.getBars('90011087', 'XAUUSD', 'H1');
      expect(bars).toHaveLength(3);
      expect(bars.map((bar) => bar.time)).toEqual([
        '2026.04.13 07:00',
        '2026.04.13 08:00',
        '2026.04.13 09:00'
      ]);
      expect(bars.every((bar) => !('bars' in bar) && !('account_id' in bar))).toBe(true);
      expect(await store.getBars('90011087', 'XAUUSD', 'M15')).toEqual([]);
    });
  });

  it('isolates position snapshots by account and symbol', async () => {
    await withStore(async (store) => {
      await store.savePositions({
        account_id: '90011087',
        symbol: 'XAUUSD',
        positions: [{ ticket: 1001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 }]
      });
      await store.savePositions({
        account_id: '90011087',
        symbol: 'GBPJPY',
        positions: [{ ticket: 2002, symbol: 'GBPJPY', type: 'SELL', lots: 0.2 }]
      });

      expect((await store.getPositions('90011087', 'XAUUSD')).map((position) => position.ticket)).toEqual([1001]);
      expect((await store.getPositions('90011087', 'GBPJPY')).map((position) => position.ticket)).toEqual([2002]);
      expect((await store.getPositions('90011087')).map((position) => position.ticket).sort()).toEqual([1001, 2002]);
    });
  });

  it('stores symbol-scoped position manager states', async () => {
    await withStore(async (store) => {
      await store.savePositionState('90011087', 'XAUUSD', {
        ticket: 1001,
        tp1_hit: true,
        tp2_hit: false,
        max_profit_atr: 1.6,
        be_moved: true,
        be_trigger_atr: 1.5,
        best_sl: 0,
        open_time: '2026-04-13T06:00:00.000Z',
        last_modify_time: '2026-04-13T08:00:00.000Z'
      });
      await store.savePositionState('90011087', 'XAUUSD', {
        ticket: 1002,
        tp1_hit: false,
        tp2_hit: false,
        max_profit_atr: 0.2,
        be_moved: false,
        be_trigger_atr: 1.5,
        best_sl: 0,
        open_time: '2026-04-13T07:00:00.000Z',
        last_modify_time: '2026-04-13T07:00:00.000Z'
      });

      expect((await store.loadPositionStates('90011087', 'XAUUSD')).map((state) => state.ticket)).toEqual([1001, 1002]);
      await store.deleteStalePositionStates('90011087', 'XAUUSD', [1001]);
      expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([
        {
          ticket: 1001,
          tp1_hit: true,
          tp2_hit: false,
          max_profit_atr: 1.6,
          be_moved: true,
          be_trigger_atr: 1.5,
          best_sl: 0,
          open_time: '2026-04-13T06:00:00.000Z',
          last_modify_time: '2026-04-13T08:00:00.000Z'
        }
      ]);
      await store.deleteStalePositionStates('90011087', 'XAUUSD', []);
      expect(await store.loadPositionStates('90011087', 'XAUUSD')).toEqual([]);
    });
  });

  it('round-trips queued runtime commands and reconciles results', async () => {
    await withStore(async (store) => {
      const candidate: EaCommand = {
        command_id: 'cmd_roundtrip',
        action: 'open_buy',
        symbol: 'XAUUSD',
        volume: 0.1,
        source: 'ea_analysis'
      };
      await store.enqueueCommand('90011087', candidate);

      const queued = await store.getCommand('cmd_roundtrip');
      expect(queued?.status).toBe('queued');
      expect(queued?.command_id).toBe('cmd_roundtrip');

      const list = await store.listCommands('90011087');
      expect(list.map((command) => command.command_id)).toContain('cmd_roundtrip');

      const delivered = await store.pollCommands('90011087');
      expect(delivered.map((command) => command.command_id)).toContain('cmd_roundtrip');

      const acked = await store.reconcileCommandResult('90011087', 'cmd_roundtrip', 'OK', 4242, '');
      expect(acked).toBe(true);

      const reconciled = await store.getCommand('cmd_roundtrip');
      expect(reconciled?.status).toBe('acked');
      expect(reconciled?.ticket).toBe(4242);

      const stale = await store.reconcileCommandResult('90011087', 'does_not_exist', 'OK', 1, '');
      expect(stale).toBe(false);
    });
  });

  it('manages pending signals by id and expiry', async () => {
    await withStore(async (store) => {
      await store.savePendingSignal({
        account_id: '90011087',
        symbol: 'XAUUSD',
        side: 'BUY',
        status: 'pending',
        strategy: 'breakout',
        created_at: '2026-04-13T08:00:00.000Z',
        expires_at: '2026-04-13T08:30:00.000Z'
      });

      const signals = await store.getPendingSignals('90011087', 'XAUUSD');
      expect(signals).toHaveLength(1);
      const firstId = numericField(signals[0], 'id');
      expect(firstId).toBeGreaterThan(0);

      const fetched = await store.getPendingSignalById('90011087', 'XAUUSD', firstId);
      expect(numericField(fetched ?? {}, 'id')).toBe(firstId);

      const arbitrated = await store.updatePendingSignalArbitration(firstId, 'approved', 'matched');
      expect(arbitrated).toBe(true);
      const stale = await store.updatePendingSignalArbitration(999999, 'approved', 'matched');
      expect(stale).toBe(false);

      const remaining = await store.expirePendingSignals('2026-04-13T09:00:00.000Z');
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);
    });
  });

  it('stores and revokes api tokens', async () => {
    await withStore(async (store) => {
      await store.saveApiToken({
        token: 'tok_postgres_1',
        name: 'ci',
        accounts: ['90011087'],
        is_admin: false
      });

      const listed = await store.listApiTokens();
      expect(listed.map((token) => token.token)).toContain('tok_postgres_1');
      const loaded = listed.find((token) => token.token === 'tok_postgres_1')!;
      expect(loaded.name).toBe('ci');
      expect(loaded.accounts).toEqual(['90011087']);

      const revoked = await store.deleteApiToken('tok_postgres_1');
      expect(revoked).toBe(true);

      const again = await store.deleteApiToken('tok_postgres_1');
      expect(again).toBe(false);

      expect(await store.listApiTokens()).toEqual([]);
    });
  });
});
