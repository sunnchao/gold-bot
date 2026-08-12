import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryEaStore, createSqliteEaStore, type EaCommand } from '@gold-bot/persistence';
import { createSseHub, type SseEvent } from '@gold-bot/observability';
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

function openSseStream(port: number, path: string): Promise<{
  response: IncomingMessage;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path
      },
      (response) => {
        response.setEncoding('utf8');
        resolve({
          response,
          close: () => req.destroy()
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function collectSseFrames(response: IncomingMessage, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const frames: string[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${count} SSE frames`));
    }, 2_000);
    const cleanup = () => {
      clearTimeout(timeout);
      response.off('data', onData);
      response.off('error', onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: string) => {
      buffer += chunk;
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        frames.push(buffer.slice(0, boundary + 2));
        buffer = buffer.slice(boundary + 2);
        if (frames.length === count) {
          cleanup();
          resolve(frames);
          return;
        }
        boundary = buffer.indexOf('\n\n');
      }
    };
    response.on('data', onData);
    response.on('error', onError);
  });
}

function parseSseFrame(frame: string): Record<string, unknown> {
  const prefix = 'data: ';
  expect(frame.startsWith(prefix)).toBe(true);
  return JSON.parse(frame.slice(prefix.length).trim()) as Record<string, unknown>;
}

function postJson(port: number, path: string, headers: Record<string, string>, body: unknown): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    req.end(rawBody);
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

function pullbackBuyBars() {
  const bars = Array.from({ length: 50 }, (_, index) => ({
    time: `2026-04-16T${String(index).padStart(2, '0')}:00:00.000Z`,
    open: 95,
    high: 96,
    low: 94,
    close: 95,
    atr: 2,
    adx: 35,
    rsi: 45,
    ema20: 95.8,
    ema50: 90,
    macd_hist: 1,
    r1: 97.5
  }));

  bars[48] = {
    ...bars[48],
    close: 95.2,
    open: 95.2
  };
  bars[49] = {
    ...bars[49],
    close: 95,
    open: 95
  };
  return bars;
}

function d1TrendBars() {
  return Array.from({ length: 40 }, (_, index) => ({
    time: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    adx: 35,
    ema20: 120,
    ema50: 100
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

function dualTradePlanSide(decisionId: string, side: 'buy' | 'sell', entryMin: number, entryMax: number): Record<string, unknown> {
  return {
    schema_version: 'trade_plan.v1',
    decision_id: decisionId,
    account_id: fixtureAccountId,
    symbol: 'XAUUSD',
    mode: 'approve',
    side,
    confidence: 80,
    entry_zone: { min: entryMin, max: entryMax },
    execution_type: 'market',
    requested_order_type: 'market',
    stop_loss: side === 'buy' ? 3330 : 3340,
    take_profit: [side === 'buy' ? 3345 : 3325],
    max_lots: 0.1,
    expires_at: '2099-06-06T09:15:00Z',
    reason_codes: ['mode.approve', `side.${side}`],
    narrative: `dual ${side} approve`
  };
}

async function seedAIApproveTrendBars(store: ReturnType<typeof createInMemoryEaStore>): Promise<void> {
  for (const timeframe of ['D1', 'H4', 'H1', 'M30', 'M15']) {
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe,
      bars: [{ close: 3336, ema20: 3335, ema50: 3330, adx: 35, atr: 2, rsi: 60 }]
    });
  }
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
    const server = await createAppServer();
    const response = await server.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
  });

  it('serves Go-compatible Prometheus metrics text', async () => {
    const server = await createAppServer();
    await server.inject({
      method: 'GET',
      url: '/healthz'
    });
    await server.inject({
      method: 'GET',
      url: '/not-found'
    });
    const response = await server.inject({
      method: 'GET',
      url: '/metrics'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('# HELP goldbot_http_requests_total');
    expect(response.body).toContain('goldbot_http_requests_total');
    expect(response.body).toContain('goldbot_http_requests_total{method="GET",path="/metrics",status="2xx"} 1');
  });

  it('serves dashboard static files with Go-compatible SPA fallbacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-bot-dashboard-'));
    try {
      const dist = join(dir, 'apps', 'app-web', 'dist');
      mkdirSync(join(dist, 'accounts', '__dynamic__'), { recursive: true });
      writeFileSync(join(dist, 'index.html'), '<main>dashboard shell</main>');
      writeFileSync(join(dist, 'accounts', '__dynamic__', 'index.html'), '<main>account detail</main>');
      const server = await createAppServer({ releaseRoot: dir });

      const root = await server.inject({ method: 'GET', url: '/' });
      const spa = await server.inject({ method: 'GET', url: '/audit' });
      const account = await server.inject({ method: 'GET', url: '/accounts/90011087' });

      expect(root.statusCode).toBe(200);
      expect(root.headers['content-type']).toContain('text/html');
      expect(root.body).toBe('<main>dashboard shell</main>');
      expect(spa.statusCode).toBe(200);
      expect(spa.body).toBe('<main>dashboard shell</main>');
      expect(account.statusCode).toBe(200);
      expect(account.body).toBe('<main>account detail</main>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves public EA release version metadata', async () => {
    const server = await createApiServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/ea/version'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      version: '2.9.2',
      build: 12,
      changelog:
        '上报 EA 端 MaxSpread 配置：/heartbeat 与 /tick 增加 max_spread 字段，服务端 market_filters 与 riskgate 优先参考 EA 点差阈值'
    });
  });

  it('rejects EA version_check without a route token', async () => {
    const server = await createApiServer();

    const response = await server.inject({
      method: 'POST',
      url: '/version_check'
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('serves token-protected EA version_check payload', async () => {
    const server = await createApiServer();

    const response = await server.inject({
      method: 'POST',
      url: '/version_check',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      latest_version: '2.9.2',
      latest_build: 12,
      force_update: false
    });
  });

  it('rejects EA download without a route token', async () => {
    const server = await createApiServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/ea/download'
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('serves token-protected EA download as an attachment', async () => {
    const server = await createApiServer();

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
      const server = await createApiServer({ releaseRoot: dir });

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
    const server = await createApiServer({ nowUnix: () => 1772342400 });
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
    const server = await createApiServer();

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
    const pollWrongShape = await server.inject({
      method: 'POST',
      url: '/indicator_alert/poll',
      headers: apiUserHeaders,
      body: {
        account_id: 123
      }
    });

    expect(method.statusCode).toBe(405);
    expect(JSON.parse(method.body)).toEqual({ status: 'ERROR', message: 'method not allowed' });
    expect(json.statusCode).toBe(400);
    expect(JSON.parse(json.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
    expect(wrongShape.statusCode).toBe(400);
    expect(JSON.parse(wrongShape.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
    expect(pollWrongShape.statusCode).toBe(400);
    expect(JSON.parse(pollWrongShape.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
  });

  it('serves visual poll with tick, AI trade plan, and matching alerts', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:05:00.000Z', nowUnix: () => 1772342400 });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 20,
      time: '08:00:00'
    });
    await store.saveAIResult('90011087', 'XAUUSD', {
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
        take_profit: [3360],
        narrative: 'trade plan narrative'
      },
      risk_gate: { status: 'accepted' }
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
    const server = await createApiServer();

    const invalidJson = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: '{'
    });
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

    expect(invalidJson.statusCode).toBe(400);
    expect(JSON.parse(invalidJson.body)).toEqual({ status: 'ERROR', message: 'invalid json' });
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body)).toEqual({ status: 'ERROR', message: 'account_id and symbol are required' });
    expect(forbidden.statusCode).toBe(403);
    expect(JSON.parse(forbidden.body)).toEqual({ status: 'ERROR', message: 'forbidden' });
  });

  it('serves visual poll with request symbol when no tick snapshot exists', async () => {
    const server = await createApiServer({ nowIso: () => '2026-04-13T08:05:00.000Z' });

    const response = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087', symbol: 'XAUUSD', timeframe: 'H1' }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'ok',
      tick: {
        symbol: 'XAUUSD',
        bid: 0,
        ask: 0,
        spread: 0,
        time: ''
      }
    });
  });

  it('keeps visual AI summary empty for Go-compatible blank AI results', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:05:00.000Z' });
    await store.saveAIResult('90011087', 'XAUUSD', {});

    const response = await server.inject({
      method: 'POST',
      url: '/visual/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087', symbol: 'XAUUSD', timeframe: 'H1' }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ai: {
        has_result: false,
        bias: '',
        confidence: 0,
        exit_suggestion: '',
        risk_alert: false,
        alert_reason: '',
        decision_id: '',
        trade_plan_mode: '',
        side: '',
        entry_min: 0,
        entry_max: 0,
        stop_loss: 0,
        take_profit: 0,
        risk_gate_status: '',
        narrative: ''
      }
    });
  });

  it('accepts safe EA lifecycle routes with Go-shaped responses and stores payloads', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store, nowUnix: () => 1772342400 });
    await store.enqueueCommand('90011087', {
      command_id: 'sig_2',
      action: 'SIGNAL',
      strategy: 'pullback',
      symbol: 'XAUUSD',
      type: 'BUY'
    });
    expect(await store.pollCommands('90011087')).toHaveLength(1);

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

    expect(await store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });
    expect(await store.getHeartbeat('90011087')).toMatchObject({ equity: 1100.25 });
    expect(await store.getLatestTick('90011087', 'XAUUSD')).toMatchObject({ ask: 3335.75 });
    expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toHaveLength(1);
    expect(await store.getPositions('90011087')).toHaveLength(1);
    expect(await store.getOrderResults('90011087')).toHaveLength(1);
  });

  it('logs accepted EA lifecycle details without token data', async () => {
    const store = createInMemoryEaStore();
    const logs: string[] = [];
    const server = await createAppServer({
      store,
      validTokens: [fixtureUserToken],
      tokenAccounts: { [fixtureUserToken]: [fixtureAccountId] },
      log: (message) => logs.push(message),
      nowUnix: () => 1772342400,
      nowIso: () => '2026-03-01T00:00:00.000Z'
    });

    for (const name of ['register', 'heartbeat', 'tick']) {
      const fixture = readFixture(name);
      const response = await server.inject({
        method: fixture.request?.method ?? 'POST',
        url: fixture.request?.path ?? `/${name}`,
        headers: fixture.request?.headers,
        body: fixture.request?.body
      });

      expect(response.statusCode).toBe(200);
    }

    expect(logs).toEqual([
      expect.stringContaining('[EA-REGISTER] account_id=90011087'),
      expect.stringContaining('[EA-HEARTBEAT] account_id=90011087'),
      expect.stringContaining('[EA-TICK] account_id=90011087')
    ]);
    expect(logs[0]).toContain('broker=Demo Broker');
    expect(logs[0]).toContain('strategies=');
    expect(logs[1]).toContain('equity=1100.25');
    expect(logs[1]).toContain('market_open=true');
    expect(logs[2]).toContain('symbol=XAUUSD');
    expect(logs[2]).toContain('ask=3335.75');
    expect(logs.join('\n')).not.toContain('X-API-Token');
    expect(logs.join('\n')).not.toContain(fixtureUserToken);
  });

  it('does not emit EA lifecycle success logs for rejected payloads', async () => {
    const store = createInMemoryEaStore();
    const logs: string[] = [];
    const server = await createAppServer({
      store,
      log: (message) => logs.push(message)
    });

    const response = await server.inject({
      method: 'POST',
      url: '/tick',
      body: { account_id: '90011087', bid: '3335.55' }
    });

    expect(response.statusCode).toBe(400);
    expect(logs).toEqual([]);
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
    const server = await createAppServer({ store });
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

    await store.enqueueCommand('90011087', command);

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
    const server = await createAppServer();

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
    const server = await createAppServer({ store });

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
    expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([]);

    const noPositions = await server.inject({
      method: 'POST',
      url: '/positions',
      body: { account_id: '90011087' }
    });
    expect(noPositions.statusCode).toBe(200);
    expect(JSON.parse(noPositions.body)).toEqual({ status: 'OK', count: 0 });
    expect(await store.getPositions('90011087')).toEqual([]);
  });

  it('normalizes empty strategy from GB_ comment, never from magic', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store });

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
    expect((await store.getBars('90011087', 'XAUUSD', 'H1'))[0]).toMatchObject({ time: '1712971200' });

    // Magic intentionally set to a value that would historically map to ai_signal;
    // with comment-first recovery, strategy must come from comment only.
    const positions = await server.inject({
      method: 'POST',
      url: '/positions',
      body: {
        account_id: '90011087',
        positions: [{
          ticket: 123,
          symbol: 'XAUUSD',
          type: 'BUY',
          lots: 0.1,
          open_price: 3300,
          magic: 20250238,
          strategy: '',
          comment: 'GB_divergence_S8_A'
        }]
      }
    });
    expect(positions.statusCode).toBe(200);
    expect((await store.getPositions('90011087'))[0]).toMatchObject({
      strategy: 'divergence',
      comment: 'GB_divergence_S8_A'
    });

    // Custom magic + no usable comment → unknown (do not invent from magic).
    const unknownPos = await server.inject({
      method: 'POST',
      url: '/positions',
      body: {
        account_id: '90011087',
        positions: [{
          ticket: 456,
          symbol: 'XAUUSD',
          type: 'SELL',
          lots: 0.05,
          open_price: 3301,
          magic: 99999999,
          strategy: '',
          comment: ''
        }]
      }
    });
    expect(unknownPos.statusCode).toBe(200);
    const stored = await store.getPositions('90011087');
    const ticket456 = stored.find((p) => Number(p.ticket) === 456);
    expect(ticket456).toMatchObject({ strategy: 'unknown' });
  });

  it('analysis_payload backfills empty strategy from comment for agent schema', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({
      store,
      validTokens: ['test-token'],
      tokenAccounts: { 'test-token': ['90011087'] },
      adminTokens: ['test-token'],
      nowUnix: () => 1713000000
    });
    const headers = { 'X-API-Token': 'test-token' };

    await server.inject({
      method: 'POST',
      url: '/register',
      body: {
        account_id: '90011087',
        broker: 'Demo',
        currency: 'USD',
        leverage: 100,
        server_name: 'Demo'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/heartbeat',
      body: {
        account_id: '90011087',
        balance: 10000,
        equity: 10000,
        free_margin: 9000,
        margin: 1000,
        market_open: true,
        is_trade_allowed: true,
        server_time: '2026.04.13 08:00:00'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/tick',
      body: {
        account_id: '90011087',
        symbol: 'GBPJPY',
        bid: 216.5,
        ask: 216.55,
        spread: 5,
        time: '08:00:00'
      }
    });
    // Persist with empty strategy but recoverable comment (simulates historical dirty store).
    await store.savePositions({
      account_id: '90011087',
      symbol: 'GBPJPY',
      positions: [{
        ticket: 42275446,
        symbol: 'GBPJPY',
        type: 'BUY',
        lots: 0.03,
        open_price: 216.4,
        magic: 202502333,
        strategy: '',
        comment: 'GB_divergence_S8_A',
        profit: 1.2
      }]
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v2/analysis_payload/90011087/GBPJPY',
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      positions?: Array<{ ticket?: number; strategy?: string; comment?: string }>;
    };
    expect(body.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket: 42275446,
          strategy: 'divergence',
          comment: 'GB_divergence_S8_A'
        })
      ])
    );
  });

  it('re-parses truncated strategy like ai from GB_ai_signal comment', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({
      store,
      validTokens: ['test-token'],
      tokenAccounts: { 'test-token': ['90011087'] },
      adminTokens: ['test-token'],
      nowUnix: () => 1713000000
    });
    const headers = { 'X-API-Token': 'test-token' };

    await server.inject({
      method: 'POST',
      url: '/register',
      body: {
        account_id: '90011087',
        broker: 'Demo',
        currency: 'USD',
        leverage: 100,
        server_name: 'Demo'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/heartbeat',
      body: {
        account_id: '90011087',
        balance: 10000,
        equity: 10000,
        free_margin: 9000,
        margin: 1000,
        market_open: true,
        is_trade_allowed: true,
        server_time: '2026.04.13 08:00:00'
      }
    });
    await server.inject({
      method: 'POST',
      url: '/tick',
      body: {
        account_id: '90011087',
        symbol: 'XAGUSD',
        bid: 58.5,
        ask: 58.55,
        spread: 5,
        time: '08:00:00'
      }
    });

    const post = await server.inject({
      method: 'POST',
      url: '/positions',
      headers,
      body: {
        account_id: '90011087',
        symbol: 'XAGUSD',
        positions: [{
          ticket: 42275433,
          symbol: 'XAGUSD',
          type: 'SELL_LIMIT',
          order_class: 'pending',
          lots: 0.05,
          open_price: 59.5,
          strategy: 'ai',
          comment: 'GB_ai_signal_S78',
          profit: 0,
          tp: 58.36,
          sl: 59.5
        }]
      }
    });
    expect(post.statusCode).toBe(200);

    const stored = await store.getPositions('90011087');
    const pending = stored.find((p) => Number(p.ticket) === 42275433);
    expect(pending).toMatchObject({
      strategy: 'ai_signal',
      order_class: 'pending',
      type: 'SELL_LIMIT'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v2/analysis_payload/90011087/XAGUSD',
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      positions?: Array<{ ticket?: number; strategy?: string; order_class?: string; direction?: string }>;
    };
    expect(body.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket: 42275433,
          strategy: 'ai_signal',
          order_class: 'pending',
          direction: 'SELL_LIMIT'
        })
      ])
    );
  });

  it('rejects nested EA payload type mismatches like the Go decoder', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store });

    const cases = [
      {
        path: '/bars',
        body: { account_id: '90011087', timeframe: 'H1', bars: [{ open: '3300' }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/bars',
        body: { account_id: '90011087', symbol: 123, timeframe: 'H1', bars: [] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/bars',
        body: { account_id: '90011087', symbol: 'XAUUSD', timeframe: 60, bars: [] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', '')).toEqual([])
      },
      {
        path: '/bars',
        body: { account_id: '90011087', timeframe: 'H1', bars: [{ volume: 10.5 }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/bars',
        body: { account_id: '90011087', timeframe: 'H1', bars: [{ macd_divergence: 123 }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/bars',
        body: { account_id: '90011087', timeframe: 'H1', bars: [{ candlestick_patterns: ['hammer', 123] }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getBars('90011087', 'XAUUSD', 'H1')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', symbol: 123, positions: [] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', positions: [{ ticket: '123' }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', positions: [{ ticket: 123.45 }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', positions: [{ open_time: 1712971200.5 }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/positions',
        body: { account_id: '90011087', positions: [{ magic: 20250238.5 }] },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getPositions('90011087')).toEqual([])
      },
      {
        path: '/register',
        body: { account_id: '90011087', strategy_mapping: { '20250231': 123 } },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getRegistration('90011087')).toBeUndefined()
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: 'filled', ticket: '321' },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: 'filled', ticket: 321.5 },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: 'filled', error: 500 },
        message: 'invalid JSON',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
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
      await testCase.assertNotPersisted();
    }
  });

  it('applies order_result only to delivered commands and preserves broker error text', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({
      store,
      nowIso: () => '2026-04-13T08:01:00.000Z'
    });
    const delivered = await store.saveCommandCandidate('90011087', {
      command_id: 'sig_route_failed',
      source: 'ai_result',
      symbol: 'XAUUSD',
      action: 'SIGNAL',
      strategy: 'ai_signal',
      decision_id: 'tpv1_route_failed'
    });
    const queued = await store.saveCommandCandidate('90011087', {
      command_id: 'sig_route_pending',
      source: 'ai_result',
      symbol: 'XAUUSD',
      action: 'SIGNAL',
      strategy: 'ai_signal',
      decision_id: 'tpv1_route_pending'
    });
    await store.promoteCommand(delivered.command_id);
    await store.promoteCommand(queued.command_id);
    expect(await store.pollCommands('90011087')).toEqual([
      expect.objectContaining({ command_id: delivered.command_id }),
      expect.objectContaining({ command_id: queued.command_id })
    ]);

    const response = await server.inject({
      method: 'POST',
      url: '/order_result',
      body: {
        account_id: '90011087',
        command_id: delivered.command_id,
        result: 'ERROR',
        ticket: 0,
        error: 'invalid stops'
      }
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK' });
    expect(await store.getCommand(delivered.command_id)).toMatchObject({
      status: 'failed',
      result: 'ERROR',
      ticket: 0,
      failed_at: '2026-04-13T08:01:00.000Z',
      error_text: 'invalid stops'
    });
    expect(await store.getOrderResults('90011087')).toEqual([
      {
        account_id: '90011087',
        command_id: delivered.command_id,
        result: 'ERROR',
        ticket: 0,
        error_text: 'invalid stops',
        created_at: '2026-04-13T08:01:00.000Z'
      }
    ]);
    expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD', status: 'failed' })).toEqual([
      expect.objectContaining({
        decision_id: 'tpv1_route_failed',
        stage: 'order_result',
        related_command_id: delivered.command_id
      })
    ]);

    const duplicate = await server.inject({
      method: 'POST',
      url: '/order_result',
      body: {
        account_id: '90011087',
        command_id: delivered.command_id,
        result: 'OK',
        ticket: 123,
        error: ''
      }
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/order_result',
      body: {
        account_id: '90011087',
        command_id: 'sig_route_missing',
        result: 'OK',
        ticket: 123,
        error: ''
      }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    expect(await store.getOrderResults('90011087')).toHaveLength(1);
    expect(await store.getCommand(queued.command_id)).toMatchObject({ status: 'delivered' });
  });

  it('rejects order_result payloads missing required fields before persistence', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store });

    const cases = [
      {
        path: '/order_result',
        body: { account_id: '90011087', result: 'filled' },
        message: 'missing command_id',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1' },
        message: 'missing result',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: '   ', result: 'filled' },
        message: 'missing command_id',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
      },
      {
        path: '/order_result',
        body: { account_id: '90011087', command_id: 'cmd_1', result: '   ' },
        message: 'missing result',
        assertNotPersisted: async () => expect(await store.getOrderResults('90011087')).toEqual([])
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
      await testCase.assertNotPersisted();
    }
  });

  it('accepts Go-compatible non-POST EA route methods when the JSON body is valid', async () => {
    const server = await createAppServer();
    const response = await server.inject({
      method: 'GET',
      url: '/poll',
      body: { account_id: '90011087' }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'OK',
      commands: [],
      count: 0
    });
  });

  it('can enforce auth tokens using the Go-compatible extraction priority', async () => {
    const server = await createAppServer({ validTokens: ['primary'] });

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
    const server = await createAppServer({
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
    expect(await store.getHeartbeat('90022000')).toBeUndefined();

    const adminAllowed = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: { 'X-API-Token': 'admin-token' },
      body: { account_id: '90022000', balance: 2000 }
    });
    expect(adminAllowed.statusCode).toBe(200);
    expect(await store.getHeartbeat('90022000')).toMatchObject({ balance: 2000 });
  });

  it('manages API tokens behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store });

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
    expect(await store.getHeartbeat('90022000')).toMatchObject({ equity: 2000 });

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

  it('deletes the lexicographically first API token matching a prefix like Go', async () => {
    const server = await createApiServer({
      validTokens: [fixtureAdminToken, 'shared-bbb-token', 'shared-aaa-token'],
      adminTokens: [fixtureAdminToken],
      tokenAccounts: {
        'shared-bbb-token': ['90011087'],
        'shared-aaa-token': ['90011087']
      }
    });

    const deleted = await server.inject({
      method: 'DELETE',
      url: '/api/tokens/shared-',
      headers: apiAdminHeaders
    });
    const listed = await server.inject({
      method: 'GET',
      url: '/api/tokens',
      headers: apiAdminHeaders
    });

    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.body)).toEqual({ status: 'OK', revoked: 'shar...oken' });
    const tokens = (JSON.parse(listed.body) as { tokens: Record<string, { full_token: string }> }).tokens;
    expect(Object.values(tokens).map((token) => token.full_token)).not.toContain('shared-aaa-token');
    expect(Object.values(tokens).map((token) => token.full_token)).toContain('shared-bbb-token');
  });

  it('loads persisted API tokens from the app store on startup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-bot-token-admin-'));
    const dbPath = join(dir, 'ea.sqlite');
    try {
      const firstStore = createSqliteEaStore(dbPath);
      const firstServer = await createApiServer({ store: firstStore });
      const created = await firstServer.inject({
        method: 'POST',
        url: '/api/tokens',
        headers: apiAdminHeaders,
        body: { name: 'Desk', accounts: ['90011087'] }
      });
      const token = (JSON.parse(created.body) as { token: string }).token;
      firstStore.close();

      const secondStore = createSqliteEaStore(dbPath);
      const secondServer = await createApiServer({ store: secondStore });
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
      expect(await secondStore.getHeartbeat('90011087')).toMatchObject({ equity: 2100 });
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
    const server = await createAppServer({
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
    expect(await store.getRegistration('90011087')).toMatchObject({ broker: 'Demo Broker' });

    const second = await server.inject({
      method: 'POST',
      url: '/register',
      headers: { 'X-API-Token': 'new-token' },
      body: { account_id: '90022000', broker: 'Other Broker' }
    });
    expect(second.statusCode).toBe(403);
    expect(JSON.parse(second.body)).toEqual({ status: 'ERROR', message: 'token not authorized for account' });
    expect(await store.getRegistration('90022000')).toBeUndefined();
  });

  it('rejects API routes when no Node token store is configured', async () => {
    const server = await createAppServer();

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: { 'X-API-Token': 'unknown-token' }
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid token' });
  });

  it('rejects unbound valid tokens on API account routes without auto-binding', async () => {
    const requests = [
      { method: 'GET', url: '/api/analysis_payload/90011087' },
      { method: 'POST', url: '/api/ai_result/90011087', body: {} },
      { method: 'GET', url: '/api/pending_signal/90011087/XAUUSD' }
    ];

    for (const request of requests) {
      const server = await createAppServer({
        validTokens: ['unbound-token'],
        tokenAccounts: { 'unbound-token': [] }
      });
      const response = await server.inject({
        ...request,
        headers: { 'X-API-Token': 'unbound-token' }
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'forbidden' });
    }
  });

  it('enforces Go-compatible API admin gates', async () => {
    const server = await createApiServer();

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
    const server = await createApiServer();
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
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    const pendingFixture = readAdminFixture('pending-signal');
    const pendingSignal = (pendingFixture.response.body as unknown[])[0];
    delete (pendingSignal as Record<string, unknown>).id;

    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500,
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true,
      ai_symbols: ['XAUUSD', 'GBPJPY']
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'GBPJPY',
      bid: 191.25,
      ask: 191.28
    });
    await store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY' }]
    });
    await store.savePendingSignal(pendingSignal);

    for (const name of ['symbols', 'ai-symbols', 'pending-signal', 'accounts', 'overview', 'audit']) {
      const fixture = readAdminFixture(name);
      const response = await server.inject({
        method: fixture.request.method,
        url: fixture.request.path,
        headers: fixture.request.headers
      });

      expect(response.statusCode).toBe(200);
      const actualBody = JSON.parse(response.body);
      const expectedBody = fixture.response.body;
      if (name === 'symbols' || name === 'ai-symbols') {
        expect(Array.isArray(actualBody)).toBe(true);
        expect(Array.isArray(expectedBody)).toBe(true);
        expect((actualBody as string[]).sort()).toEqual((expectedBody as string[]).sort());
      } else {
        expect(actualBody).toEqual(expectedBody);
      }
    }
  });

  it('uses heartbeat presence for admin connected state and overview count', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1'
    });
    await store.saveRegistration({
      account_id: '90022000',
      broker: 'Demo Broker',
      server_name: 'Demo-2'
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      market_open: true,
      is_trade_allowed: true
    });

    const accounts = await server.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: apiAdminHeaders
    });
    const overview = await server.inject({
      method: 'GET',
      url: '/api/v1/overview',
      headers: apiAdminHeaders
    });

    expect(accounts.statusCode).toBe(200);
    expect((JSON.parse(accounts.body) as { accounts: Array<{ account_id: string; connected: boolean }> }).accounts).toEqual([
      expect.objectContaining({ account_id: '90011087', connected: true }),
      expect.objectContaining({ account_id: '90022000', connected: false })
    ]);
    expect(overview.statusCode).toBe(200);
    const connectedCard = (JSON.parse(overview.body) as { cards: Array<{ title: string; value: string }> }).cards
      .find((card) => card.title === 'Connected Accounts');
    expect(connectedCard).toMatchObject({ value: '1' });
  });

  it('accepts Go-compatible non-GET methods for admin read handlers', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1'
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      market_open: true,
      is_trade_allowed: true
    });

    for (const url of ['/api/v1/accounts', '/api/v1/accounts/90011087', '/api/v1/overview', '/api/v1/audit']) {
      const response = await server.inject({
        method: 'POST',
        url,
        headers: apiAdminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ status: 'OK' });
    }
  });

  it('serves Go-compatible account detail behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 0.2,
      time: '2026-04-13T07:59:30Z'
    });
    await store.savePositions({
      account_id: '90011087',
      positions: [{ ticket: 123456, symbol: 'XAUUSD', type: 'BUY', lots: 0.1, open_price: 3330, profit: 5.25 }]
    });
    await store.saveAIResult('90011087', 'XAUUSD', { bias: 'bullish', confidence: 82 });
    await store.saveAIResult('90011087', 'GBPJPY', { bias: 'bearish', confidence: 64 });
    await store.recordDecisionEvent({
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
    await store.recordDecisionEvent({
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

  it('returns an error for missing account detail', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/accounts/missing',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).not.toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ERROR' });
  });

  it('serves Go-compatible account decisions behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store });
    await store.recordDecisionEvent({
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
    await store.recordDecisionEvent({
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
    await store.recordDecisionEvent({
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
    const server = await createApiServer({ store });
    // First save without explicit id to create the signal
    await store.savePendingSignal({
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
    expect(await store.getPendingSignals('90011087', 'XAUUSD')).toEqual([]);

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

  it('rejects non-integer arbitration signal id text like Go ParseInt', async () => {
    const server = await createApiServer();

    for (const signalId of ['1.0', '1.5']) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/arbitration/${signalId}`,
        headers: apiAdminHeaders,
        body: { result: 'approved', reason: 'manual ok' }
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid signal_id' });
    }
  });

  it('expires stale pending signals behind admin auth', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:03:00.000Z' });
    // Save signals without explicit ids
    await store.savePendingSignal({
      account_id: '90011087',
      symbol: 'XAUUSD',
      side: 'buy',
      score: 7,
      strategy: 'pullback',
      status: 'pending',
      created_at: '2026-04-13T08:00:00.000Z',
      expires_at: '2026-04-13T08:02:00.000Z'
    });
    await store.savePendingSignal({
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
    expect((await store.getPendingSignals('90011087', 'XAUUSD')).map((signal) => signal.id)).toEqual([2]);
  });

  it('renders /api/v1/audit from persisted shadow state instead of placeholders', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-02T12:05:00.000Z' });

    await store.recordShadowComparison({
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
      replay_coverage: 0,
      last_shadow_event_at: '2026-07-02T12:00:00.000Z',
      missing_capabilities: ['replay_coverage'],
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
        },
        {
          label: 'Replay Coverage',
          value: 'pending',
          detail: 'Replay fixture set has not been scanned yet',
          tone: 'amber'
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
    const server = await createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    await store.recordShadowComparison({
      account_id: '90011087',
      symbol: 'XAUUSD',
      protocol_ok: true,
      signal_drift: false,
      command_drift: true,
      oracle_compared: true,
      source: 'ai_result',
      created_at: '2026-07-03T00:00:00.000Z'
    });
    await store.recordShadowComparison({
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
        replay_coverage: 0,
        last_shadow_event_at: '2026-07-03T00:05:00.000Z',
        missing_capabilities: ['replay_coverage'],
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
          },
          {
            label: 'Replay Coverage',
            value: 'pending',
            detail: 'Replay fixture set has not been scanned yet',
            tone: 'amber'
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
    const server = await createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

    await store.recordShadowComparison({
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
        ready: false,
        protocol_error_rate: 0,
        signal_drift_rate: 0,
        command_drift_rate: 0,
        replay_coverage: 0,
        last_shadow_event_at: '2026-07-03T00:00:00.000Z',
        missing_capabilities: ['replay_coverage'],
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
          },
          {
            label: 'Replay Coverage',
            value: 'pending',
            detail: 'Replay fixture set has not been scanned yet',
            tone: 'amber'
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
        },
        {
          label: 'Replay Coverage',
          value: 'pending',
          detail: 'Replay fixture set has not been scanned yet',
          tone: 'amber'
        }
      ]
    });
  });

  it('records oracle-backed shadow comparisons through POST /shadow/comparisons', async () => {
    const store = createInMemoryEaStore();
    const server = await createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

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
    expect(await store.listShadowComparisons()).toEqual([
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
    await store.saveShadowSnapshot({
      account_id: '90011087',
      symbol: 'XAUUSD',
      source: 'ea_analysis',
      signal: { strategy: 'pullback', side: 'BUY', entry: 3335.7 },
      command: { action: 'SIGNAL', strategy: 'pullback', tp1: 3345 },
      created_at: '2026-07-03T00:00:00.000Z'
    });
    const server = await createAppServer({ store, nowIso: () => '2026-07-03T00:10:00.000Z' });

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
    const server = await createAppServer();

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

  it('exposes an injectable SSE route without a synthetic snapshot frame', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({ account_id: '90011087' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/events/stream',
      headers: apiAdminHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers.connection).toBe('keep-alive');
    expect(response.body).toBe('');
  });

  it('streams live AI result SSE events over HTTP', async () => {
    const store = createInMemoryEaStore();
    const app = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    const httpServer = await app.listen(0, '127.0.0.1');
    const port = (httpServer.address() as AddressInfo).port;
    const stream = await openSseStream(port, `/api/v1/events/stream?token=${fixtureAdminToken}`);

    try {
      expect(stream.response.statusCode).toBe(200);
      expect(stream.response.headers['content-type']).toBe('text/event-stream');
      expect(stream.response.headers['cache-control']).toBe('no-cache');
      expect(stream.response.headers.connection).toBe('keep-alive');

      const framesPromise = collectSseFrames(stream.response, 2);
      const post = await postJson(
        port,
        '/api/ai_result/90011087',
        apiUserHeaders,
        {
          suggested_sl: 0,
          suggested_tp: 0,
          confidence: 64,
          reasoning: 'provider returned no levels'
        }
      );
      expect(post.statusCode).toBe(200);
      expect(JSON.parse(post.body)).toEqual({ status: 'OK', received: true });

      const frames = (await framesPromise).map(parseSseFrame);
      expect(frames[0]).toMatchObject({
        event_id: 'evt_ai_fail_1776067200000000000',
        event_type: 'ai_analysis_failed',
        account_id: '90011087',
        source: 'api.ai_result',
        timestamp: '2026-04-13T08:00:00.000Z',
        payload: {
          suggested_sl: 0,
          suggested_tp: 0,
          confidence: 64,
          reasoning: 'provider returned no levels'
        }
      });
      expect(frames[1]).toMatchObject({
        event_id: 'evt_ai_1776067200000000000',
        event_type: 'ai_result',
        account_id: '90011087',
        source: 'api.ai_result',
        timestamp: '2026-04-13T08:00:00.000Z',
        payload: {
          suggested_sl: 0,
          suggested_tp: 0,
          confidence: 64,
          reasoning: 'provider returned no levels'
        }
      });
    } finally {
      stream.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error != null) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('serves analysis payloads and stores AI results with deterministic risk gates', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
        const body = JSON.parse(response.body) as Record<string, unknown>;
        expect(body).toMatchObject(fixture.response.body as Record<string, unknown>);
        expect(body).not.toHaveProperty('command_status');
        expect(body).toMatchObject({
          risk_gate: { audit_only: false, canProduceLiveCommands: false }
        });
      } else {
        expect(JSON.parse(response.body)).toEqual(fixture.response.body);
      }
    }

    expect(await store.getAIResults('90011087')).toHaveLength(1);
    expect(await store.pollCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'CLOSE_ALL',
        reason: 'AI风险警报(全平): volatility spike'
      })
    ]);
  });

  it('filters analysis payload positions to the requested symbol', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
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

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.body) as { positions: Array<{ ticket: number }> }).positions).toEqual([
      expect.objectContaining({ ticket: 1001 })
    ]);
  });

  it('matches Go-compatible analysis payload position fields and timestamp formatting', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00.000Z' });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 109.8,
      ask: 110,
      time: '2026-04-13T08:00:00.000Z'
    });
    await store.savePositions({
      account_id: '90011087',
      symbol: 'XAUUSD',
      positions: [
        {
          ticket: 1001,
          symbol: 'XAUUSD',
          type: 'buy',
          lots: 1,
          open_price: 100,
          profit: 10,
          open_time: Date.parse('2026-04-13T07:00:00.000Z') / 1000
        },
        {
          ticket: 1002,
          symbol: 'XAUUSD',
          type: 'sell',
          lots: 1,
          open_price: 100,
          profit: 0,
          open_time: Date.parse('2026-04-13T07:58:30.000Z') / 1000
        }
      ]
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      timestamp?: string;
      positions?: Array<Record<string, unknown>>;
    };
    expect(body.timestamp).toBe('2026-04-13T16:00:00+08:00');
    expect(body.positions?.[0]).toMatchObject({
      direction: 'BUY',
      hold_hours: 1,
      hold_seconds: 3600,
      pnl_percent: 10
    });
    expect(body.positions?.[1]).toMatchObject({
      direction: 'SELL',
      hold_hours: 0.02,
      hold_seconds: 90
    });
  });

  it('caps Go-compatible analysis payload bars without changing indicator history count', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00.000Z' });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: flatBars(1001, 2000).map((bar, index) => ({
        ...bar,
        time: `bar-${index}`
      }))
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      bars?: Record<string, Array<{ time?: string }>>;
      indicators?: Record<string, { bars_count?: number } | null>;
    };
    expect(body.bars?.H1).toHaveLength(1000);
    expect(body.bars?.H1?.[0]).toMatchObject({ time: 'bar-1' });
    expect(body.bars?.H1?.at(-1)).toMatchObject({ time: 'bar-1000' });
    expect(body.indicators?.H1).toMatchObject({ bars_count: 1001 });
  });

  it('queues legacy AI close_all risk alerts for EA poll', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
      confidence: 87,
      source: 'ai_risk_alert'
    });
    expect(pollBody.commands[0]).not.toHaveProperty('symbol');
  });

  it('queues legacy AI close_short risk alerts only for matching SELL positions', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    await store.savePositions({
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
        reason: 'AI风险警报(平空): 多周期强bullish共振',
        source: 'ai_risk_alert'
      });
      expect(String(command.command_id)).toMatch(/^ai_close_1776067200000000000_\d+$/);
    }
  });

  it('queues accepted V2 AI risk commands with trade-plan metadata', async () => {
    const store = createInMemoryEaStore();
    const events = createSseHub<SseEvent>();
    const publishedEvents: SseEvent[] = [];
    events.subscribe((event) => publishedEvents.push(event));
    const server = await createApiServer({ store, events, nowIso: () => '2026-04-13T16:00:00+08:00' });
    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
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
    expect(publishedEvents).toContainEqual(
      expect.objectContaining({
        event_id: 'evt_ai_1776067200000000000',
        event_type: 'ai_result',
        account_id: '90011087',
        source: 'api.ai_result',
        timestamp: '2026-04-13T08:00:00.000Z',
        payload: expect.objectContaining({
          trade_plan_summary: {
            decision_id: 'tpv1_close_all',
            mode: 'close',
            symbol: 'XAUUSD',
            confidence: 87
          },
          risk_gate: expect.objectContaining({ status: 'accepted' })
        })
      })
    );
    expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toEqual([
      expect.objectContaining({
        decision_id: 'tpv1_close_all',
        stage: 'command_enqueued',
        status: 'pending',
        reason_codes: ['command.CLOSE_ALL', 'source.ai_risk_alert'],
        summary: expect.objectContaining({ action: 'CLOSE_ALL' })
      }),
      expect.objectContaining({
        decision_id: 'tpv1_close_all',
        stage: 'risk_gate',
        status: 'accepted',
        reason_codes: ['action.audit_safe'],
        summary: expect.objectContaining({ status: 'accepted', mode: 'close', symbol: 'XAUUSD' })
      }),
      expect.objectContaining({
        decision_id: 'tpv1_close_all',
        stage: 'ai_result',
        status: 'accepted',
        reason_codes: ['mode.close', 'risk.high'],
        summary: expect.objectContaining({ mode: 'close', symbol: 'XAUUSD', confidence: 87 })
      })
    ]);

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
      source: 'ai_risk_alert',
      decision_id: 'tpv1_close_all',
      trade_plan_mode: 'close',
      risk_gate: { status: 'accepted' }
    });
    expect(pollBody.commands[0]).not.toHaveProperty('symbol');
  });

  it('does not queue V2 AI risk commands when the trade-plan risk gate rejects', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: false,
      is_trade_allowed: true
    });
    await store.saveTick({
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

  it('does not queue live commands for accepted AI approve plans in shadow mode', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'shadow');
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });
    await seedAIApproveTrendBars(store);

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
          execution_type: 'market',
          requested_order_type: 'market',
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
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      command_status: 'shadow_only',
      risk_gate: { status: 'accepted', audit_only: false, canProduceLiveCommands: false }
    });
    expect(await store.listCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'SIGNAL',
        source: 'ai_approve',
        status: 'shadow_only',
        decision_id: 'tpv1_shadow_mode',
        type: 'BUY'
      })
    ]);
    expect(await store.pollCommands('90011087')).toEqual([]);
    expect(await store.listShadowComparisons()).toEqual([
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ai_result',
        command_drift: false
      })
    ]);
    expect(await store.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ai_result')).toEqual(
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ai_result',
        command: expect.objectContaining({
          decision_id: 'tpv1_shadow_mode',
          status: 'shadow_only',
          risk_gate: expect.objectContaining({ audit_only: false, canProduceLiveCommands: false })
        })
      })
    );
  });

  it('queues confidence 65 accepted AI approve plans for cutover accounts', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    // 用真实时钟锚定 nowIso：persistence pollCommands 以真实墙钟判定 ai_approve 命令
    // 的 4 小时投递 TTL（helpers.ts isRuntimeCommandExpired），固定历史 nowIso 会让
    // created_at 永远早于真实 now-4h，命令在 poll 时被判定过期而拿不到。
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const server = await createApiServer({ store, nowIso: () => nowIso });

    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: new Date(nowMs - 30_000).toISOString()
    });
    await seedAIApproveTrendBars(store);

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
          execution_type: 'market',
          requested_order_type: 'market',
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 65,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy'],
          narrative: 'cutover mode may queue after deterministic and pending gates'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      command_status: 'queued',
      risk_gate: { status: 'accepted', audit_only: false, canProduceLiveCommands: false }
    });
    expect(await store.listCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'SIGNAL',
        source: 'ai_approve',
        status: 'queued',
        decision_id: 'tpv1_cutover_mode',
        type: 'BUY',
        confidence: 65,
        score: 65
      })
    ]);
    expect(await store.pollCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'SIGNAL',
        source: 'ai_approve',
        decision_id: 'tpv1_cutover_mode',
        type: 'BUY',
        confidence: 65,
        score: 65
      })
    ]);
  });

  it('records a queue skip event for confidence 64 accepted AI approve plans', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: '2026-04-13T15:59:30+08:00'
    });
    await seedAIApproveTrendBars(store);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        trade_plan: {
          schema_version: 'trade_plan.v1',
          decision_id: 'tpv1_low_confidence',
          account_id: '90011087',
          symbol: 'XAUUSD',
          mode: 'approve',
          side: 'buy',
          entry_zone: { min: 3335.5, max: 3335.7 },
          execution_type: 'market',
          requested_order_type: 'market',
          stop_loss: 3330,
          take_profit: [3345],
          max_lots: 0.1,
          confidence: 64,
          expires_at: '2099-06-06T09:15:00Z',
          reason_codes: ['mode.approve', 'side.buy'],
          narrative: 'otherwise valid approve below live confidence threshold'
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      risk_gate: { status: 'accepted', audit_only: false, canProduceLiveCommands: false }
    });
    expect(JSON.parse(response.body)).not.toHaveProperty('command_status');
    expect(await store.listCommands('90011087')).toEqual([]);
    expect(await store.pollCommands('90011087')).toEqual([]);
    expect(await store.listDecisionEvents({ account_id: '90011087', symbol: 'XAUUSD' })).toContainEqual(
      expect.objectContaining({
        decision_id: 'tpv1_low_confidence',
        stage: 'risk_gate',
        status: 'rejected',
        reason_codes: ['pending_gate.queue_skip.confidence_below_min'],
        summary: expect.objectContaining({
          pending_gate_reason: 'queue_skip.confidence_below_min',
          mode: 'approve',
          symbol: 'XAUUSD'
        })
      })
    );
  });

  for (const stopIntent of [
    {
      side: 'buy',
      requestedOrderType: 'BUY_STOP',
      entry: 3338,
      stopLoss: 3332,
      takeProfit: 3350,
      narrative: 'breakout chase disabled'
    },
    {
      side: 'sell',
      requestedOrderType: 'SELL_STOP',
      entry: 3332,
      stopLoss: 3338,
      takeProfit: 3320,
      narrative: 'breakdown chase disabled'
    }
  ] as const) {
    it(`does not queue AI approve ${stopIntent.requestedOrderType} intent in cutover mode`, async () => {
      const store = createInMemoryEaStore();
      await store.setRuntimeMode('90011087', 'cutover');
      const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

      await store.saveRegistration({ account_id: '90011087', leverage: 500 });
      await store.saveHeartbeat({
        account_id: '90011087',
        equity: 10000,
        free_margin: 9000,
        market_open: true,
        is_trade_allowed: true
      });
      await store.saveTick({
        account_id: '90011087',
        symbol: 'XAUUSD',
        bid: 3335.5,
        ask: 3335.7,
        spread: 0.2,
        time: '2026-04-13T15:59:30+08:00'
      });
      await seedAIApproveTrendBars(store);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v2/ai_result/90011087/XAUUSD',
        headers: apiUserHeaders,
        body: {
          trade_plan: {
            schema_version: 'trade_plan.v1',
            decision_id: `tpv1_${stopIntent.requestedOrderType.toLowerCase()}_disabled`,
            account_id: '90011087',
            symbol: 'XAUUSD',
            mode: 'approve',
            side: stopIntent.side,
            entry_zone: { min: stopIntent.entry, max: stopIntent.entry },
            execution_type: 'stop',
            requested_order_type: stopIntent.requestedOrderType,
            stop_loss: stopIntent.stopLoss,
            take_profit: [stopIntent.takeProfit],
            max_lots: 0.1,
            confidence: 80,
            expires_at: '2099-06-06T09:15:00Z',
            reason_codes: ['mode.approve', `side.${stopIntent.side}`, `order.${stopIntent.requestedOrderType}`],
            narrative: stopIntent.narrative
          }
        }
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        status: 'OK',
        received: true,
        risk_gate: { status: 'accepted' }
      });
      expect(body).not.toHaveProperty('command_status');
      expect(await store.listCommands('90011087')).toEqual([]);
      expect(await store.pollCommands('90011087')).toEqual([]);
    });
  }

  it('queues the first valid dual AI approve plan and keeps the Go symbol cooldown behavior', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    // 同上：/poll 投递走 persistence 真实墙钟 + ai_approve 4h TTL，nowIso 需锚定真实时间。
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const server = await createApiServer({ store, nowIso: () => nowIso });

    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.5,
      ask: 3335.7,
      spread: 0.2,
      time: new Date(nowMs - 30_000).toISOString()
    });
    await seedAIApproveTrendBars(store);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v2/ai_result/90011087/XAUUSD',
      headers: apiUserHeaders,
      body: {
        dual_trade_plan: {
          is_dual_direction: true,
          buy: dualTradePlanSide('tpv1_dual_buy', 'buy', 3335.5, 3335.7),
          sell: dualTradePlanSide('tpv1_dual_sell', 'sell', 3335.5, 3335.7)
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'OK', received: true });
    expect(await store.listCommands('90011087')).toEqual([
      expect.objectContaining({
        action: 'SIGNAL',
        source: 'ai_approve',
        status: 'queued',
        decision_id: 'tpv1_dual_buy',
        type: 'BUY'
      })
    ]);

    const pollBody = JSON.parse((await server.inject({
      method: 'POST',
      url: '/poll',
      headers: apiUserHeaders,
      body: { account_id: '90011087' }
    })).body) as { count: number; commands: Array<Record<string, unknown>> };
    expect(pollBody.count).toBe(1);
    expect(pollBody.commands[0]).toMatchObject({
      action: 'SIGNAL',
      source: 'ai_approve',
      strategy: 'ai_signal',
      decision_id: 'tpv1_dual_buy',
      type: 'BUY'
    });
  });

  it('returns rejected AI approve risk gates without queueing poll commands', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({ account_id: '90011087', leverage: 500 });
    await store.saveHeartbeat({
      account_id: '90011087',
      equity: 10000,
      free_margin: 9000,
      market_open: false,
      is_trade_allowed: true
    });
    await store.saveTick({
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
      audit_only: false,
      status: 'rejected',
      reason_codes: ['market.closed']
    });
    expect(body.risk_gate?.canProduceLiveCommands).toBe(false);
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('returns Go-style invalid trade_plan validation without decision or risk gate', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects empty and array AI result bodies like the Go decoder', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    for (const body of ['', []]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/ai_result/90011087',
        headers: apiUserHeaders,
        body
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ status: 'ERROR', message: 'invalid JSON' });
    }
    expect(await store.getAIResults('90011087')).toEqual([]);
  });

  it('accepts empty AI result objects like the Go decoder', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai_result/90011087',
      headers: apiUserHeaders,
      body: {}
    });

    expect(response.statusCode).toBe(200);
    expect(await store.getAIResults('90011087')).toEqual([expect.objectContaining({ account_id: '90011087', symbol: 'XAUUSD' })]);
  });

  it('rejects trade_plan fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects top-level numeric trade_plan fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects take_profit arrays whose element types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects reason_codes arrays whose element types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects add_on values whose JSON type does not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects entry_zone fields whose JSON types do not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('rejects expires_at values whose JSON type does not match Go decoding', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('builds analysis payload indicators and trend context from Node snapshot bars', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({
      account_id: '90011087',
      broker: 'Demo Broker',
      server_name: 'Demo-1',
      currency: 'USD',
      leverage: 500
    });
    await store.saveHeartbeat({
      account_id: '90011087',
      balance: 1000.5,
      equity: 1100.25,
      margin: 100,
      free_margin: 1000.25,
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 1999.8,
      ask: 2000,
      spread: 0.2,
      time: '16:00:00'
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: flatBars(25, 2000)
    });
    await store.saveBars({
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
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
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

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({ account_id: '90011087', market_open: true, is_trade_allowed: true });
    await store.saveTick({ account_id: '90011087', symbol: 'XAUUSD', bid: 2199.8, ask: 2200, spread: 0.2 });
    await store.saveBars({
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
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });
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

    await store.saveRegistration({
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
    // '20250237': 'momentum_scalp' 不再透传：d888a5d 禁用 momentum_scalp（日内策略聚焦），
    // 已从 ALLOWED_STRATEGY_MAPPING_KEYS 移除，注册时携带也会被过滤（同 '20259999' 未知键）。
    expect(body.strategy_mapping).toEqual({
      '20250231': 'pullback',
      '20250232': 'breakout_retest',
      '20250233': 'divergence',
      '20250234': 'breakout_pyramid',
      '20250235': 'counter_pullback',
      '20250236': 'range',
      '20250238': 'ai_signal'
    });
  });

  it('defaults analysis payload strategy mapping to all approved EA strategies', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T16:00:00+08:00' });

    await store.saveRegistration({ account_id: '90011087' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { strategy_mapping?: Record<string, string> };
    // 默认映射不含 '20250237': 'momentum_scalp'：d888a5d 禁用该策略后已从 DEFAULT_STRATEGY_MAPPING 移除。
    expect(body.strategy_mapping).toEqual({
      '20250231': 'pullback',
      '20250232': 'breakout_retest',
      '20250233': 'divergence',
      '20250234': 'breakout_pyramid',
      '20250235': 'counter_pullback',
      '20250236': 'range',
      '20250238': 'ai_signal'
    });
  });

  it('builds analysis payload market filters from Node snapshots', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-06-05T20:45:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 8.2,
      time: '2026-06-05T20:44:50.000Z'
    });
    await store.saveBars({
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

  it('uses heartbeat max_spread in analysis payload when tick has not reported it yet', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-06-04T13:00:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      max_spread: 25
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 21,
      time: '2026-06-04T12:59:50.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market?: { max_spread?: number };
      market_filters?: { blocked?: boolean; reason_codes?: string[] };
    };
    expect(body.market?.max_spread).toBe(25);
    expect(body.market_filters?.reason_codes).not.toContain('spread.too_wide');
    expect(body.market_filters?.blocked).toBe(false);
  });

  it('marks analysis market status untradeable when the latest tick is stale', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-06-04T13:00:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.06.04 13:00',
      last_heartbeat_at: '2026-06-04T13:00:00.000Z',
      updated_at: '2026-06-04T13:00:00.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3335.55,
      ask: 3335.75,
      spread: 0.2,
      time: '12:44:30',
      received_at: '2026-06-04T12:44:30.000Z',
      updated_at: '2026-06-04T12:44:30.000Z'
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
        tick_age_ms?: number;
      };
    };
    // market_filters.tick.stale 仍是 riskgate 2 分钟门禁（用 EA wall-clock），与 market_status 15m 接收时钟 TTL 分离。
    expect(body.market_status).toMatchObject({
      market_open: false,
      is_trade_allowed: false,
      mt4_server_time: '2026.06.04 13:00',
      tradeable: false,
      stale: true,
      stale_reason: 'tick_stale'
    });
    expect(body.market_status?.tick_age_ms).toBeGreaterThan(15 * 60 * 1000);
  });

  it('keeps analysis market status tradeable when receive timestamps are fresh', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-07T02:53:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 02:53',
      last_heartbeat_at: '2026-07-07T02:52:50.000Z',
      updated_at: '2026-07-07T02:52:50.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.05,
      ask: 4162.28,
      spread: 23,
      time: '02:52:52',
      received_at: '2026-07-07T02:52:52.000Z',
      updated_at: '2026-07-07T02:52:52.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        mt4_server_time?: string;
        tradeable?: boolean;
      };
    };
    expect(body.market_status).toMatchObject({
      market_open: true,
      is_trade_allowed: true,
      mt4_server_time: '2026.07.07 02:53',
      tradeable: true,
      stale: false
    });
  });

  it('does not treat MT4 server wall-clock offset as stale when receive timestamps are fresh', async () => {
    // Production bug: host TZ parses MT4 "2026.07.20 02:09" as local CST → ~5h behind UTC nowIso.
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-19T23:10:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.20 02:09',
      last_heartbeat_at: '2026-07-19T23:09:50.000Z',
      updated_at: '2026-07-19T23:09:50.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 3993.79,
      ask: 3994.03,
      spread: 24,
      time: '02:09:30',
      received_at: '2026-07-19T23:09:55.000Z',
      updated_at: '2026-07-19T23:09:55.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        tradeable?: boolean;
        stale?: boolean;
        tick_age_ms?: number;
        heartbeat_age_ms?: number;
      };
    };
    expect(body.market_status).toMatchObject({
      market_open: true,
      is_trade_allowed: true,
      tradeable: true,
      stale: false
    });
    expect(body.market_status?.tick_age_ms).toBeLessThan(60 * 1000);
    expect(body.market_status?.heartbeat_age_ms).toBeLessThan(60 * 1000);
  });

  it('keeps analysis market status tradeable for legacy EA time-only tick timestamps without receive stamp', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-07T02:53:00+08:00' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 02:53'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.05,
      ask: 4162.28,
      spread: 23,
      time: '02:52:52'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        mt4_server_time?: string;
        tradeable?: boolean;
      };
    };
    expect(body.market_status).toMatchObject({
      market_open: true,
      is_trade_allowed: true,
      mt4_server_time: '2026.07.07 02:53',
      tradeable: true,
      stale: false
    });
  });

  it('rolls time-only analysis tick timestamps over to the previous server date near midnight', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-07T00:12:00+08:00' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 00:12'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.05,
      ask: 4162.28,
      spread: 23,
      time: '23:59:00'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        mt4_server_time?: string;
        tradeable?: boolean;
        tick_age_ms?: number;
      };
    };
    expect(body.market_status).toMatchObject({
      market_open: true,
      is_trade_allowed: true,
      mt4_server_time: '2026.07.07 00:12',
      tradeable: true,
      stale: false
    });
    expect(body.market_status?.tick_age_ms).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('marks analysis market status untradeable when heartbeat is stale even if tick looks fresh', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-07-07T03:00:00.000Z' });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 03:00',
      last_heartbeat_at: '2026-07-07T02:30:00.000Z',
      updated_at: '2026-07-07T02:30:00.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.05,
      ask: 4162.28,
      spread: 23,
      time: '02:59:30',
      received_at: '2026-07-07T02:59:30.000Z',
      updated_at: '2026-07-07T02:59:30.000Z'
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      market_status?: {
        market_open?: boolean;
        is_trade_allowed?: boolean;
        tradeable?: boolean;
        stale?: boolean;
        stale_reason?: string;
        heartbeat_age_ms?: number;
      };
    };
    expect(body.market_status).toMatchObject({
      market_open: false,
      is_trade_allowed: false,
      tradeable: false,
      stale: true,
      stale_reason: 'heartbeat_stale'
    });
    expect(body.market_status?.heartbeat_age_ms).toBeGreaterThan(15 * 60 * 1000);
  });

  it('restores tradeable market status after fresh heartbeat and tick replace stale data', async () => {
    const store = createInMemoryEaStore();
    let now = '2026-07-07T03:20:00.000Z';
    const server = await createApiServer({ store, nowIso: () => now });

    await store.saveRegistration({ account_id: '90011087' });
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 02:40',
      last_heartbeat_at: '2026-07-07T02:40:00.000Z',
      updated_at: '2026-07-07T02:40:00.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.05,
      ask: 4162.28,
      spread: 23,
      time: '02:40:00',
      received_at: '2026-07-07T02:40:00.000Z',
      updated_at: '2026-07-07T02:40:00.000Z'
    });

    const staleResponse = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });
    expect(staleResponse.statusCode).toBe(200);
    expect(JSON.parse(staleResponse.body).market_status).toMatchObject({
      market_open: false,
      tradeable: false,
      stale: true
    });

    now = '2026-07-07T03:21:00.000Z';
    await store.saveHeartbeat({
      account_id: '90011087',
      market_open: true,
      is_trade_allowed: true,
      server_time: '2026.07.07 03:21',
      last_heartbeat_at: '2026-07-07T03:20:50.000Z',
      updated_at: '2026-07-07T03:20:50.000Z'
    });
    await store.saveTick({
      account_id: '90011087',
      symbol: 'XAUUSD',
      bid: 4162.15,
      ask: 4162.38,
      spread: 23,
      time: '03:20:55',
      received_at: '2026-07-07T03:20:55.000Z',
      updated_at: '2026-07-07T03:20:55.000Z'
    });

    const freshResponse = await server.inject({
      method: 'GET',
      url: '/api/analysis_payload/90011087',
      headers: apiUserHeaders
    });
    expect(freshResponse.statusCode).toBe(200);
    expect(JSON.parse(freshResponse.body).market_status).toMatchObject({
      market_open: true,
      is_trade_allowed: true,
      tradeable: true,
      stale: false
    });
  });


  it('serves trading-core analysis from Node snapshots without enqueueing commands', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-13T08:00:00Z' });
    const snapshot = readReplayFixture('account_90011087_snapshot.json');
    const register = readFixture('register');
    // Gold Fib gates pullback entries (b4e23e6 分品种配置)；与 engine.spec.ts 的 oracle 测试一致，
    // 把 fixture 的 Fib 口袋钉在 Go 期望入场附近，否则价格不在自动计算的回撤区会被过滤。
    const lastH1Bar = snapshot.bars.H1.at(-1);
    if (lastH1Bar) {
      Object.assign(lastH1Bar, {
        fib_382: 3350,
        fib_618: 3320,
        fib_786: 3334.93
      });
    }

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
    expect(body.replay?.signal).toBeNull();
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
        },
        {
          level: 'warn',
          strategy: 'R:R过滤',
          msg: '⚠️ 信号 R:R=0.875 < 1.25 拒绝 ⏭'
        }
      ])
    );
    // 69b8d37 引入阶梯锁盈：浮盈 ≥2.0ATR 时保本升级为 lock_l1（SL = open + 0.3*ATR），
    // 此仓位浮盈约 2.2ATR，故不再是 breakeven@3330 而是 lock_l1@≈3330.80。
    expect(body.replay?.position_commands).toEqual([
      expect.objectContaining({ action: 'MODIFY', ticket: 777, new_sl: expect.closeTo(3330.8, 1), reason: 'lock_l1_2.2ATR' }),
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
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('uses the latest H1 close for trading-core analysis when no current tick exists', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store, nowIso: () => '2026-04-16T12:00:00.000Z' });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      bars: pullbackBuyBars()
    });
    // XAUUSD 走 gold 分品种配置（b4e23e6），pullback 需要 H4 数据做 Fib 趋势确认，
    // 缺 H4 会直接被 "pullback+FIB: H4数据不足" 过滤；补一段 H4 多头 bars 让信号合法通过。
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'H4',
      bars: Array.from({ length: 5 }, (_, index) => ({
        time: `2026-04-15T${String(index).padStart(2, '0')}:00:00.000Z`,
        open: 90 + index,
        high: 100 + index,
        low: 88 + index,
        close: 95 + index,
        adx: 30,
        ema20: 110,
        ema50: 100
      }))
    });
    await store.saveBars({
      account_id: '90011087',
      symbol: 'XAUUSD',
      timeframe: 'D1',
      bars: d1TrendBars()
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/analysis/90011087/XAUUSD/trading-core',
      headers: apiUserHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      replay?: { signal?: { strategy?: string; side?: string; entry?: number; score?: number } | null };
    };
    expect(body.replay?.signal).toMatchObject({
      strategy: 'pullback',
      side: 'BUY',
      entry: 95,
      // 8 → 9：基础分 9 + Fib 汇合 +1 = 10，再被多周期共识弱势 -1（1ffbea7 起趋势评级
      // 门槛从 D1 改为 H4，且 D1 已退出共识计算）。与 engine.spec.ts 同类 fixture 的期望一致。
      score: 9
    });
  });

  it('POST /api/trade_history 保存已平仓成交并聚合策略胜率', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store });

    const response = await server.inject({
      method: 'POST',
      url: '/api/trade_history',
      headers: apiUserHeaders,
      body: {
        trades: [
          {
            account_id: fixtureAccountId,
            ticket: 1001,
            magic: 20250231,
            symbol: 'XAUUSD',
            side: 'BUY',
            open_price: 3300,
            close_price: 3310,
            lots: 0.01,
            profit: 10,
            open_time: '2026.07.25 10:00:00',
            close_time: '2026.07.25 11:30:00'
          },
          {
            account_id: fixtureAccountId,
            ticket: 1002,
            magic: 20250231,
            symbol: 'XAUUSD',
            side: 'SELL',
            open_price: 3310,
            close_price: 3315,
            lots: 0.01,
            profit: -5,
            open_time: '2026.07.25 12:00:00',
            close_time: '2026.07.25 12:30:00'
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'OK', saved: 2 });

    const stats = await store.getClosedTradeStats(fixtureAccountId);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      total: 2,
      wins: 1,
      losses: 1,
      win_rate: 0.5,
      total_profit: 5
    });
  });

  it('POST /api/trade_history 从 MT 时间格式计算持仓时长并按 ticket 幂等去重', async () => {
    const store = createInMemoryEaStore();
    const server = await createApiServer({ store });
    const trade = {
      account_id: fixtureAccountId,
      ticket: 2001,
      magic: 20250231,
      symbol: 'XAUUSD',
      side: 'BUY',
      open_price: 3300,
      close_price: 3306,
      lots: 0.01,
      profit: 6,
      open_time: '2026.07.25 10:00:00',
      close_time: '2026.07.25 11:30:00'
    };

    await server.inject({ method: 'POST', url: '/api/trade_history', headers: apiUserHeaders, body: { trades: [trade] } });
    // 同一 ticket 重复上报（EA 重启后水位线归零）不应产生重复行
    await server.inject({ method: 'POST', url: '/api/trade_history', headers: apiUserHeaders, body: { trades: [trade] } });

    const stats = await store.getClosedTradeStats(fixtureAccountId);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.total).toBe(1);
    expect(stats[0]?.avg_duration_min).toBe(90);
  });

  it('POST /api/trade_history 拒绝无效 token', async () => {
    const server = await createApiServer({ store: createInMemoryEaStore() });
    const response = await server.inject({
      method: 'POST',
      url: '/api/trade_history',
      headers: { 'X-API-Token': 'bogus-token' },
      body: { trades: [] }
    });
    expect(response.statusCode).toBe(401);
  });
});
