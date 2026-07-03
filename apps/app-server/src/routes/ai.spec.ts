import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore, type EaStore } from '@gold-bot/persistence';
import { handleAIRoute, type AIRouteDeps, type AIRouteHelpers, type AIRouteRequest } from './ai.js';

const accountId = '90011087';
const token = 'fixture-user-token';

function routeDeps(): AIRouteDeps {
  return {
    store: createInMemoryEaStore(),
    nowIso: () => '2026-04-13T08:00:00.000Z',
    commandLifecycle: {} as AIRouteDeps['commandLifecycle'],
    shadow: {} as AIRouteDeps['shadow'],
    events: {} as AIRouteDeps['events'],
    aiApproveCooldown: {} as AIRouteDeps['aiApproveCooldown'],
    validTokens: new Set([token]),
    tokenAccounts: new Map([[token, new Set([accountId])]]),
    adminTokens: new Set()
  };
}

const helpers: AIRouteHelpers = {
  analysisPayload: (_store: EaStore, requestedAccountId: string, symbol: string) => ({
    status: 'OK',
    account_id: requestedAccountId,
    symbol
  }),
  handleAIResultRoute: () => ({
    statusCode: 200,
    body: { status: 'OK' }
  })
};

function request(overrides: Pick<AIRouteRequest, 'method' | 'path' | 'url'>): AIRouteRequest {
  return {
    ...overrides,
    headers: { 'X-API-Token': token },
    rawBody: ''
  };
}

describe('AI route analysis_payload parity', () => {
  it('allows non-GET legacy analysis payload requests like the Go handler', () => {
    const response = handleAIRoute(
      request({
        method: 'POST',
        path: `/api/analysis_payload/${accountId}`,
        url: `/api/analysis_payload/${accountId}`
      }),
      routeDeps(),
      helpers
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      account_id: accountId,
      symbol: 'XAUUSD'
    });
  });

  it('allows non-GET v2 analysis payload requests like the Go handler', () => {
    const response = handleAIRoute(
      request({
        method: 'PUT',
        path: `/api/v2/analysis_payload/${accountId}/XAUUSD`,
        url: `/api/v2/analysis_payload/${accountId}/XAUUSD`
      }),
      routeDeps(),
      helpers
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      account_id: accountId,
      symbol: 'XAUUSD'
    });
  });
});
