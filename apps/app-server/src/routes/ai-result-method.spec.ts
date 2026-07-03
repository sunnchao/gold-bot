import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { createAppServer } from '../app.js';

const accountId = '90011087';
const token = 'fixture-user-token';

describe('AI result method parity', () => {
  it('accepts non-POST ai_result requests like the Go handler', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({
      store,
      validTokens: [token],
      tokenAccounts: { [token]: [accountId] },
      adminTokens: []
    });

    const response = await server.inject({
      method: 'PUT',
      url: `/api/ai_result/${accountId}`,
      headers: { 'X-API-Token': token },
      body: {
        bias: 'bullish',
        confidence: 82
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', received: true });
    expect(store.getAIResults(accountId)).toContainEqual(expect.objectContaining({
      symbol: 'XAUUSD',
      bias: 'bullish',
      confidence: 82
    }));
  });

  it('accepts non-POST v2 ai_result requests like the Go handler', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({
      store,
      validTokens: [token],
      tokenAccounts: { [token]: [accountId] },
      adminTokens: []
    });

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v2/ai_result/${accountId}/GBPJPY`,
      headers: { 'X-API-Token': token },
      body: {
        bias: 'bearish',
        confidence: 64
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', received: true });
    expect(store.getAIResults(accountId)).toContainEqual(expect.objectContaining({
      symbol: 'GBPJPY',
      bias: 'bearish',
      confidence: 64
    }));
  });
});
