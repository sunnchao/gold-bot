import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { createAppServer } from '../app.js';

describe('EA lifecycle normalization parity', () => {
  it('rejects register scalar type mismatches like the Go decoder', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store });

    for (const body of [
      { account_id: '90011087', broker: 123 },
      { account_id: '90011087', leverage: '500' },
      { account_id: '90011087', leverage: 500.5 }
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/register',
        body
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid JSON' });
    }
    expect(await store.getRegistration('90011087')).toBeUndefined();
  });

  it('stores Go heartbeat runtime defaults and rejects boolean type mismatches', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({
      store,
      nowUnix: () => 1772342400,
      nowIso: () => '2026-03-01T00:00:00.000Z'
    });

    const accepted = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      body: {
        account_id: '90011087',
        balance: 1000.5,
        equity: 1100.25,
        server_time: '2026.03.01 08:00:00'
      }
    });
    const rejected = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      body: {
        account_id: '90022000',
        market_open: 'true'
      }
    });

    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ status: 'OK', server_time: 1772342400 });
    expect(await store.getHeartbeat('90011087')).toMatchObject({
      connected: true,
      market_open: false,
      is_trade_allowed: false,
      balance: 1000.5,
      equity: 1100.25,
      mt4_server_time: '2026.03.01 08:00:00',
      last_heartbeat_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z'
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.parse(rejected.body)).toEqual({ status: 'ERROR', message: 'invalid JSON' });
    expect(await store.getHeartbeat('90022000')).toBeUndefined();
  });

  it('writes the Go default tick symbol into the stored snapshot and rejects numeric type mismatches', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store });

    const accepted = await server.inject({
      method: 'POST',
      url: '/tick',
      body: {
        account_id: '90011087',
        bid: 3335.55,
        ask: 3335.75
      }
    });
    const rejected = await server.inject({
      method: 'POST',
      url: '/tick',
      body: {
        account_id: '90022000',
        bid: '3335.55'
      }
    });

    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ status: 'OK' });
    expect(await store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.parse(rejected.body)).toEqual({ status: 'ERROR', message: 'invalid JSON' });
    expect(await store.getLatestTick('90022000', 'XAUUSD')).toBeUndefined();
  });
});
