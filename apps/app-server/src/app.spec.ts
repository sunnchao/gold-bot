import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryEaStore, createSqliteEaStore, type EaCommand } from '@gold-bot/persistence';
import { createAppServer, type AppServerOptions } from './app.js';
import { authorizeRouteAccount, extractRouteToken } from './middleware/auth.js';

const fixtureRoot = join(import.meta.dirname, '../../../tests/fixtures/earoutes');
const adminFixtureRoot = join(import.meta.dirname, '../../../tests/fixtures/admin');
const replayFixtureRoot = join(import.meta.dirname, '../../../tests/replay/testdata');
const fixtureAccountId = '90011087';
const fixtureUserToken = 'fixture-user-token';
const fixtureAdminToken = 'fixture-admin-token';
const apiUserHeaders = { 'X-API-Token': fixtureUserToken };
const apiAdminHeaders = { 'X-API-Token': fixtureAdminToken };

function createApiServer(options: AppServerOptions = {}) {
  return createAppServer({
    ...options,
    validTokens: options.validTokens ?? [fixtureUserToken, fixtureAdminToken],
    tokenAccounts: options.tokenAccounts ?? { [fixtureUserToken]: [fixtureAccountId] },
    adminTokens: options.adminTokens ?? [fixtureAdminToken]
  });
}

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixtureRoot, `${name}.json`), 'utf8')) as {
    request?: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
    response?: { body?: unknown };
  };
}

function readAdminFixture(name: string) {
  return JSON.parse(readFileSync(join(adminFixtureRoot, `${name}.json`), 'utf8')) as {
    request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
    response: { body?: unknown; body_ref?: string };
  };
}

function readAdminStreamFixture(name: string) {
  return JSON.parse(readFileSync(join(adminFixtureRoot, `${name}.json`), 'utf8')) as {
    request: { method: string; path: string; headers?: Record<string, string> };
    response: { frames: string[] };
  };
}

function readReplayFixture(name: string) {
  return JSON.parse(readFileSync(join(replayFixtureRoot, name), 'utf8')) as {
    account_id: string;
    analysis_time?: string;
    current_price: number;
    bars: Record<string, unknown[]>;
    positions?: unknown[];
  };
}

function flatBars(count: number, close: number) {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026.04.13 ${String(index).padStart(2, '0')}:00`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index
  }));
}

function atrExpansionBars(historyCount: number) {
  return [
    ...Array.from({ length: historyCount }, (_, index) => ({
      time: `2026.04.13 ${String(index).padStart(2, '0')}:00`,
      open: 3300 + index,
      high: 3301 + index,
      low: 3299 + index,
      close: 3300 + index
    })),
    {
      time: `2026.04.13 ${String(historyCount).padStart(2, '0')}:00`,
      open: 3300 + historyCount,
      high: 3360 + historyCount,
      low: 3300,
      close: 3340
    }
  ];
}

describe('app-server scaffold', () => {
  describe('route auth helpers', () => {
    it('prefers X-API-Token over X-API-Key and query token', () => {
      expect(
        extractRouteToken(
          { 'x-api-token': 'primary', 'x-api-key': 'secondary' },
          '/heartbeat?token=query-token'
        )
      ).toBe('primary');
    });

    it('binds the first account for a token with no stored account set', () => {
      const tokenAccounts = new Map<string, Set<string>>([['token-a', new Set()]]);

      expect(authorizeRouteAccount(tokenAccounts, 'token-a', '90011087', new Set())).toBe(true);
      expect(tokenAccounts.get('token-a')).toEqual(new Set(['90011087']));
    });

    it('rejects account access when token binding does not match account id', () => {
      expect(
        authorizeRouteAccount(
          new Map([['token-a', new Set(['90011087'])]]),
          'token-a',
          '90022000',
          new Set()
        )
      ).toBe(false);
    });
  });

  it('returns Go-compatible health payload', async () => {
    const server = createAppServer();
    const response = await server.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
  });

  it('serves public EA release version metadata', async () => {
    const server = createApiServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/ea/version'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      version: '2.8.3',
      build: 9,
      changelog:
        'AI信号挂单: 新增 ai_signal 策略支持(Magic=20250238)，修复未知策略拒绝问题；兼容 tp/tp1 字段名；AI信号使用服务端计算手数(含减半逻辑)；所有品种MaxSpread=80避免挂单被点差拦截；SQLite方言移除，仅支持PostgreSQL'
    });
  });

  it('rejects EA version_check without a route token', async () => {
    const server = createApiServer();

    const response = await server.inject({
      method: 'POST',
      url: '/version_check'
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('serves token-protected EA version_check payload', async () => {
    const server = createApiServer();

    const response = await server.inject({
      method: 'POST',
      url: '/version_check',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      latest_version: '2.8.3',
      latest_build: 9,
      force_update: false
    });
  });

  it('rejects EA download without a route token', async () => {
    const server = createApiServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/ea/download'
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('serves token-protected EA download as an attachment', async () => {
    const server = createApiServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/ea/download',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="GoldBolt_Client.mq4"');
    expect(response.body).toContain('GoldBolt_Client.mq4');
    expect(response.body).toContain('#property strict');
  });

  it('returns Go-shaped 404 when the EA download file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-bot-ea-download-'));
    try {
      const server = createApiServer({ releaseRoot: dir });

      const response = await server.inject({
        method: 'GET',
        url: '/api/ea/download',
        headers: apiUserHeaders
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'file not found' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores and polls indicator alerts with duplicate suppression', async () => {
    const server = createApiServer({ nowUnix: () => 1772342400 });
    const alert = {
      id: 'alert_1',
      type: 'divergence',
      indicator: 'RSI',
      direction: 'bullish',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      time: '2026-04-13T08:00:00.000Z',
      price: 3335.75,
      strength: 'strong',
      confidence: 0.82,
      description: 'RSI bullish divergence',
      rsi_divergence: 'bullish'
    };

    const first = await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: alert
    });
    const duplicate = await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: alert
    });
    const poll = await server.inject({
      method: 'POST',
      url: '/indicator_alert/poll',
      headers: apiUserHeaders,
      body: { account_id: 'ignored-by-go' }
    });

    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ status: 'ok', should_send: true });
    expect(duplicate.statusCode).toBe(200);
    expect(JSON.parse(duplicate.body)).toEqual({ status: 'ok', should_send: false });
    expect(poll.statusCode).toBe(200);
    expect(JSON.parse(poll.body)).toEqual({ status: 'ok', count: 1, alerts: [alert] });
  });

  it('rejects invalid indicator alert requests', async () => {
    const server = createApiServer();

    const method = await server.inject({
      method: 'GET',
      url: '/indicator_alert/store',
      headers: apiUserHeaders
    });
    const json = await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: '{bad-json'
    });
    const wrongShape = await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: {
        strength: 8
      }
    });

    expect(method.statusCode).toBe(405);
    expect(JSON.parse(method.body)).toEqual({ status: 'ERROR', message: 'method not allowed' });
    expect(json.statusCode).toBe(400);
    expect(JSON.parse(json.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
    expect(wrongShape.statusCode).toBe(400);
    expect(JSON.parse(wrongShape.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
  });

  it('serves visual poll with tick, AI trade plan, and matching alerts', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:05:00.000Z', nowUnix: () => 1772342400 });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 20,
      time: '08:00:00'
    });
    store.saveAIResult('90011087', 'XAUUSD', {
      bias: 'bullish',
      confidence: 82,
      exit_suggestion: 'hold',
      risk_alert: false,
      alert_reason: '',
      decision_id: 'tpv1_abc123',
      trade_plan: {
        mode: 'approve',
        side: 'buy',
        entry_zone: { min: 3330, max: 3334 },
        stop_loss: 3320,
        take_profit: 3360,
        risk_gate: { status: 'accepted' },
        narrative: 'trade plan narrative'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: {
        id: 'alert_xau_h1',
        type: 'divergence',
        indicator: 'RSI',
        direction: 'bullish',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        time: '2026-04-13T08:00:00.000Z',
        price: 3335.75,
        strength: 'strong',
        confidence: 0.82,
        description: 'RSI bullish divergence',
        rsi_divergence: 'bullish'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/indicator_alert/store',
      headers: apiUserHeaders,
      body: {
        id: 'alert_gbp_m15',
        type: 'divergence',
        indicator: 'RSI',
        direction: 'bearish',
        symbol: 'GBPJPY',
        timeframe: 'M15',
        time: '2026-04-13T08:00:00.000Z',
        price: 190.1,
        strength: 'medium',
        confidence: 0.6,
        description: 'GBPJPY alert'
      }
    });

    const response = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087', symbol: 'XAUUSD', timeframe: 'H1' }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'ok',
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      server_time: '2026-04-13T08:05:00.000Z',
      tick: {
        symbol: 'XAUUSD',
        bid: 3335.55,
        ask: 3335.75,
        spread: 20,
        time: '08:00:00'
      },
      ai: {
        has_result: true,
        bias: 'bullish',
        confidence: 82,
        exit_suggestion: 'hold',
        risk_alert: false,
        alert_reason: '',
        decision_id: 'tpv1_abc123',
        trade_plan_mode: 'approve',
        side: 'buy',
        entry_min: 3330,
        entry_max: 3334,
        stop_loss: 3320,
        take_profit: 3360,
        risk_gate_status: 'accepted',
        narrative: 'trade plan narrative'
      },
      alerts: [
        {
          id: 'alert_xau_h1',
          type: 'divergence',
          indicator: 'RSI',
          direction: 'bullish',
          symbol: 'XAUUSD',
          timeframe: 'H1',
          time: '2026-04-13T08:00:00.000Z',
          price: 3335.75,
          strength: 'strong',
          confidence: 0.82,
          description: 'RSI bullish divergence',
          rsi_divergence: 'bullish'
        }
      ],
      count: 1
    });
  });

  it('rejects invalid visual poll requests', async () => {
    const server = createApiServer();

    const missing = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    const forbidden = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: { account_id: '90022098', symbol: 'XAUUSD' }
    });

    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body)).toEqual({ status: 'ERROR', message: 'account_id and symbol are required' });
    expect(forbidden.statusCode).toBe(403);
    expect(JSON.parse(forbidden.body)).toEqual({ status: 'ERROR', message: 'forbidden' });
  });

  it('accepts safe EA lifecycle routes with Go-shaped responses and stores payloads', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store, nowUnix: () => 1772342400 });

    for (const name of ['register', 'heartbeat', 'tick', 'bars', 'positions', 'order_result']) {
      const fixture = readFixture(name);
      const response = await server.inject({
        method: fixture.request?.method ?? 'POST',
        url: fixture.request?.path ?? `/${name}`,
        headers: fixture.request?.headers,
        body: fixture.request?.body
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(fixture.response?.body);
    }

    expect(store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
    expect(store.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
    expect(store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.75 });
    expect(store.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
    expect(store.getPositions('90011087')).toHaveLength(1);
    expect(store.getOrderResults('90011087')).toHaveLength(1);
  });

  it('polls only explicitly queued commands and marks them delivered', async () => {
    const store = createInMemoryEaStore();
    const command: EaCommand = {
      command_id: 'sig_1',
      action: 'SIGNAL',
      strategy: 'pullback',
      symbol: 'XAUUSD',
      type: 'BUY',
      entry: 3345.5,
      sl: 3338,
      tp1: 3358,
      score: 7
    };
    const server = createAppServer({ store });
    const pollFixture = JSON.parse(readFileSync(join(fixtureRoot, 'poll.json'), 'utf8')) as {
      cases: Array<{ request: { method: string; path: string; body: unknown }; response: { body: unknown } }>;
    };

    const emptyCase = pollFixture.cases[0];
    const queuedCase = pollFixture.cases[1];

    const empty = await server.inject({
      method: emptyCase.request.method,
      url: emptyCase.request.path,
      body: emptyCase.request.body
    });
    expect(empty.statusCode).toBe(200);
    expect(JSON.parse(empty.body)).toEqual(emptyCase.response.body);

    store.enqueueCommand('90011087', command);

    const queued = await server.inject({
      method: queuedCase.request.method,
      url: queuedCase.request.path,
      body: queuedCase.request.body
    });
    expect(queued.statusCode).toBe(200);
    expect(JSON.parse(queued.body)).toEqual(queuedCase.response.body);

    const delivered = await server.inject({
      method: emptyCase.request.method,
      url: emptyCase.request.path,
      body: emptyCase.request.body
    });
    expect(JSON.parse(delivered.body)).toEqual(emptyCase.response.body);
  });

  it('rejects malformed EA requests with Go-compatible error envelopes', async () => {
    const server = createAppServer();

    const invalidJson = await server.inject({
      method: 'POST',
      url: '/register',
      body: '{'
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(JSON.parse(invalidJson.body)).toEqual({ status: 'ERROR', message: 'invalid JSON' });

    const missingAccount = await server.inject({
      method: 'POST',
      url: '/register',
      body: {}
    });
    expect(missingAccount.statusCode).toBe(400);
    expect(JSON.parse(missingAccount.body)).toEqual({ status: 'ERROR', message: 'missing account_id' });

    const blankAccount = await server.inject({
      method: 'POST',
      url: '/register',
      body: { account_id: '   ' }
    });
    expect(blankAccount.statusCode).toBe(400);
    expect(JSON.parse(blankAccount.body)).toEqual({ status: 'ERROR', message: 'missing account_id' });
  });

  it('accepts Go-compatible sparse bars and positions payloads', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store });

    const noBars = await server.inject({
      method: 'POST',
      url: '/bars',
      body: { account_id: '90011087' }
    });
    expect(noBars.statusCode).toBe(200);
    expect(JSON.parse(noBars.body)).toEqual({ status: 'OK', received: 0 });

    const noBarsWithTimeframe = await server.inject({
      method: 'POST',
      url: '/bars',
      body: { account_id: '90011087', timeframe: 'H1' }
    });
    expect(noBarsWithTimeframe.statusCode).toBe(200);
    expect(JSON.parse(noBarsWithTimeframe.body)).toEqual({ status: 'OK', received: 0 });
    expect(store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([]);

    const noPositions = await server.inject({
      method: 'POST',
      url: '/positions',
      body: { account_id: '90011087' }
    });
    expect(noPositions.statusCode).toBe(200);
    expect(JSON.parse(noPositions.body)).toEqual({ status: 'OK', count: 0 });
    expect(store.getPositions('90011087')).toEqual([]);
  });

  it('normalizes Go-compatible nested EA payloads before persistence', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store });

    const bars = await server.inject({
      method: 'POST',
      url: '/bars',
      body: {
        account_id: '90011087',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: [{ time: 1712971200, open: 3300, high: 3301, low: 3299, close: 3300.5 }]
      }
    });
    expect(bars.statusCode).toBe(200);
    expect(store.getBars('90011087', 'XAUUSD', 'H1')[0]).toMatchObject({ time: '1712971200' });

    store.saveRegistration({
      account_id: '90011087',
      strategy_mapping: {
        '20250238': 'ai_signal'
      }
    });

    const positions = await server.inject({
      method: 'POST',
      url: '/positions',
      body: {
        account_id: '90011087',
        positions: [{ ticket: 123, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 3300, magic: 20250238, strategy: '' }]
      }
    });
    expect(positions.statusCode).toBe(200);
    expect(store.getPositions('90011087')[0]).toMatchObject({ strategy: 'ai_signal' });
  });

  it('rejects nested EA payload type mismatches like the Go decoder', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store });

    const cases = [
      {
        path: '/bars',
        body: { account_id: '90011087', timeframe: 'H1', bars: [{ open: '3300' }] },
        message: 'invalid JSON',
        assertNotPersisted: () => expect(store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', positions: [{ ticket: '123' }] },
        message: 'invalid JSON',
        assertNotPersisted: () => expect(store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/register',
        body: { account_id: '90011087', strategy_mapping: { '20250231': 123 } },
        message: 'invalid JSON',
        assertNotPersisted: () => expect(store.getRegistration('90011087')).toBeUndefined()
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: 'filled', ticket: '321' },
        message: 'invalid JSON',
        assertNotPersisted: () => expect(store.getOrderResults('90011087')).toEqual([])
      }
    ];

    for (const testCase of cases) {
      const response = await server.inject({
        method: 'POST',
        url: testCase.path,
        body: testCase.body
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: testCase.message });
      testCase.assertNotPersisted();
    }
  });

  it('rejects order_result payloads missing required fields before persistence', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store });

    const cases = [
      {
        path: '/order_result',
        body: { account_id: '90011087', result: 'filled' },
        message: 'missing command_id',
        assertNotPersisted: () => expect(store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1' },
        message: 'missing result',
        assertNotPersisted: () => expect(store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: '   ', result: 'filled' },
        message: 'missing command_id',
        assertNotPersisted: () => expect(store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: '   ' },
        message: 'missing result',
        assertNotPersisted: () => expect(store.getOrderResults('90011087')).toEqual([])
      }
    ];

    for (const testCase of cases) {
      const response = await server.inject({
        method: 'POST',
        url: testCase.path,
        body: testCase.body
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: testCase.message });
      testCase.assertNotPersisted();
    }
  });

  it('returns 405 for unsupported EA route methods', async () => {
    const server = createAppServer();
    const response = await server.inject({
      method: 'GET',
      url: '/poll'
    });

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      status: 'ERROR',
      message: 'method not allowed'
    });
  });

  it('can enforce auth tokens using the Go-compatible extraction priority', async () => {
    const server = createAppServer({ validTokens: ['primary'] });

    const accepted = await server.inject({
      method: 'POST',
      url: '/poll?token=query',
      headers: {
        'X-API-Key': 'secondary',
        'X-API-Token': 'primary'
      },
      body: { account_id: '90011087' }
    });
    expect(accepted.statusCode).toBe(200);

    const rejected = await server.inject({
      method: 'POST',
      url: '/poll?token=query',
      headers: {
        'X-API-Key': 'secondary'
      },
      body: { account_id: '90011087' }
    });
    expect(rejected.statusCode).toBe(401);
    expect(JSON.parse(rejected.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('enforces Go-compatible account authorization for EA write routes', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({
      store,
      validTokens: ['user-token', 'admin-token'],
      tokenAccounts: {
        'user-token': ['90011087']
      },
      adminTokens: ['admin-token']
    });

    const allowed = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': 'user-token' },
      body: { account_id: '90011087', balance: 1000 }
    });
    expect(allowed.statusCode).toBe(200);

    const rejected = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': 'user-token' },
      body: { account_id: '90022000', balance: 2000 }
    });
    expect(rejected.statusCode).toBe(403);
    expect(JSON.parse(rejected.body)).toEqual({ status: 'ERROR', message: 'token not authorized for account' });
    expect(store.getHeartbeat('90022000')).toBeUndefined();

    const adminAllowed = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': 'admin-token' },
      body: { account_id: '90022000', balance: 2000 }
    });
    expect(adminAllowed.statusCode).toBe(200);
    expect(store.getHeartbeat('90022000')).toMatchObject({ balance: 2000 });
  });

  it('manages API tokens behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store });

    const created = await server.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: apiAdminHeaders,
      body: { name: 'Desk', accounts: ['90011087', '90022000'] }
    });

    expect(created.statusCode).toBe(200);
    const createdBody = JSON.parse(created.body) as { status: string; token: string; name: string; accounts: string[] };
    expect(createdBody.status).toBe('OK');
    expect(createdBody.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(createdBody.name).toBe('Desk');
    expect(createdBody.accounts).toEqual(['90011087', '90022000']);

    const listed = await server.inject({
      method: 'GET',
      url: '/api/tokens',
      headers: apiAdminHeaders
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = JSON.parse(listed.body) as {
      status: string;
      tokens: Record<string, { name: string; accounts: string[]; full_token: string }>;
    };
    const listedToken = Object.values(listedBody.tokens).find((token) => token.full_token === createdBody.token);
    expect(listedBody.status).toBe('OK');
    expect(listedToken).toEqual({
      name: 'Desk',
      accounts: ['90011087', '90022000'],
      full_token: createdBody.token
    });

    const allowed = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': createdBody.token },
      body: { account_id: '90022000', equity: 2000 }
    });
    expect(allowed.statusCode).toBe(200);
    expect(store.getHeartbeat('90022000')).toMatchObject({ equity: 2000 });

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/api/tokens/${createdBody.token.slice(0, 8)}`,
      headers: apiAdminHeaders
    });
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.body)).toEqual({
      status: 'OK',
      revoked: `${createdBody.token.slice(0, 4)}...${createdBody.token.slice(-4)}`
    });

    const rejected = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': createdBody.token },
      body: { account_id: '90022000', equity: 3000 }
    });
    expect(rejected.statusCode).toBe(401);
  });

  it('loads persisted API tokens from the app store on startup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-bot-token-admin-'));
    const dbPath = join(dir, 'ea.sqlite');
    try {
      const firstStore = createSqliteEaStore(dbPath);
      const firstServer = createApiServer({ store: firstStore });
      const created = await firstServer.inject({
        method: 'POST',
        url: '/api/tokens',
        headers: apiAdminHeaders,
        body: { name: 'Desk', accounts: ['90011087'] }
      });
      const token = (JSON.parse(created.body) as { token: string }).token;
      firstStore.close();

      const secondStore = createSqliteEaStore(dbPath);
      const secondServer = createApiServer({ store: secondStore });
      const allowed = await secondServer.inject({
        method: 'POST',
        url: '/heartbeat',
        headers: { 'X-API-Token': token },
        body: { account_id: '90011087', equity: 2100 }
      });
      const listed = await secondServer.inject({
        method: 'GET',
        url: '/api/tokens',
        headers: apiAdminHeaders
      });

      expect(allowed.statusCode).toBe(200);
      expect(secondStore.getHeartbeat('90011087')).toMatchObject({ equity: 2100 });
      expect(Object.values((JSON.parse(listed.body) as { tokens: Record<string, { full_token: string }> }).tokens)).toContainEqual(
        expect.objectContaining({ full_token: token })
      );
      secondStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binds a valid EA token to its first account before rejecting later accounts', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({
      store,
      validTokens: ['new-token'],
      tokenAccounts: {}
    });

    const first = await server.inject({
      method: 'POST',
      url: '/register',
      headers: { 'X-API-Token': 'new-token' },
      body: { account_id: '90011087', broker: 'Demo Broker' }
    });
    expect(first.statusCode).toBe(200);
    expect(store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });

    const second = await server.inject({
      method: 'POST',
      url: '/register',
      headers: { 'X-API-Token': 'new-token' },
      body: { account_id: '90022000', broker: 'Other Broker' }
    });
    expect(second.statusCode).toBe(403);
    expect(JSON.parse(second.body)).toEqual({ status: 'ERROR', message: 'token not authorized for account' });
    expect(store.getRegistration('90022000')).toBeUndefined();
  });

  it('rejects API routes when no Node token store is configured', async () => {
    const server = createAppServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: { 'X-API-Token': 'unknown-token' }
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('enforces Go-compatible API admin gates', async () => {
    const server = createApiServer();

    const missingToken = await server.inject({
      method: 'GET',
      url: '/api/v1/overview'
    });
    expect(missingToken.statusCode).toBe(401);
    expect(JSON.parse(missingToken.body)).toEqual({ status: 'ERROR', message: 'invalid token' });

    const userToken = await server.inject({
      method: 'GET',
      url: '/api/v1/overview',
      headers: apiUserHeaders
    });
    expect(userToken.statusCode).toBe(403);
    expect(JSON.parse(userToken.body)).toEqual({ status: 'ERROR', message: 'admin only' });
  });

  it('serves the deprecated trigger_ai endpoint behind token auth', async () => {
    const server = createApiServer();
    const expected = {
      status: 'OK',
      message: 'AI analysis is now handled by Gateway Cron tasks. This endpoint is deprecated.',
      deprecated: true
    };

    const missingToken = await server.inject({
      method: 'GET',
      url: '/api/trigger_ai'
    });
    expect(missingToken.statusCode).toBe(401);
    expect(JSON.parse(missingToken.body)).toEqual({ status: 'ERROR', message: 'invalid token' });

    for (const method of ['GET', 'POST']) {
      const response = await server.inject({
        method,
        url: '/api/trigger_ai',
        headers: apiUserHeaders
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(expected);
    }
  });

  it('serves read-only admin symbol and dashboard routes from Node snapshots', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    const pendingFixture = readAdminFixture('pending-signal');
    const pendingSignal = (pendingFixture.response.body as unknown[])[0];

    store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500,
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true,
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY' }]
    });
    store.savePendingSignal(pendingSignal);

    for (const name of ['symbols', 'ai-symbols', 'pending-signal', 'accounts', 'overview', 'audit']) {
      const fixture = readAdminFixture(name);
      const response = await server.inject({
        method: fixture.request.method,
        url: fixture.request.path,
        headers: fixture.request.headers
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(fixture.response.body);
    }
  });

  it('serves Go-compatible account detail behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500
    });
    store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 0.2,
      time: '2026-04-13T07:59:30Z'
    });
    store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 3330, profit: 5.25 }]
    });
    store.saveAIResult('90011087', 'XAUUSD', { bias: 'bullish', confidence: 82 });
    store.recordDecisionEvent({
      decision_id: 'tpv1_old',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'candidate_signal',
      status: 'pending',
      reason_codes: ['candidate.created'],
      summary: { score: 7 },
      related_command_id: '',
      created_at: '2026-04-13T07:59:00.000Z'
    });
    store.recordDecisionEvent({
      decision_id: 'tpv1_new',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'risk_gate',
      status: 'rejected',
      reason_codes: ['risk.spread.wide'],
      summary: { max_lots: 0 },
      related_command_id: 'sig_new',
      created_at: '2026-04-13T08:01:00.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/accounts/90011087',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      status: 'OK',
      account: {
        account_id: '90011087',
        broker: 'Demo Broker',
        balance: 1000.5,
        equity: 1100.25
      },
      market: {
        symbol: 'XAUUSD',
        bid: 3335.55,
        ask: 3335.75
      },
      positions: [
        {
          ticket: 123456,
          direction: 'BUY',
          lots: 0.1
        }
      ],
      ai_result: {
        bias: 'bullish',
        confidence: 82
      }
    });
    expect(body.decision_events.map((event: { decision_id: string }) => event.decision_id)).toEqual([
      'tpv1_new',
      'tpv1_old'
    ]);
  });

  it('serves Go-compatible account decisions behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store });
    store.recordDecisionEvent({
      decision_id: 'tpv1_old',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'candidate_signal',
      status: 'pending',
      reason_codes: ['candidate.created'],
      summary: { score: 7 },
      related_command_id: '',
      created_at: '2026-04-13T07:59:00.000Z'
    });
    store.recordDecisionEvent({
      decision_id: 'tpv1_rejected',
      account_id: '90011087',
      symbol: 'XAUUSD',
      stage: 'risk_gate',
      status: 'rejected',
      reason_codes: ['risk.spread.wide'],
      summary: { max_lots: 0 },
      related_command_id: 'sig_rejected',
      created_at: '2026-04-13T08:01:00.000Z'
    });
    store.recordDecisionEvent({
      decision_id: 'tpv1_other_symbol',
      account_id: '90011087',
      symbol: 'GBPJPY',
      stage: 'risk_gate',
      status: 'rejected',
      reason_codes: [],
      summary: {},
      related_command_id: '',
      created_at: '2026-04-13T08:02:00.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/accounts/90011087/decisions?symbol=XAUUSD&status=rejected&limit=1',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      account_id: '90011087',
      decision_events: [
        {
          id: 2,
          decision_id: 'tpv1_rejected',
          account_id: '90011087',
          symbol: 'XAUUSD',
          stage: 'risk_gate',
          status: 'rejected',
          reason_codes: ['risk.spread.wide'],
          summary: { max_lots: 0 },
          related_command_id: 'sig_rejected',
          created_at: '2026-04-13T08:01:00.000Z'
        }
      ]
    });

    const badLimit = await server.inject({
      method: 'GET',
      url: '/api/v1/accounts/90011087/decisions?limit=0',
      headers: apiAdminHeaders
    });

    expect(badLimit.statusCode).toBe(400);
    expect(JSON.parse(badLimit.body)).toEqual({ status: 'ERROR', message: 'limit must be a positive integer' });
  });

  it('updates pending signal arbitration behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store });
    store.savePendingSignal({
      id: 1,
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      score: 9,
      strategy: 'pullback',
      status: 'pending',
      created_at: '2026-04-13T08:00:00.000Z',
      expires_at: '2026-04-13T08:10:00.000Z',
      arbitration_result: '',
      arbitration_reason: ''
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/arbitration/1',
      headers: apiAdminHeaders,
      body: { result: 'approved', reason: 'manual ok' }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', signal_id: 1, result: 'approved' });
    expect(store.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/arbitration/1',
      headers: apiAdminHeaders,
      body: { result: 'maybe', reason: 'bad' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body)).toEqual({
      status: 'ERROR',
      message: "result must be 'approved' or 'rejected'"
    });
  });

  it('expires stale pending signals behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:03:00.000Z' });
    store.savePendingSignal({
      id: 1,
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      score: 7,
      strategy: 'pullback',
      status: 'pending',
      created_at: '2026-04-13T08:00:00.000Z',
      expires_at: '2026-04-13T08:02:00.000Z'
    });
    store.savePendingSignal({
      id: 2,
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'sell',
      score: 8,
      strategy: 'range',
      status: 'pending',
      created_at: '2026-04-13T08:01:00.000Z',
      expires_at: '2026-04-13T08:10:00.000Z'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/arbitration/expire',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', expired: 1 });
    expect(store.getPendingSignals('90011087', 'XAUUSD').map((signal) => signal.id)).toEqual([2]);
  });

  it('renders /api/v1/audit from persisted shadow state instead of placeholders', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-07-02T12:05:00.000Z' });

    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ai_result',
      created_at: '2026-07-02T12:00:00.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      report: {
        ready: boolean;
        protocol_error_rate: number;
        signal_drift_rate: number;
        command_drift_rate: number;
        last_shadow_event_at: string;
        missing_capabilities: string[];
      };
      summary: Array<{ label: string; value: string }>;
    };
    expect(body.report).toEqual({
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 1,
      last_shadow_event_at: '2026-07-02T12:00:00.000Z',
      missing_capabilities: [],
      checks: [
        {
          label: 'Oracle Replay',
          value: 'validated',
          detail: 'Go oracle comparisons are flowing into the shadow stream',
          tone: 'green'
        },
        {
          label: 'Shadow Drift',
          value: 'review required',
          detail: 'Signal 0.00%, command 100.00% (limit 2.00%)',
          tone: 'red'
        },
        {
          label: 'Protocol Errors',
          value: '0.00%',
          detail: 'No contract mismatches observed in mirrored traffic',
          tone: 'green'
        }
      ]
    });
    expect(body.summary).toEqual([
      {
        label: 'Replay Parity',
        value: 'validated',
        detail: 'Replay fixture matched baseline or drift is within threshold',
        tone: 'green'
      },
      {
        label: 'Shadow Drift',
        value: 'active',
        detail: 'Last shadow event at 2026-07-02T12:00:00.000Z',
        tone: 'blue'
      },
      {
        label: 'Protocol Errors',
        value: '0.00%',
        detail: 'No contract mismatches observed in replay or shadow mode',
        tone: 'green'
      }
    ]);
  });

  it('serves /shadow/metrics from persisted shadow comparison state', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ai_result',
      created_at: '2026-07-03T00:00:00.000Z'
    });
    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: false,
      signal_drift: true,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:05:00.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/shadow/metrics'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:10:00.000Z',
      report: {
        ready: false,
        protocol_error_rate: 0.5,
        signal_drift_rate: 0.5,
        command_drift_rate: 0.5,
        last_shadow_event_at: '2026-07-03T00:05:00.000Z',
        missing_capabilities: [],
        checks: [
          {
            label: 'Oracle Replay',
            value: 'validated',
            detail: 'Go oracle comparisons are flowing into the shadow stream',
            tone: 'green'
          },
          {
            label: 'Shadow Drift',
            value: 'review required',
            detail: 'Signal 50.00%, command 50.00% (limit 2.00%)',
            tone: 'red'
          },
          {
            label: 'Protocol Errors',
            value: '50.00%',
            detail: 'Legacy contract mismatches detected in mirrored traffic',
            tone: 'red'
          }
        ]
      },
      totals: {
        comparisons: 2,
        protocol_errors: 1,
        signal_drifts: 1,
        command_drifts: 1
      }
    });
  });

  it('serves /shadow/qualification with cutover-style checks', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: false,
      oracle_compared: true,
      source: 'ea_analysis',
      created_at: '2026-07-03T00:00:00.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/shadow/qualification'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      generated_at: '2026-07-03T00:10:00.000Z',
      report: {
        ready: true,
        protocol_error_rate: 0,
        signal_drift_rate: 0,
        command_drift_rate: 0,
        last_shadow_event_at: '2026-07-03T00:00:00.000Z',
        missing_capabilities: [],
        checks: [
          {
            label: 'Oracle Replay',
            value: 'validated',
            detail: 'Go oracle comparisons are flowing into the shadow stream',
            tone: 'green'
          },
          {
            label: 'Shadow Drift',
            value: 'within threshold',
            detail: 'Signal 0.00%, command 0.00%',
            tone: 'green'
          },
          {
            label: 'Protocol Errors',
            value: '0.00%',
            detail: 'No contract mismatches observed in mirrored traffic',
            tone: 'green'
          }
        ]
      },
      totals: {
        comparisons: 1,
        protocol_errors: 0,
        signal_drifts: 0,
        command_drifts: 0
      },
      summary: [
        {
          label: 'Oracle Replay',
          value: 'validated',
          detail: 'Go oracle comparisons are flowing into the shadow stream',
          tone: 'green'
        },
        {
          label: 'Shadow Drift',
          value: 'within threshold',
          detail: 'Signal 0.00%, command 0.00%',
          tone: 'green'
        },
        {
          label: 'Protocol Errors',
          value: '0.00%',
          detail: 'No contract mismatches observed in mirrored traffic',
          tone: 'green'
        }
      ]
    });
  });

  it('records oracle-backed shadow comparisons through POST /shadow/comparisons', async () => {
    const store = createInMemoryEaStore();
    const server = createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    const response = await server.inject({
      method: 'POST',
      url: '/shadow/comparisons',
      body: {
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        protocol_ok: true,
        node: {
          signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
          command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3345 }
        },
        oracle: {
          signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
          command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3350 }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      comparison: {
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: true,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:10:00.000Z'
      }
    });
    expect(store.listShadowComparisons()).toEqual([
      {
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: true,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:10:00.000Z'
      }
    ]);
  });

  it('records oracle comparisons against the latest stored runtime snapshot when node payload is omitted', async () => {
    const store = createInMemoryEaStore();
    store.saveShadowSnapshot({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
      command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });
    const server = createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    const response = await server.inject({
      method: 'POST',
      url: '/shadow/comparisons',
      body: {
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ea_analysis',
        oracle: {
          signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
          command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3350 }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      comparison: {
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: true,
        oracle_compared: true,
        source: 'ea_analysis',
        created_at: '2026-07-03T00:10:00.000Z'
      }
    });
  });

  it('rejects invalid shadow comparison payloads', async () => {
    const server = createAppServer();

    const response = await server.inject({
      method: 'POST',
      url: '/shadow/comparisons',
      body: {
        account_id: '90011087',
        symbol: '',
        node: {},
        oracle: {}
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      status: 'ERROR',
      message: 'invalid shadow comparison payload'
    });
  });

  it('serves a dashboard-compatible SSE snapshot stream', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    const fixture = readAdminStreamFixture('events-stream-sample');

    store.saveRegistration({ account_id: '90011087' });
    store.saveHeartbeat({ account_id: '90011087' });

    const response = await server.inject({
      method: fixture.request.method,
      url: fixture.request.path,
      headers: fixture.request.headers
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.body).toBe(fixture.response.frames.join(''));
  });

  it('serves analysis payloads and stores AI results in audit-only mode', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    for (const name of ['register', 'heartbeat', 'tick', 'bars', 'positions']) {
      const fixture = readFixture(name);
      await server.inject({
        method: fixture.request?.method ?? 'POST',
        url: fixture.request?.path ?? `/${name}`,
        headers: fixture.request?.headers,
        body: fixture.request?.body
      });
    }

    const analysis = readAdminFixture('analysis-payload');
    const analysisResponse = await server.inject({
      method: analysis.request.method,
      url: analysis.request.path,
      headers: analysis.request.headers
    });
    expect(analysisResponse.statusCode).toBe(200);
    const analysisBody = JSON.parse(analysisResponse.body) as {
      account?: unknown;
      market?: unknown;
      positions?: unknown;
      status?: string;
      indicators?: Record<string, unknown>;
      timestamp?: string;
    };
    const expectedAnalysis = analysis.response.body as {
      account?: unknown;
      market?: unknown;
      positions?: unknown;
      status?: string;
      timestamp?: string;
    };
    expect(analysisBody).toMatchObject({
      account: expectedAnalysis.account,
      market: expectedAnalysis.market,
      positions: expectedAnalysis.positions,
      status: expectedAnalysis.status,
      timestamp: expectedAnalysis.timestamp
    });
    expect(analysisBody.indicators).toHaveProperty('H1');

    const analysisV2 = readAdminFixture('analysis-payload-v2');
    const analysisV2Response = await server.inject({
      method: analysisV2.request.method,
      url: analysisV2.request.path,
      headers: analysisV2.request.headers
    });
    expect(analysisV2Response.statusCode).toBe(200);
    expect(JSON.parse(analysisV2Response.body)).toMatchObject({
      account: expectedAnalysis.account,
      market: expectedAnalysis.market,
      positions: expectedAnalysis.positions,
      status: expectedAnalysis.status,
      timestamp: expectedAnalysis.timestamp
    });

    for (const name of ['ai-result', 'ai-result-v2-trade-plan']) {
      const fixture = readAdminFixture(name);
      const response = await server.inject({
        method: fixture.request.method,
        url: fixture.request.path,
        headers: fixture.request.headers,
        body: fixture.request.body
      });
      expect(response.statusCode).toBe(200);
      if (name === 'ai-result-v2-trade-plan') {
        expect(JSON.parse(response.body)).toMatchObject({
          ...(fixture.response.body as Record<string, unknown>),
          command_status: 'shadow_only'
        });
      } else {
        expect(JSON.parse(response.body)).toEqual(fixture.response.body);
      }
    }

    expect(store.getAIResults('90011087')).toHaveLength(2);
    expect(store.pollCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'CLOSE_ALL',
        reason: 'AI风险警报(全平): volatility spike'
      })
    ]);
  });

  it('queues legacy AI close_all risk alerts for EA poll', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai_result/90011087',
      headers: apiUserHeaders,
      body: {
        combined_bias: 'bearish',
        confidence: 87,
        reasoning: 'risk regime changed',
        exit_suggestion: 'close_all',
        risk_alert: true,
        alert_reason: 'volatility spike'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', received: true });

    const poll = await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    const pollBody = JSON.parse(poll.body) as { count: number; commands: Array<Record<string, unknown>> };
    expect(pollBody.count).toBe(1);
    expect(pollBody.commands[0]).toMatchObject({
      action: 'CLOSE_ALL',
      reason: 'AI风险警报(全平): volatility spike',
      confidence: 87
    });
  });

  it('queues legacy AI close_short risk alerts only for matching SELL positions', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    store.savePositions({
      account_id: '90011087',
      positions: [
        { ticket: 111001, symbol: 'XAUUSD', type: 'BUY', lots: 0.1 },
        { ticket: 222002, symbol: 'XAUUSD', type: 'SELL', lots: 0.1 },
        { ticket: 333003, symbol: 'XAUUSD', type: 'SELL', lots: 0.2 },
        { ticket: 444004, symbol: 'GBPJPY', type: 'SELL', lots: 0.2 }
      ]
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai_result/90011087',
      headers: apiUserHeaders,
      body: {
        combined_bias: 'bullish',
        confidence: 84,
        reasoning: 'short exposure invalidated',
        exit_suggestion: 'close_short',
        risk_alert: true,
        alert_reason: '多周期强bullish共振'
      }
    });
    expect(response.statusCode).toBe(200);

    const poll = await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    const pollBody = JSON.parse(poll.body) as { count: number; commands: Array<Record<string, unknown>> };
    expect(pollBody.count).toBe(2);
    expect(pollBody.commands.map((command) => command.ticket).sort()).toEqual([222002, 333003]);
    for (const command of pollBody.commands) {
      expect(command).toMatchObject({
        action: 'CLOSE',
        reason: 'AI风险警报(平空): 多周期强bullish共振'
      });
    }
  });

  it('queues accepted V2 AI risk commands with trade-plan metadata', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    store.saveRegistration({ account_id: '90011087', leverage: 500 });
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        bias: 'bearish',
        confidence: 87,
        reasoning: 'risk regime changed',
        exit_suggestion: 'close_all',
        risk_alert: true,
        alert_reason: 'volatility spike',
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_close_all',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'close',
          side: 'buy',
          confidence: 87,
          entry_zone: { min: 3335.55, max: 3335.75 },
          stop_loss: 3328,
          take_profit: [3350],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.close', 'risk.high'],
          narrative: 'AI requests full close after risk spike'
        }
      }
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      risk_gate: { status: 'accepted' }
    });

    const poll = await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    const pollBody = JSON.parse(poll.body) as { count: number; commands: Array<Record<string, unknown>> };
    expect(pollBody.count).toBe(1);
    expect(pollBody.commands[0]).toMatchObject({
      action: 'CLOSE_ALL',
      decision_id: 'tpv1_close_all',
      trade_plan_mode: 'close',
      risk_gate: { status: 'accepted' }
    });
  });

  it('does not queue V2 AI risk commands when the trade-plan risk gate rejects', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    store.saveRegistration({ account_id: '90011087', leverage: 500 });
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: false,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 8.1,
      time: '2026-04-13T15:59:30+08:00'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        bias: 'bearish',
        confidence: 87,
        reasoning: 'risk regime changed',
        exit_suggestion: 'close_all',
        risk_alert: true,
        alert_reason: 'volatility spike',
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_rejected_spread',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'close',
          side: 'buy',
          confidence: 87,
          entry_zone: { min: 3335.55, max: 3335.75 },
          stop_loss: 3328,
          take_profit: [3350],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.close', 'risk.high'],
          narrative: 'AI requests full close after risk spike'
        }
      }
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      risk_gate: { status: 'rejected', reason_codes: expect.arrayContaining(['market.closed']) }
    });

    const poll = await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    expect(JSON.parse(poll.body)).toMatchObject({ count: 0, commands: [] });
  });

  it('keeps accepted AI trade-plan commands shadow_only while the account is in shadow mode', async () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'shadow');
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    store.saveRegistration({ account_id: '90011087', leverage: 500 });
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_shadow_mode',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 80,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy'],
          narrative: 'shadow mode should store but not queue'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      command_status: 'shadow_only'
    });
    expect(store.listCommands('90011087').map((command) => command.status)).toEqual(['shadow_only']);
    expect(store.pollCommands('90011087')).toEqual([]);
    expect(store.listShadowComparisons()).toEqual([
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: false,
        oracle_compared: false,
        source: 'ai_result'
      })
    ]);
    expect(store.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ai_result')).toEqual(
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ai_result'
      })
    );
  });

  it('queues accepted AI trade-plan commands only for cutover accounts', async () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    store.saveRegistration({ account_id: '90011087', leverage: 500 });
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_cutover_mode',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 80,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy'],
          narrative: 'cutover mode should queue commands'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      command_status: 'queued'
    });
    expect(store.pollCommands('90011087')).toHaveLength(1);
  });

  it('returns audit-only trade plan risk gate rejects without queueing poll commands', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    store.saveRegistration({ account_id: '90011087', leverage: 500 });
    store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: false,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_closed',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 80,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy'],
          narrative: 'market closed reject should come from risk gate'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      risk_gate?: { audit_only?: boolean; status?: string; reason_codes?: string[]; canProduceLiveCommands?: boolean };
    };
    expect(body.risk_gate).toMatchObject({
      audit_only: true,
      status: 'rejected',
      reason_codes: ['market.closed']
    });
    expect(body.risk_gate?.canProduceLiveCommands).toBe(false);
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('returns Go-style invalid trade_plan validation without decision or risk gate', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          decision_id: 'tpv1_invalid',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 80,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'missing schema version should fail validation'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'trade_plan.schema_version = "", want "trade_plan.v1"'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects trade_plan fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_confidence_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: '80',
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'confidence type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal string into Go struct field TradePlan.confidence of type int'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects top-level numeric trade_plan fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_stop_loss_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: '3330',
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'stop_loss type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal string into Go struct field TradePlan.stop_loss of type float64'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects take_profit arrays whose element types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_take_profit_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: ['3345'],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'take_profit element type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal string into Go struct field TradePlan.take_profit of type float64'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects reason_codes arrays whose element types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_reason_codes_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: [123],
          narrative: 'reason_codes element type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal number into Go struct field TradePlan.reason_codes of type string'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects add_on values whose JSON type does not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_add_on_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'add_on type mismatch should fail decode parity',
          add_on: 'true'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal string into Go struct field TradePlan.add_on of type bool'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects entry_zone fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_entry_zone_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: '3335.5', max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve'],
          narrative: 'entry_zone type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: json: cannot unmarshal string into Go struct field TradePlan.entry_zone.min of type float64'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects expires_at values whose JSON type does not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_bad_expires_at_type',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          confidence: 80,
          entry_zone: { min: 3335.5, max: 3335.7 },
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          expires_at: 123,
          reason_codes: ['mode.approve'],
          narrative: 'expires_at type mismatch should fail decode parity'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      received: true,
      trade_plan_validation: {
        valid: false,
        error: 'decode trade_plan: Time.UnmarshalJSON: input is not a JSON string'
      }
    });
    expect(store.pollCommands('90011087')).toEqual([]);
  });

  it('builds analysis payload indicators and trend context from Node snapshot bars', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500
    });
    store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 1999.8,
      ask: 2000,
      spread: 0.2,
      time: '16:00:00'
    });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: flatBars(25, 2000)
    });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'M30',
      bars: flatBars(10, 1900)
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      bars?: Record<string, unknown[]>;
      indicators?: Record<string, null | Record<string, number>>;
      trend_context?: Record<string, number | string>;
    };
    expect(body.bars?.H1).toHaveLength(25);
    expect(body.bars?.M30).toHaveLength(10);
    expect(body.indicators?.H1).toMatchObject({
      bars_count: 25,
      close: 2000,
      open: 2000,
      high: 2001,
      low: 1999,
      ema20: 2000,
      ema50: 2000,
      ema200: 0,
      atr: 2,
      macd: 0,
      macd_signal: 0,
      macd_hist: 0,
      fib_236: 2000.528,
      fib_382: 2000.236,
      fib_500: 2000,
      fib_618: 1999.764,
      fib_786: 1999.428
    });
    expect(body.indicators?.M30).toBeNull();
    expect(body.trend_context).toMatchObject({
      d1_direction: 'NEUTRAL',
      h4_direction: 'NEUTRAL',
      h1_direction: 'NEUTRAL',
      m30_direction: 'NEUTRAL',
      consensus_direction: 'NEUTRAL',
      consensus_strength: 0
    });
  });

  it('uses D1 bars for analysis trend context without exposing them in payload bars', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    const trendingBars = Array.from({ length: 40 }, (_, index) => {
      const close = 1800 + index * 10;
      return {
        time: `D1-${index}`,
        open: close - 5,
        high: close + 2,
        low: close - 8,
        close,
        volume: 2000 + index
      };
    });

    store.saveRegistration({ account_id: '90011087' });
    store.saveHeartbeat({ account_id: '90011087', market_open: true, is_trade_allowed: true });
    store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 2199.8, ask: 2200, spread: 0.2 });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'D1',
      bars: trendingBars
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      bars?: Record<string, unknown>;
      indicators?: Record<string, unknown>;
      trend_context?: Record<string, number | string>;
    };
    expect(body.bars).not.toHaveProperty('D1');
    expect(body.indicators).not.toHaveProperty('D1');
    expect(body.trend_context).toMatchObject({
      d1_direction: 'BULL',
      consensus_direction: 'BULL',
      consensus_strength: 0.045
    });
  });

  it('preserves all approved EA strategy mappings in analysis payloads', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    const strategyMapping = {
      '20250231': 'pullback',
      '20250232': 'breakout_retest',
      '20250233': 'divergence',
      '20250234': 'breakout_pyramid',
      '20250235': 'counter_pullback',
      '20250236': 'range',
      '20250237': 'momentum_scalp',
      '20250238': 'ai_signal',
      '20259999': 'experimental'
    };

    store.saveRegistration({
      account_id: '90011087',
      strategy_mapping: strategyMapping
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { strategy_mapping?: Record<string, string> };
    expect(body.strategy_mapping).toEqual({
      '20250231': 'pullback',
      '20250232': 'breakout_retest',
      '20250233': 'divergence',
      '20250234': 'breakout_pyramid',
      '20250235': 'counter_pullback',
      '20250236': 'range',
      '20250237': 'momentum_scalp',
      '20250238': 'ai_signal'
    });
  });

  it('defaults analysis payload strategy mapping to all approved EA strategies', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    store.saveRegistration({ account_id: '90011087' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { strategy_mapping?: Record<string, string> };
    expect(body.strategy_mapping).toEqual({
      '20250231': 'pullback',
      '20250232': 'breakout_retest',
      '20250233': 'divergence',
      '20250234': 'breakout_pyramid',
      '20250235': 'counter_pullback',
      '20250236': 'range',
      '20250237': 'momentum_scalp',
      '20250238': 'ai_signal'
    });
  });

  it('builds analysis payload market filters from Node snapshots', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-06-05T20:45:00.000Z' });

    store.saveRegistration({ account_id: '90011087' });
    store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 8.2,
      time: '2026-06-05T20:44:50.000Z'
    });
    store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'M30',
      bars: atrExpansionBars(40)
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_filters?: {
        blocked?: boolean;
        blocking?: Array<{ code?: string; severity?: string }>;
        warnings?: Array<{ code?: string; severity?: string }>;
        reason_codes?: string[];
      };
    };
    expect(body.market_filters?.blocked).toBe(true);
    expect(body.market_filters?.reason_codes).toEqual(
      expect.arrayContaining(['spread.too_wide', 'session.friday_close_window', 'volatility.atr_expansion'])
    );
    expect(body.market_filters?.blocking).toEqual(
      expect.arrayContaining([
        { code: 'spread.too_wide', severity: 'blocking' },
        { code: 'session.friday_close_window', severity: 'blocking' }
      ])
    );
    expect(body.market_filters?.warnings).toEqual(expect.arrayContaining([{ code: 'volatility.atr_expansion', severity: 'warning' }]));
  });

  it('marks analysis market status untradeable when the latest tick is stale', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-06-04T13:00:00.000Z' });

    store.saveRegistration({ account_id: '90011087' });
    store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.06.04 13:00'
    });
    store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 0.2,
      time: '2026-06-04T12:44:30.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_filters?: { reason_codes?: string[] };
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        mt4_server_time?: string;
        tradeable?: boolean;
      };
    };
    expect(body.market_filters?.reason_codes).toContain('tick.stale');
    expect(body.market_status).toEqual({
      market_open: false,
      is_trade_allowed: false,
      mt4_server_time: '2026.06.04 13:00',
      tradeable: false
    });
  });

  it('serves trading-core analysis from Node snapshots without enqueueing commands', async () => {
    const store = createInMemoryEaStore();
    const server = createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    const snapshot = readReplayFixture('account_90011087_snapshot.json');
    const register = readFixture('register');

    await server.inject({
      method: 'POST',
      url: '/register',
      headers: apiUserHeaders,
      body: {
        ...(register.request?.body as Record<string, unknown>),
        account_id: snapshot.account_id
      }
    });
    await server.inject({
      method: 'POST',
      url: '/tick',
      headers: apiUserHeaders,
      body: {
        account_id: snapshot.account_id,
        symbol: 'XAUUSD',
        bid: 3335.55,
        ask: snapshot.current_price,
        spread: 0.2,
        time: '08:00:00'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/bars',
      headers: apiUserHeaders,
      body: {
        account_id: snapshot.account_id,
        symbol: 'XAUUSD',
        timeframe: 'H1',
        bars: snapshot.bars.H1
      }
    });
    for (const timeframe of ['H4', 'M30', 'M15']) {
      await server.inject({
        method: 'POST',
        url: '/bars',
        headers: apiUserHeaders,
        body: {
          account_id: snapshot.account_id,
          symbol: 'XAUUSD',
          timeframe,
          bars: snapshot.bars[timeframe]
        }
      });
    }
    await server.inject({
      method: 'POST',
      url: '/positions',
      headers: apiUserHeaders,
      body: {
        account_id: snapshot.account_id,
        symbol: 'XAUUSD',
        positions: [{ ticket: 777, symbol: 'XAUUSDm#', type: 'BUY', lots: 0.1, open_price: 3330, profit: 5.25, strategy: 'pullback' }]
      }
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/analysis/90011087/XAUUSD/trading-core',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status?: string;
      generated_at?: string;
      replay?: {
        signal?: { strategy?: string; side?: string; entry?: number; score?: number };
        logs?: Array<{ level?: string; strategy?: string; msg?: string }>;
        position_commands?: unknown;
        canProduceLiveCommands?: boolean;
      };
      position_summary?: {
        accountId?: string;
        symbol?: string;
        totalOpenPositions?: number;
        canProduceLiveCommands?: boolean;
      };
    };
    expect(body.status).toBe('OK');
    expect(body.generated_at).toBe('2026-04-13T08:00:00Z');
    expect(body.replay?.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      entry: 3335.75,
      score: 6
    });
    expect(body.replay?.logs).toEqual(
      expect.arrayContaining([
        {
          level: 'info',
          strategy: '市场',
          msg: 'Price=3335.75 | ATR=2.67 | RSI=64.7 | ADX=71.5 | EMA趋势(H1)=多头 | H4=强多头(ADX=100.0) | MACD柱=-0.82'
        },
        {
          level: 'info',
          strategy: 'M15确认',
          msg: '⏭ pullback | M15未确认: RSI=77.2≥40'
        }
      ])
    );
    expect(body.replay?.position_commands).toEqual([
      { action: 'MODIFY', ticket: 777, new_sl: 3330, reason: 'breakeven_2.2ATR' },
      { action: 'CLOSE', ticket: 777, lots: 0.04, reason: 'TP1_2.2ATR' }
    ]);
    expect(body.replay?.canProduceLiveCommands).toBe(false);
    expect(body.position_summary).toMatchObject({
      accountId: '90011087',
      symbol: 'XAUUSD',
      totalOpenPositions: 1,
      buyLots: 0.1,
      floatingProfit: 5.25,
      canProduceLiveCommands: false
    });

    const poll = await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    });
    expect(JSON.parse(poll.body)).toEqual({ status: 'OK', commands: [], count: 0 });
    expect(store.pollCommands('90011087')).toEqual([]);
  });
});
