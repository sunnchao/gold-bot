import { readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EA_COMPAT_ENDPOINTS, isEaCompatEndpoint, isEaStrategyName, type HeaderMap } from '@gold-bot/shared-contracts';
import { createInMemoryEaStore, persistenceStatus, type CommandCandidate, type EaRecord, type EaStore, type StoredCommand } from '@gold-bot/persistence';
import {
  adx,
  atr,
  bollinger,
  calculateFibExtension,
  ema,
  evaluateMarketFilters,
  evaluateRiskGate,
  fibonacci,
  macd,
  pivotPoints,
  rsi,
  runReplay,
  stoch,
  summarizePositions,
  type PositionManagerPosition
} from '@gold-bot/trading-core';
import { buildShadowReport, formatSseFrame } from '@gold-bot/observability';
import { type JsonResponse } from './http/response.js';
import { parseJsonObject } from './http/json.js';
import { requireRouteToken } from './middleware/auth.js';
import { handleEaRoute as routeEa } from './routes/ea.js';
import { handleAdminRoute as routeAdmin, type ApiTokenRecord } from './routes/admin.js';
import { handleAIRoute as routeAI } from './routes/ai.js';
import { createIndicatorAlertCache, handleIndicatorAlertRoute as routeIndicatorAlert, type IndicatorAlertCache } from './routes/indicator-alert.js';
import { handleVisualRoute as routeVisual } from './routes/visual.js';
import { AnalysisService } from './services/analysis/service.js';
import { CommandLifecycleService } from './services/command-lifecycle/service.js';
import { SchedulerService } from './services/scheduler/service.js';
import { ShadowService } from './services/shadow/service.js';
import type { RuntimeMode } from '@gold-bot/shared-contracts';

export type InjectRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type InjectResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type AppServerOptions = {
  store?: EaStore;
  nowUnix?: () => number;
  nowIso?: () => string;
  validTokens?: readonly string[];
  tokenAccounts?: Record<string, readonly string[]>;
  adminTokens?: readonly string[];
  defaultRuntimeMode?: RuntimeMode;
  releaseRoot?: string;
};

type AppServerDeps = {
  store: EaStore;
  nowUnix: () => number;
  nowIso: () => string;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
  tokenRecords: Map<string, ApiTokenRecord>;
  releaseRoot: string;
  alerts: IndicatorAlertCache;
  commandLifecycle: CommandLifecycleService;
  scheduler: SchedulerService;
  shadow: ShadowService;
};

type EaReleaseInfo = {
  version: string;
  build: number;
  changelog: string;
};

const ALLOWED_STRATEGY_MAPPING_KEYS = ['20250231', '20250232', '20250233', '20250234', '20250235', '20250236', '20250237', '20250238'] as const;
const DEFAULT_RELEASE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const DEFAULT_STRATEGY_MAPPING: EaRecord = {
  '20250231': 'pullback',
  '20250232': 'breakout_retest',
  '20250233': 'divergence',
  '20250234': 'breakout_pyramid',
  '20250235': 'counter_pullback',
  '20250236': 'range',
  '20250237': 'momentum_scalp',
  '20250238': 'ai_signal'
};

const VALID_TRADE_PLAN_MODES = new Set(['observe', 'veto', 'approve', 'modify', 'reduce', 'close']);
const VALID_TRADE_PLAN_SIDES = new Set(['buy', 'sell', 'none']);
const AI_RISK_EXIT_SUGGESTIONS = new Set(['close_partial', 'close_all', 'close_short']);

export function createAppServer(options: AppServerOptions = {}) {
  const nowUnix = options.nowUnix ?? (() => Math.floor(Date.now() / 1000));
  const store = options.store ?? createInMemoryEaStore();
  const storedTokens = store.listApiTokens();
  const validTokens = options.validTokens == null && storedTokens.length === 0
    ? null
    : new Set([...(options.validTokens ?? []), ...storedTokens.map((record) => record.token)]);
  const adminTokens = new Set([
    ...(options.adminTokens ?? []),
    ...storedTokens.filter((record) => record.is_admin).map((record) => record.token)
  ]);
  const tokenAccounts = validTokens == null
    ? null
    : tokenAccountMap(options.tokenAccounts ?? Object.fromEntries(Array.from(validTokens, (token) => [token, []])));
  for (const record of storedTokens) {
    tokenAccounts?.set(record.token, new Set(record.accounts));
  }
  const tokenRecords = bootstrapTokenRecords(validTokens, tokenAccounts, adminTokens);
  for (const record of storedTokens) {
    tokenRecords.set(record.token, {
      token: record.token,
      name: record.name,
      accounts: record.accounts,
      isAdmin: record.is_admin
    });
  }
  const baseDeps = {
    store,
    nowUnix,
    nowIso: options.nowIso ?? (() => new Date().toISOString()),
    validTokens,
    tokenAccounts,
    adminTokens,
    tokenRecords,
    releaseRoot: options.releaseRoot ?? DEFAULT_RELEASE_ROOT,
    alerts: createIndicatorAlertCache(() => nowUnix() * 1000)
  };
  const shadow = new ShadowService(baseDeps.store, baseDeps.nowIso);
  const analysis = new AnalysisService(baseDeps.store, baseDeps.nowIso);
  const commandLifecycle = new CommandLifecycleService(baseDeps.store, options.defaultRuntimeMode ?? 'oracle', shadow);
  const scheduler = new SchedulerService(analysis, commandLifecycle, shadow);
  const deps: AppServerDeps = {
    ...baseDeps,
    commandLifecycle,
    scheduler,
    shadow
  };
  const appHandler = (req: IncomingMessage, res: ServerResponse): void => {
    void handleHttpRequest(req, res, deps);
  };

  return {
    handler: appHandler,
    listen(port: number, host: string) {
      const server = createServer(appHandler);
      return new Promise<typeof server>((resolve) => {
        server.listen(port, host, () => resolve(server));
      });
    },
    inject(request: InjectRequest): Promise<InjectResponse> {
      return injectHandler(request, deps);
    }
  };
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse, deps: AppServerDeps): Promise<void> {
  const response = await routeRequest(
    {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers,
      rawBody: await readRawBody(req)
    },
    deps
  );
  writeResponse(res, response);
}

async function routeRequest(
  request: {
    method: string;
    url: string;
    headers: HeaderMap;
    rawBody: string;
  },
  deps: AppServerDeps
): Promise<JsonResponse> {
  const method = request.method;
  const path = new URL(request.url, 'http://localhost').pathname;

  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: null, rawBody: 'ok' };
  }

  if (method === 'GET' && path === '/metrics') {
    return prometheusMetricsResponse();
  }

  if (path === '/api/ea/version') {
    return eaVersionResponse(deps.releaseRoot);
  }

  if (path === '/version_check') {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    return eaVersionCheckResponse(deps.releaseRoot);
  }

  if (path === '/api/ea/download') {
    const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
    if (tokenResult.response != null) {
      return tokenResult.response;
    }
    return eaDownloadResponse(deps.releaseRoot);
  }

  if (isEaCompatEndpoint(path)) {
    return routeEa(
      {
        method,
        path,
        headers: request.headers,
        url: request.url,
        rawBody: request.rawBody
      },
      {
        store: deps.store,
        nowUnix: deps.nowUnix,
        nowIso: deps.nowIso,
        validTokens: deps.validTokens,
        tokenAccounts: deps.tokenAccounts,
        adminTokens: deps.adminTokens,
        onBarsSaved: (accountId, symbol) => deps.scheduler.enqueueAnalysis(accountId, symbol),
        onPositionsSaved: (accountId, symbol) => deps.scheduler.enqueuePositionReview(accountId, symbol),
        onOrderResult: (accountId, commandId, result, ticket, errorText, createdAt) => deps.commandLifecycle.reconcile(accountId, commandId, result, ticket, errorText, createdAt),
      },
      {
        stringFieldOrEmpty,
        symbolOrDefault,
        validateEaPayload
      }
    );
  }

  if (method === 'GET' && path === '/__contracts') {
    return {
      statusCode: 200,
      body: {
      status: 'OK',
      phase: 1,
        ea_endpoints: EA_COMPAT_ENDPOINTS,
        persistence: persistenceStatus
      }
    };
  }

  if (method === 'GET' && path === '/shadow/metrics') {
    return {
      statusCode: 200,
      body: deps.shadow.metrics()
    };
  }

  if (method === 'GET' && path === '/shadow/qualification') {
    return {
      statusCode: 200,
      body: deps.shadow.qualification()
    };
  }

  if (path === '/indicator_alert/store' || path === '/indicator_alert/poll') {
    return routeIndicatorAlert(
      {
        method,
        path,
        headers: request.headers,
        url: request.url,
        rawBody: request.rawBody
      },
      {
        validTokens: deps.validTokens,
        alerts: deps.alerts
      }
    );
  }

  if (path === '/visual/poll') {
    return routeVisual(
      {
        method,
        path,
        headers: request.headers,
        url: request.url,
        rawBody: request.rawBody
      },
      {
        store: deps.store,
        nowIso: deps.nowIso,
        validTokens: deps.validTokens,
        tokenAccounts: deps.tokenAccounts,
        adminTokens: deps.adminTokens,
        alerts: deps.alerts
      }
    );
  }

  if (method === 'POST' && path === '/shadow/comparisons') {
    const parsed = parseJsonObject(request.rawBody);
    if (!parsed.ok) {
      return {
        statusCode: 400,
        body: { status: 'ERROR', message: 'invalid JSON' }
      };
    }
    const accountId = stringFieldOrEmpty(parsed.body, 'account_id').trim();
    const symbol = stringFieldOrEmpty(parsed.body, 'symbol').trim();
    const source = stringFieldOrEmpty(parsed.body, 'source').trim();
    const node = recordField(parsed.body, 'node');
    const oracle = recordField(parsed.body, 'oracle');
    if (accountId.length === 0 || symbol.length === 0 || oracle == null) {
      return {
        statusCode: 400,
        body: { status: 'ERROR', message: 'invalid shadow comparison payload' }
      };
    }
    try {
      const comparison = deps.shadow.recordOracleComparison({
        account_id: accountId,
        symbol,
        source: source === 'position_review' || source === 'ai_result' ? source : 'ea_analysis',
        ...(typeof parsed.body.protocol_ok === 'boolean' ? { protocol_ok: parsed.body.protocol_ok } : {}),
        created_at: stringFieldOrEmpty(parsed.body, 'created_at') || undefined,
        ...(node == null
          ? {}
          : {
              node: {
                signal: recordField(node, 'signal'),
                command: recordField(node, 'command')
              }
            }),
        oracle: {
          signal: recordField(oracle, 'signal'),
          command: recordField(oracle, 'command')
        }
      });
      return {
        statusCode: 200,
        body: {
          status: 'OK',
          comparison
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid shadow comparison payload';
      const statusCode = message === 'shadow runtime snapshot not found' ? 404 : 400;
      return {
        statusCode,
        body: { status: 'ERROR', message }
      };
    }
  }

  if (path.startsWith('/api/')) {
    if (path.includes('/analysis_payload/') || path.includes('/ai_result/')) {
      return routeAI(
        {
          method,
          path,
          headers: request.headers,
          url: request.url,
          rawBody: request.rawBody
        },
        deps,
        {
          analysisPayload,
          handleAIResultRoute
        }
      );
    }
    return routeAdmin(
      {
        method,
        path,
        headers: request.headers,
        url: request.url,
        rawBody: request.rawBody
      },
      deps,
      {
        tradingCoreAnalysis,
        accountDetail,
        accountSummaries,
        overviewCards,
        buildAuditBody,
        eventStreamSnapshot
      }
    );
  }

  const dashboardResponse = staticDashboardResponse(method, path, deps.releaseRoot);
  if (dashboardResponse != null) {
    return dashboardResponse;
  }

  return { statusCode: 404, body: { status: 'ERROR', message: 'not found' } };
}

function validateEaPayload(path: string, body: EaRecord, store: EaStore): string | null {
  switch (path) {
    case '/register':
      return normalizeRegisterPayload(body);
    case '/bars':
      return normalizeBarsPayload(body);
    case '/positions':
      return normalizePositionsPayload(body, store);
    case '/order_result':
      if (stringFieldOrEmpty(body, 'command_id').trim().length === 0) {
        return 'missing command_id';
      }
      if (stringFieldOrEmpty(body, 'result').trim().length === 0) {
        return 'missing result';
      }
      if (hasInvalidOptionalNumber(body, ['ticket'])) {
        return 'invalid JSON';
      }
      return null;
    default:
      return null;
  }
}

function normalizeRegisterPayload(body: EaRecord): string | null {
  const mapping = body.strategy_mapping;
  if (mapping == null) {
    return null;
  }
  if (typeof mapping !== 'object' || Array.isArray(mapping)) {
    return 'invalid JSON';
  }
  for (const value of Object.values(mapping as EaRecord)) {
    if (typeof value !== 'string') {
      return 'invalid JSON';
    }
  }
  return null;
}

function normalizeBarsPayload(body: EaRecord): string | null {
  if (body.bars == null) {
    body.bars = [];
    return null;
  }
  if (!Array.isArray(body.bars)) {
    return 'invalid JSON';
  }
  for (const bar of body.bars) {
    if (!isRecord(bar)) {
      return 'invalid JSON';
    }
    if (hasInvalidOptionalNumber(bar, [
      'open',
      'high',
      'low',
      'close',
      'volume',
      'ema20',
      'ema50',
      'ema200',
      'atr',
      'rsi',
      'macd',
      'macd_signal',
      'macd_hist',
      'adx',
      'bb_upper',
      'bb_lower',
      'bb_mid',
      'bb_middle',
      'stoch_k',
      'stoch_d',
      'vol_sma',
      'fib_236',
      'fib_382',
      'fib_500',
      'fib_618',
      'fib_786',
      'fib_1272',
      'fib_1618',
      'fib_2618',
      'pp',
      'r1',
      'r2',
      's1',
      's2'
    ])) {
      return 'invalid JSON';
    }
    const time = bar.time;
    if (time == null) {
      continue;
    }
    if (typeof time === 'string') {
      continue;
    }
    if (typeof time === 'number' && Number.isFinite(time)) {
      bar.time = String(Math.trunc(time));
      continue;
    }
    return 'invalid JSON';
  }
  return null;
}

function normalizePositionsPayload(body: EaRecord, store: EaStore): string | null {
  if (body.positions == null) {
    body.positions = [];
    return null;
  }
  if (!Array.isArray(body.positions)) {
    return 'invalid JSON';
  }
  const registration = store.getRegistration(stringFieldOrEmpty(body, 'account_id').trim()) ?? {};
  const mapping = {
    ...analysisStrategyMapping(recordField(registration, 'strategy_mapping') ?? {}),
    ...analysisStrategyMapping(recordField(body, 'strategy_mapping') ?? {})
  };
  for (const position of body.positions) {
    if (!isRecord(position)) {
      return 'invalid JSON';
    }
    if (hasInvalidOptionalNumber(position, ['ticket', 'lots', 'open_price', 'sl', 'tp', 'profit', 'open_time', 'magic'])) {
      return 'invalid JSON';
    }
    if (hasInvalidOptionalString(position, ['symbol', 'type', 'comment', 'strategy'])) {
      return 'invalid JSON';
    }
    if (stringFieldOrEmpty(position, 'strategy') === '') {
      const strategy = mapping[String(numberField(position, 'magic'))] ?? DEFAULT_STRATEGY_MAPPING[String(numberField(position, 'magic'))];
      if (typeof strategy === 'string') {
        position.strategy = strategy;
      }
    }
  }
  return null;
}

function tokenAccountMap(input: Record<string, readonly string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(input).map(([token, accounts]) => [token, new Set(accounts)]));
}

function bootstrapTokenRecords(
  validTokens: Set<string> | null,
  tokenAccounts: Map<string, Set<string>> | null,
  adminTokens: Set<string>
): Map<string, ApiTokenRecord> {
  const records = new Map<string, ApiTokenRecord>();
  if (validTokens == null) {
    return records;
  }
  for (const token of validTokens) {
    records.set(token, {
      token,
      name: adminTokens.has(token) ? 'admin' : '',
      accounts: Array.from(tokenAccounts?.get(token) ?? []),
      isAdmin: adminTokens.has(token)
    });
  }
  return records;
}

function tradingCoreAnalysis(store: EaStore, accountId: string, symbol: string, timestamp: string): EaRecord {
  const latestTick = store.getLatestTick(accountId, symbol) ?? {};
  const positions = store.getPositions(accountId, symbol);
  const replayBars = {
    H1: store.getBars(accountId, symbol, 'H1'),
    H4: store.getBars(accountId, symbol, 'H4'),
    M30: store.getBars(accountId, symbol, 'M30'),
    M15: store.getBars(accountId, symbol, 'M15'),
    M5: store.getBars(accountId, symbol, 'M5'),
    M1: store.getBars(accountId, symbol, 'M1')
  };
  return {
    status: 'OK',
    generated_at: timestamp,
    replay: runReplay({
      account_id: accountId,
      symbol,
      analysis_time: timestamp,
      current_price: currentPriceFromTick(latestTick),
      bars: replayBars,
      positions
    }),
    position_summary: summarizePositions({
      accountId,
      symbol,
      positions: positions.map(toPositionManagerPosition)
    })
  };
}

function handleAIResultRoute(
  method: string,
  accountId: string,
  symbol: string,
  rawBody: string,
  deps: Pick<AppServerDeps, 'store' | 'nowIso' | 'commandLifecycle' | 'shadow'>
): JsonResponse {
  if (method !== 'POST') {
    return { statusCode: 405, body: { status: 'ERROR', message: 'method not allowed' } };
  }
  const parsed = parseJsonObject(rawBody);
  if (!parsed.ok) {
    return { statusCode: 400, body: { status: 'ERROR', message: 'invalid JSON' } };
  }

  deps.store.saveAIResult(accountId, symbol, parsed.body);
  const tradePlanPayload = parseTradePlanPayload(parsed.body, accountId, symbol);
  const tradePlan = tradePlanPayload.tradePlan;
  if (tradePlan == null) {
    if (tradePlanPayload.validation == null) {
      queueAIRiskCommands(deps, accountId, symbol, parsed.body);
    }
    return {
      statusCode: 200,
      body: tradePlanPayload.validation == null ? { status: 'OK', received: true } : { status: 'OK', received: true, trade_plan_validation: tradePlanPayload.validation }
    };
  }

  const riskGate = aiTradePlanRiskGate(deps.store, accountId, symbol, tradePlan, deps.nowIso());
  const decisionId = stringFieldOrEmpty(tradePlan, 'decision_id');
  const mode = stringFieldOrEmpty(tradePlan, 'mode');
  recordAIDecisionTimeline(deps.store, accountId, symbol, tradePlan, riskGate, deps.nowIso());
  const riskCommandRequested = shouldQueueAIRiskCommand(parsed.body);
  const riskCommands = queueAIRiskCommands(deps, accountId, symbol, parsed.body, tradePlan, riskGate);
  const command = !riskCommandRequested && riskGate.status === 'accepted' && mode !== 'observe' && mode !== 'veto' && mode !== 'close'
    ? deps.commandLifecycle.acceptCandidate(accountId, tradePlanToCommandCandidate(accountId, symbol, tradePlan))
    : undefined;
  deps.shadow.recordRuntimeSnapshot({
    account_id: accountId,
    symbol,
    source: 'ai_result',
    signal: null,
    command: command ?? riskCommands[0] ?? {
      decision_id: decisionId,
      mode,
      risk_gate: riskGate
    }
  });
  return {
    statusCode: 200,
    body: {
      status: 'OK',
      received: true,
      decision: {
        decision_id: decisionId,
        mode,
        symbol: stringFieldOrEmpty(tradePlan, 'symbol') || symbol,
        confidence: numberField(tradePlan, 'confidence')
      },
      risk_gate: riskGate,
      trade_plan_validation: tradePlanPayload.validation,
      ...(command == null ? {} : { command_status: command.status })
    }
  };
}

function recordAIDecisionTimeline(store: EaStore, accountId: string, symbol: string, tradePlan: EaRecord, riskGate: EaRecord, createdAt: string): void {
  const decisionId = stringFieldOrEmpty(tradePlan, 'decision_id');
  store.recordDecisionEvent({
    decision_id: decisionId,
    account_id: accountId,
    symbol,
    stage: 'ai_result',
    status: 'accepted',
    reason_codes: stringArrayField(tradePlan, 'reason_codes'),
    summary: {
      decision_id: decisionId,
      mode: stringFieldOrEmpty(tradePlan, 'mode'),
      symbol: stringFieldOrEmpty(tradePlan, 'symbol') || symbol,
      confidence: numberField(tradePlan, 'confidence')
    },
    related_command_id: '',
    created_at: createdAt
  });
  store.recordDecisionEvent({
    decision_id: decisionId,
    account_id: accountId,
    symbol,
    stage: 'risk_gate',
    status: riskGateDecisionStatus(stringFieldOrEmpty(riskGate, 'status')),
    reason_codes: stringArrayField(riskGate, 'reason_codes'),
    summary: {
      decision_id: stringFieldOrEmpty(riskGate, 'decision_id'),
      mode: stringFieldOrEmpty(riskGate, 'mode'),
      symbol: stringFieldOrEmpty(riskGate, 'symbol') || symbol,
      status: stringFieldOrEmpty(riskGate, 'status'),
      audit_only: booleanField(riskGate, 'audit_only'),
      requested_lots: numberField(riskGate, 'requested_lots'),
      allowed_lots: numberField(riskGate, 'allowed_lots'),
      max_risk_lots: numberField(riskGate, 'max_risk_lots'),
      max_margin_lots: numberField(riskGate, 'max_margin_lots')
    },
    related_command_id: '',
    created_at: createdAt
  });
}

function riskGateDecisionStatus(status: string): 'pending' | 'accepted' | 'rejected' | 'clamped' {
  if (status === 'accepted' || status === 'rejected' || status === 'clamped') {
    return status;
  }
  return 'pending';
}

function shouldQueueAIRiskCommand(payload: EaRecord): boolean {
  if (payload.risk_alert !== true) {
    return false;
  }
  return AI_RISK_EXIT_SUGGESTIONS.has(stringFieldOrEmpty(payload, 'exit_suggestion').toLowerCase());
}

function queueAIRiskCommands(
  deps: Pick<AppServerDeps, 'store' | 'nowIso'>,
  accountId: string,
  symbol: string,
  payload: EaRecord,
  tradePlan?: EaRecord,
  riskGate?: EaRecord
): StoredCommand[] {
  if (!shouldQueueAIRiskCommand(payload) || !aiRiskGateAllowsCommand(tradePlan, riskGate)) {
    return [];
  }
  const candidates = buildAIRiskCommandCandidates(deps.store, accountId, symbol, payload, deps.nowIso(), tradePlan, riskGate);
  return candidates.map((candidate) => {
    const stored = deps.store.saveCommandCandidate(accountId, candidate);
    deps.store.promoteCommand(stored.command_id);
    return deps.store.getCommand(stored.command_id) ?? { ...stored, status: 'queued' };
  });
}

function aiRiskGateAllowsCommand(tradePlan?: EaRecord, riskGate?: EaRecord): boolean {
  if (tradePlan == null) {
    return true;
  }
  const status = stringFieldOrEmpty(riskGate ?? {}, 'status');
  return status === 'accepted' || status === 'clamped';
}

function buildAIRiskCommandCandidates(
  store: EaStore,
  accountId: string,
  symbol: string,
  payload: EaRecord,
  nowIso: string,
  tradePlan?: EaRecord,
  riskGate?: EaRecord
): CommandCandidate[] {
  const exitSuggestion = stringFieldOrEmpty(payload, 'exit_suggestion').toLowerCase();
  const timestamp = aiRiskCommandTimestamp(nowIso);
  const timestampNanos = aiRiskCommandTimestampNanos(nowIso);
  const confidence = payload.confidence;
  const alertReason = stringFieldOrEmpty(payload, 'alert_reason');
  if (exitSuggestion === 'close_short') {
    return buildCloseShortRiskCommands(store, accountId, symbol, timestampNanos, alertReason, confidence, tradePlan, riskGate);
  }

  const action = exitSuggestion === 'close_all' ? 'CLOSE_ALL' : 'CLOSE_PARTIAL';
  const candidate: CommandCandidate = {
    command_id: `ai_close_${timestamp}`,
    action,
    source: 'ai_risk_alert',
    reason: exitSuggestion === 'close_all' ? `AI风险警报(全平): ${alertReason}` : `AI风险警报(减仓50%): ${alertReason}`,
    confidence
  };
  if (exitSuggestion === 'close_partial') {
    candidate.lots_pct = 0.5;
  }
  attachAIRiskTradePlanMetadata(candidate, tradePlan, riskGate);
  return [candidate];
}

function buildCloseShortRiskCommands(
  store: EaStore,
  accountId: string,
  symbol: string,
  timestamp: string,
  alertReason: string,
  confidence: unknown,
  tradePlan?: EaRecord,
  riskGate?: EaRecord
): CommandCandidate[] {
  return store.getPositions(accountId, symbol).flatMap((position): CommandCandidate[] => {
    const ticket = numberField(position, 'ticket');
    if (ticket <= 0) {
      return [];
    }
    const positionSymbol = stringFieldOrEmpty(position, 'symbol');
    if (positionSymbol.length > 0 && positionSymbol.toUpperCase() !== symbol.toUpperCase()) {
      return [];
    }
    if (stringFieldOrEmpty(position, 'type').toUpperCase() !== 'SELL') {
      return [];
    }
    const candidate: CommandCandidate = {
      command_id: `ai_close_${timestamp}_${ticket}`,
      action: 'CLOSE',
      source: 'ai_risk_alert',
      ticket,
      symbol,
      reason: `AI风险警报(平空): ${alertReason}`,
      confidence
    };
    attachAIRiskTradePlanMetadata(candidate, tradePlan, riskGate);
    return [candidate];
  });
}

function attachAIRiskTradePlanMetadata(candidate: CommandCandidate, tradePlan?: EaRecord, riskGate?: EaRecord): void {
  if (tradePlan == null) {
    return;
  }
  candidate.decision_id = stringFieldOrEmpty(tradePlan, 'decision_id');
  candidate.trade_plan_mode = stringFieldOrEmpty(tradePlan, 'mode');
  if (riskGate != null) {
    candidate.risk_gate = riskGate;
  }
}

function aiRiskCommandTimestamp(nowIso: string): number {
  const millis = Date.parse(nowIso);
  if (Number.isFinite(millis)) {
    return Math.floor(millis / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function aiRiskCommandTimestampNanos(nowIso: string): string {
  const millis = Date.parse(nowIso);
  if (Number.isFinite(millis)) {
    return (BigInt(millis) * 1_000_000n).toString();
  }
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function parseTradePlanPayload(payload: EaRecord, expectedAccountId: string, expectedSymbol: string): {
  tradePlan?: EaRecord;
  validation?: EaRecord;
} {
  const tradePlan = recordField(payload, 'trade_plan');
  if (tradePlan == null) {
    return {};
  }

  const validationError = validateTradePlan(tradePlan, expectedAccountId, expectedSymbol);
  if (validationError != null) {
    return {
      validation: {
        valid: false,
        error: validationError
      }
    };
  }

  return {
    tradePlan,
    validation: {
      valid: true
    }
  };
}

function validateTradePlan(tradePlan: EaRecord, expectedAccountId: string, expectedSymbol: string): string | undefined {
  const schemaVersion = stringFieldOrEmpty(tradePlan, 'schema_version');
  if (schemaVersion !== 'trade_plan.v1') {
    return `trade_plan.schema_version = ${JSON.stringify(schemaVersion)}, want "trade_plan.v1"`;
  }

  const decisionId = stringFieldOrEmpty(tradePlan, 'decision_id');
  if (decisionId.length === 0) {
    return 'trade_plan.decision_id is required';
  }

  const accountId = stringFieldOrEmpty(tradePlan, 'account_id');
  if (accountId.length === 0) {
    return 'trade_plan.account_id is required';
  }
  if (expectedAccountId.length > 0 && accountId !== expectedAccountId) {
    return `trade_plan.account_id = ${JSON.stringify(accountId)}, want ${JSON.stringify(expectedAccountId)}`;
  }

  const symbol = stringFieldOrEmpty(tradePlan, 'symbol');
  if (symbol.length === 0) {
    return 'trade_plan.symbol is required';
  }
  if (expectedSymbol.length > 0 && symbol.toUpperCase() !== expectedSymbol.toUpperCase()) {
    return `trade_plan.symbol = ${JSON.stringify(symbol)}, want ${JSON.stringify(expectedSymbol)}`;
  }

  const mode = stringFieldOrEmpty(tradePlan, 'mode');
  if (!VALID_TRADE_PLAN_MODES.has(mode)) {
    return `trade_plan.mode = ${JSON.stringify(mode)} is invalid`;
  }

  const side = stringFieldOrEmpty(tradePlan, 'side');
  if (!VALID_TRADE_PLAN_SIDES.has(side)) {
    return `trade_plan.side = ${JSON.stringify(side)} is invalid`;
  }

  const confidenceDecodeError = decodeIntFieldError(tradePlan, 'confidence', 'TradePlan.confidence');
  if (confidenceDecodeError != null) {
    return confidenceDecodeError;
  }
  const confidence = numberField(tradePlan, 'confidence');
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    return `trade_plan.confidence = ${confidence}, want 0..100`;
  }

  const expiresAtDecodeError = decodeTimeFieldError(tradePlan, 'expires_at');
  if (expiresAtDecodeError != null) {
    return expiresAtDecodeError;
  }
  const expiresAt = stringFieldOrEmpty(tradePlan, 'expires_at');
  if (expiresAt.length === 0 || parseDateMillis(expiresAt) == null) {
    return 'trade_plan.expires_at is required';
  }

  const reasonCodes = tradePlan.reason_codes;
  const reasonCodesDecodeError = decodeStringArrayFieldError(tradePlan, 'reason_codes', 'TradePlan.reason_codes');
  if (reasonCodesDecodeError != null) {
    return reasonCodesDecodeError;
  }
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return 'trade_plan.reason_codes must not be empty';
  }
  for (const code of reasonCodes) {
    if (typeof code !== 'string' || code.trim().length === 0) {
      return 'trade_plan.reason_codes contains an empty code';
    }
  }

  if (stringFieldOrEmpty(tradePlan, 'narrative').trim().length === 0) {
    return 'trade_plan.narrative is required';
  }

  const addOnDecodeError = decodeBoolFieldError(tradePlan, 'add_on', 'TradePlan.add_on');
  if (addOnDecodeError != null) {
    return addOnDecodeError;
  }

  if (mode === 'observe' || mode === 'veto') {
    return undefined;
  }

  if (side === 'none') {
    return 'active trade_plan.side must be buy or sell';
  }

  const entryZone = recordField(tradePlan, 'entry_zone');
  const entryZoneDecodeError = decodeEntryZoneError(entryZone);
  if (entryZoneDecodeError != null) {
    return entryZoneDecodeError;
  }
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? 0 : numberField(entryZone, 'max');
  if (entryMin <= 0 || entryMax <= 0) {
    return 'active trade_plan.entry_zone must be positive';
  }
  if (entryMin > entryMax) {
    return 'trade_plan.entry_zone.min must be <= max';
  }

  const stopLossDecodeError = decodeFloatFieldError(tradePlan, 'stop_loss', 'TradePlan.stop_loss');
  if (stopLossDecodeError != null) {
    return stopLossDecodeError;
  }
  if (numberField(tradePlan, 'stop_loss') <= 0) {
    return 'active trade_plan.stop_loss must be positive';
  }

  const takeProfit = tradePlan.take_profit;
  const takeProfitDecodeError = decodeFloatArrayFieldError(tradePlan, 'take_profit', 'TradePlan.take_profit');
  if (takeProfitDecodeError != null) {
    return takeProfitDecodeError;
  }
  if (!Array.isArray(takeProfit) || takeProfit.length === 0) {
    return 'active trade_plan.take_profit must not be empty';
  }
  for (const target of takeProfit) {
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
      return 'active trade_plan.take_profit must contain only positive values';
    }
  }

  const maxLotsDecodeError = decodeFloatFieldError(tradePlan, 'max_lots', 'TradePlan.max_lots');
  if (maxLotsDecodeError != null) {
    return maxLotsDecodeError;
  }
  if (numberField(tradePlan, 'max_lots') <= 0) {
    return 'active trade_plan.max_lots must be positive';
  }

  return undefined;
}

function aiTradePlanRiskGate(store: EaStore, accountId: string, symbol: string, tradePlan: EaRecord, now: string): EaRecord {
  const registration = store.getRegistration(accountId) ?? {};
  const heartbeat = store.getHeartbeat(accountId) ?? {};
  const latestTick = store.getLatestTick(accountId, symbol) ?? {};
  const result = evaluateRiskGate({
    now,
    account: {
      accountId,
      leverage: numberField(registration, 'leverage')
    },
    runtime: {
      equity: numberField(heartbeat, 'equity'),
      freeMargin: numberField(heartbeat, 'free_margin'),
      marketOpen: booleanField(heartbeat, 'market_open'),
      isTradeAllowed: booleanField(heartbeat, 'is_trade_allowed'),
      lastTickAt: stringFieldOrEmpty(latestTick, 'time')
    },
    state: {
      tick: {
        symbol,
        bid: numberField(latestTick, 'bid'),
        ask: numberField(latestTick, 'ask'),
        spread: numberField(latestTick, 'spread')
      },
      positions: store.getPositions(accountId, symbol).map((position) => ({
        ticket: numberField(position, 'ticket'),
        symbol: stringFieldOrEmpty(position, 'symbol'),
        type: stringFieldOrEmpty(position, 'type'),
        lots: numberField(position, 'lots'),
        strategy: stringFieldOrEmpty(position, 'strategy')
      }))
    },
    plan: {
      decisionId: stringFieldOrEmpty(tradePlan, 'decision_id'),
      accountId: stringFieldOrEmpty(tradePlan, 'account_id') || accountId,
      symbol: stringFieldOrEmpty(tradePlan, 'symbol') || symbol,
      mode: stringFieldOrEmpty(tradePlan, 'mode'),
      side: stringFieldOrEmpty(tradePlan, 'side'),
      entryZone: riskGateEntryZone(recordField(tradePlan, 'entry_zone')),
      stopLoss: numberField(tradePlan, 'stop_loss'),
      takeProfit: arrayNumberField(tradePlan, 'take_profit'),
      maxLots: numberField(tradePlan, 'max_lots'),
      expiresAt: stringFieldOrEmpty(tradePlan, 'expires_at')
    },
    allowAdd: booleanField(tradePlan, 'add_on'),
    sourceStrategy: 'ai_signal'
  });
  return {
    audit_only: result.auditOnly,
    decision_id: result.decisionId,
    mode: result.mode,
    symbol: result.symbol,
    status: result.status,
    reason_codes: result.reasonCodes,
    requested_lots: result.requestedLots,
    allowed_lots: result.allowedLots,
    max_risk_lots: result.maxRiskLots,
    max_margin_lots: result.maxMarginLots,
    canProduceLiveCommands: result.canProduceLiveCommands
  };
}

function tradePlanToCommandCandidate(accountId: string, symbol: string, tradePlan: EaRecord): CommandCandidate {
  const entryZone = recordField(tradePlan, 'entry_zone');
  const takeProfit = arrayNumberField(tradePlan, 'take_profit');
  const side = stringFieldOrEmpty(tradePlan, 'side').toUpperCase();
  const entryMin = entryZone == null ? 0 : numberField(entryZone, 'min');
  const entryMax = entryZone == null ? entryMin : numberField(entryZone, 'max');
  return {
    command_id: stringFieldOrEmpty(tradePlan, 'decision_id'),
    action: 'SIGNAL',
    source: 'ai_result',
    account_id: accountId,
    symbol,
    strategy: 'ai_signal',
    type: side,
    entry: entryMin > 0 && entryMax > 0 ? round4((entryMin + entryMax) / 2) : entryMin,
    sl: numberField(tradePlan, 'stop_loss'),
    tp1: takeProfit[0] ?? 0,
    tp2: takeProfit[1] ?? takeProfit[0] ?? 0,
    score: numberField(tradePlan, 'confidence'),
    mode: stringFieldOrEmpty(tradePlan, 'mode')
  } satisfies CommandCandidate;
}

function riskGateEntryZone(value: EaRecord | undefined): { min?: number; max?: number } | undefined {
  if (value == null) {
    return undefined;
  }
  return {
    min: numberField(value, 'min'),
    max: numberField(value, 'max')
  };
}

function analysisPayload(store: EaStore, accountId: string, symbol: string, timestamp: string): EaRecord {
  const registration = store.getRegistration(accountId) ?? {};
  const heartbeat = store.getHeartbeat(accountId) ?? {};
  const latestTick = store.getLatestTick(accountId, symbol) ?? {};
  const positions = store.getPositions(accountId, symbol);
  const barsByTimeframe = analysisBarsByTimeframe(store, accountId, symbol);
  const enrichedBarsByTimeframe = enrichBarsByTimeframe(barsByTimeframe);
  const marketStatus = analysisMarketStatus(heartbeat, latestTick, timestamp);
  const trendBarsByTimeframe = {
    ...enrichedBarsByTimeframe,
    D1: enrichAnalysisBars(store.getBars(accountId, symbol, 'D1'))
  };
  return {
    account: {
      account_id: accountId,
      balance: numberField(heartbeat, 'balance'),
      broker: stringFieldOrEmpty(registration, 'broker'),
      connected: true,
      currency: stringFieldOrEmpty(registration, 'currency'),
      equity: numberField(heartbeat, 'equity'),
      free_margin: numberField(heartbeat, 'free_margin'),
      leverage: numberField(registration, 'leverage'),
      margin: numberField(heartbeat, 'margin'),
      server_name: stringFieldOrEmpty(registration, 'server_name')
    },
    bars: enrichedBarsByTimeframe,
    harmonic_context: null,
    indicators: indicatorPacks(enrichedBarsByTimeframe),
    market: {
      ask: numberField(latestTick, 'ask'),
      bid: numberField(latestTick, 'bid'),
      spread: numberField(latestTick, 'spread'),
      symbol,
      time: stringFieldOrEmpty(latestTick, 'time')
    },
    market_filters: {
      ...evaluateMarketFilters({
        now: timestamp,
        symbol,
        runtime: {
          marketOpen: booleanField(heartbeat, 'market_open'),
          isTradeAllowed: booleanField(heartbeat, 'is_trade_allowed'),
          lastTickAt: stringFieldOrEmpty(latestTick, 'time')
        },
        state: {
          tick: {
            symbol,
            spread: numberField(latestTick, 'spread')
          },
          bars: enrichedBarsByTimeframe
        }
      })
    },
    market_status: {
      is_trade_allowed: marketStatus.isTradeAllowed,
      market_open: marketStatus.marketOpen,
      mt4_server_time: stringFieldOrEmpty(heartbeat, 'server_time'),
      tradeable: marketStatus.marketOpen && marketStatus.isTradeAllowed
    },
    positions: positions.map((position) => normalizeAnalysisPosition(position, latestTick)),
    status: 'OK',
    strategy_mapping: analysisStrategyMapping({
      ...DEFAULT_STRATEGY_MAPPING,
      ...(recordField(registration, 'strategy_mapping') ?? {})
    }),
    timestamp,
    trend_context: trendContext(trendBarsByTimeframe)
  };
}

function analysisMarketStatus(heartbeat: EaRecord, latestTick: EaRecord, timestamp: string): { marketOpen: boolean; isTradeAllowed: boolean } {
  let marketOpen = booleanField(heartbeat, 'market_open');
  let isTradeAllowed = booleanField(heartbeat, 'is_trade_allowed');
  const tickTime = parseDateMillis(stringFieldOrEmpty(latestTick, 'time'));
  if (tickTime == null) {
    return { marketOpen: false, isTradeAllowed: false };
  }
  const now = parseDateMillis(timestamp);
  if (now != null && now - tickTime > 10 * 60 * 1000) {
    marketOpen = false;
    isTradeAllowed = false;
  }
  return { marketOpen, isTradeAllowed };
}

function analysisBarsByTimeframe(store: EaStore, accountId: string, symbol: string): Record<string, EaRecord[]> {
  return {
    M15: store.getBars(accountId, symbol, 'M15'),
    M30: store.getBars(accountId, symbol, 'M30'),
    H1: store.getBars(accountId, symbol, 'H1'),
    H4: store.getBars(accountId, symbol, 'H4')
  };
}

function enrichBarsByTimeframe(barsByTimeframe: Record<string, EaRecord[]>): Record<string, EaRecord[]> {
  const out: Record<string, EaRecord[]> = {};
  for (const [timeframe, bars] of Object.entries(barsByTimeframe)) {
    out[timeframe] = enrichAnalysisBars(bars);
  }
  return out;
}

function enrichAnalysisBars(bars: EaRecord[]): EaRecord[] {
  const out = bars.map((bar) => ({ ...bar }));
  if (out.length === 0) {
    return out;
  }

  const close = out.map((bar) => numberField(bar, 'close'));
  const high = out.map((bar) => numberField(bar, 'high'));
  const low = out.map((bar) => numberField(bar, 'low'));
  const volume = out.map((bar) => numberField(bar, 'volume'));
  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const ema200 = ema(close, 200);
  const atr14 = atr(high, low, close, 14);
  const rsi14 = rsi(close, 14);
  const macdResult = macd(close);
  const adx14 = adx(high, low, close, 14);
  const bb = bollinger(close, 20, 2);
  const stochastic = stoch(high, low, close, 14, 3);
  const volSma = rollingMean(volume, 20);

  for (let index = 0; index < out.length; index += 1) {
    out[index].ema20 = safeNumber(ema20[index]);
    out[index].ema50 = safeNumber(ema50[index]);
    out[index].ema200 = out.length >= 200 ? safeNumber(ema200[index]) : 0;
    out[index].atr = safeNumber(atr14[index]);
    out[index].rsi = safeNumber(rsi14[index]);
    out[index].macd = safeNumber(macdResult.macd[index]);
    out[index].macd_signal = safeNumber(macdResult.signal[index]);
    out[index].macd_hist = safeNumber(macdResult.histogram[index]);
    out[index].adx = safeNumber(adx14[index]);
    out[index].bb_upper = safeNumber(bb.upper[index]);
    out[index].bb_middle = safeNumber(bb.mid[index]);
    out[index].bb_lower = safeNumber(bb.lower[index]);
    out[index].stoch_k = safeNumber(stochastic.k[index]);
    out[index].stoch_d = safeNumber(stochastic.d[index]);
    out[index].vol_sma = safeNumber(volSma[index]);

    const start = Math.max(0, index - 49);
    const windowHigh = high.slice(start, index + 1);
    const windowLow = low.slice(start, index + 1);
    const fib = fibonacci(windowHigh, windowLow, windowHigh.length);
    out[index].fib_236 = safeNumber(fib.fib236);
    out[index].fib_382 = safeNumber(fib.fib382);
    out[index].fib_500 = safeNumber(fib.fib500);
    out[index].fib_618 = safeNumber(fib.fib618);
    out[index].fib_786 = safeNumber(fib.fib786);

    const swingHigh = Math.max(...windowHigh);
    const swingLow = Math.min(...windowLow);
    const trend = numberField(out[index], 'close') > numberField(out[index], 'open') ? 'UP' : 'DOWN';
    const extension = calculateFibExtension(swingHigh, swingLow, trend);
    out[index].fib_1272 = safeNumber(extension.level1272);
    out[index].fib_1618 = safeNumber(extension.level1618);
    out[index].fib_2618 = safeNumber(extension.level2618);

    if (index > 0) {
      const pivots = pivotPoints(high[index - 1], low[index - 1], close[index - 1]);
      out[index].pp = safeNumber(pivots.pp);
      out[index].r1 = safeNumber(pivots.r1);
      out[index].s1 = safeNumber(pivots.s1);
    }
  }

  return out;
}

function indicatorPacks(barsByTimeframe: Record<string, EaRecord[]>): Record<string, EaRecord | null> {
  const out: Record<string, EaRecord | null> = {};
  for (const timeframe of ['M15', 'M30', 'H1', 'H4']) {
    const bars = barsByTimeframe[timeframe] ?? [];
    if (bars.length < 20) {
      out[timeframe] = null;
      continue;
    }
    const last = bars[bars.length - 1];
    out[timeframe] = {
      close: numberField(last, 'close'),
      open: numberField(last, 'open'),
      high: numberField(last, 'high'),
      low: numberField(last, 'low'),
      ema20: numberField(last, 'ema20'),
      ema50: numberField(last, 'ema50'),
      ema200: numberField(last, 'ema200'),
      rsi: numberField(last, 'rsi'),
      adx: numberField(last, 'adx'),
      atr: numberField(last, 'atr'),
      macd: numberField(last, 'macd'),
      macd_signal: numberField(last, 'macd_signal'),
      macd_hist: numberField(last, 'macd_hist'),
      bb_upper: numberField(last, 'bb_upper'),
      bb_middle: numberField(last, 'bb_middle'),
      bb_lower: numberField(last, 'bb_lower'),
      stoch_k: numberField(last, 'stoch_k'),
      stoch_d: numberField(last, 'stoch_d'),
      vol_sma: numberField(last, 'vol_sma'),
      fib_236: numberField(last, 'fib_236'),
      fib_382: numberField(last, 'fib_382'),
      fib_500: numberField(last, 'fib_500'),
      fib_618: numberField(last, 'fib_618'),
      fib_786: numberField(last, 'fib_786'),
      fib_1272: numberField(last, 'fib_1272'),
      fib_1618: numberField(last, 'fib_1618'),
      fib_2618: numberField(last, 'fib_2618'),
      pp: numberField(last, 'pp'),
      r1: numberField(last, 'r1'),
      s1: numberField(last, 's1'),
      bars_count: bars.length
    };
  }
  return out;
}

function trendContext(barsByTimeframe: Record<string, EaRecord[]>): EaRecord {
  const d1Direction = directionFromBars(barsByTimeframe.D1 ?? []);
  const h4Direction = directionFromBars(barsByTimeframe.H4 ?? []);
  const h1Direction = directionFromBars(barsByTimeframe.H1 ?? []);
  const m30Direction = directionFromBars(barsByTimeframe.M30 ?? []);
  const weights = [
    { direction: d1Direction, weight: 0.05 },
    { direction: h4Direction, weight: 0.25 },
    { direction: h1Direction, weight: 0.35 },
    { direction: m30Direction, weight: 0.35 }
  ];
  const bullWeight = weights.filter((item) => item.direction === 'BULL').reduce((sum, item) => sum + item.weight, 0);
  const bearWeight = weights.filter((item) => item.direction === 'BEAR').reduce((sum, item) => sum + item.weight, 0);
  const consensusDirection = bullWeight > bearWeight ? 'BULL' : bearWeight > bullWeight ? 'BEAR' : 'NEUTRAL';
  return {
    d1_direction: d1Direction,
    h4_direction: h4Direction,
    h1_direction: h1Direction,
    m30_direction: m30Direction,
    consensus_direction: consensusDirection,
    consensus_strength: round4(consensusStrength(weights, barsByTimeframe))
  };
}

function directionFromBars(bars: EaRecord[]): string {
  if (bars.length === 0) {
    return 'NEUTRAL';
  }
  const last = bars[bars.length - 1];
  const ema20Value = numberField(last, 'ema20');
  const ema50Value = numberField(last, 'ema50');
  const close = numberField(last, 'close');
  if (ema20Value > ema50Value && close > ema20Value) {
    return 'BULL';
  }
  if (ema20Value < ema50Value && close < ema20Value) {
    return 'BEAR';
  }
  return 'NEUTRAL';
}

function consensusStrength(weights: Array<{ direction: string; weight: number }>, barsByTimeframe: Record<string, EaRecord[]>): number {
  const timeframeByIndex = ['D1', 'H4', 'H1', 'M30'];
  return weights.reduce((sum, item, index) => {
    if (item.direction === 'NEUTRAL') {
      return sum;
    }
    const bars = barsByTimeframe[timeframeByIndex[index]] ?? [];
    const last = bars[bars.length - 1] ?? {};
    return sum + item.weight * trendConfidence(numberField(last, 'adx'));
  }, 0);
}

function trendConfidence(adxValue: number): number {
  if (adxValue < 20) {
    return 0.3;
  }
  if (adxValue <= 30) {
    return 0.6;
  }
  return 0.9;
}

function rollingMean(values: readonly number[], period: number): number[] {
  const out = Array<number>(values.length).fill(Number.NaN);
  if (period <= 0) {
    return out;
  }
  for (let index = period - 1; index < values.length; index += 1) {
    let sum = 0;
    let valid = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      if (Number.isNaN(values[cursor])) {
        continue;
      }
      sum += values[cursor];
      valid += 1;
    }
    if (valid === period) {
      out[index] = sum / period;
    }
  }
  return out;
}

function normalizeAnalysisPosition(position: EaRecord, latestTick: EaRecord): EaRecord {
  const type = stringFieldOrEmpty(position, 'type');
  const currentPrice = numberField(latestTick, 'ask');
  const entryPrice = numberField(position, 'entry_price') || numberField(position, 'open_price');
  const profit = numberField(position, 'profit');
  const lots = numberField(position, 'lots');
  return {
    comment: stringFieldOrEmpty(position, 'comment'),
    current_price: currentPrice,
    direction: type,
    entry_price: entryPrice,
    hold_hours: numberField(position, 'hold_hours'),
    hold_seconds: numberField(position, 'hold_seconds'),
    lots,
    magic: numberField(position, 'magic'),
    pnl_percent: numberField(position, 'pnl_percent') || pnlPercent(profit, entryPrice, lots),
    profit,
    sl: numberField(position, 'sl'),
    strategy: stringFieldOrEmpty(position, 'strategy'),
    ticket: numberField(position, 'ticket'),
    tp: numberField(position, 'tp')
  };
}

function analysisStrategyMapping(mapping: EaRecord): EaRecord {
  const out: EaRecord = {};
  for (const key of ALLOWED_STRATEGY_MAPPING_KEYS) {
    if (typeof mapping[key] === 'string' && isEaStrategyName(mapping[key])) {
      out[key] = mapping[key];
    }
  }
  return out;
}

function pnlPercent(profit: number, entryPrice: number, lots: number): number {
  if (entryPrice === 0 || lots === 0) {
    return 0;
  }
  return round4((profit / (entryPrice * lots * 100)) * 100);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function accountSummaries(store: EaStore): EaRecord[] {
  return store.listAccountIds().map((accountId) => {
    const registration = store.getRegistration(accountId) ?? {};
    const heartbeat = store.getHeartbeat(accountId) ?? {};
    const positions = store.getPositions(accountId);
    return {
      account_id: accountId,
      balance: numberField(heartbeat, 'balance'),
      broker: stringFieldOrEmpty(registration, 'broker'),
      connected: true,
      equity: numberField(heartbeat, 'equity'),
      is_trade_allowed: booleanField(heartbeat, 'is_trade_allowed'),
      market_open: booleanField(heartbeat, 'market_open'),
      positions: positions.length,
      server_name: stringFieldOrEmpty(registration, 'server_name')
    };
  });
}

function accountDetail(store: EaStore, accountId: string, timestamp: string): EaRecord {
  const payload = analysisPayload(store, accountId, 'XAUUSD', timestamp);
  const aiResults = store.getAIResults(accountId);
  const latestAIResult = aiResults.length === 0 ? {} : stripNodeAIResultEnvelope(aiResults[aiResults.length - 1]);
  return {
    status: 'OK',
    account: payload.account,
    market: payload.market,
    positions: payload.positions,
    indicators: payload.indicators,
    ai_result: latestAIResult,
    decision_events: store.listDecisionEvents({ account_id: accountId, limit: 10 })
  };
}

function stripNodeAIResultEnvelope(record: EaRecord): EaRecord {
  const out = { ...record };
  delete out.account_id;
  delete out.symbol;
  return out;
}

function overviewCards(accounts: EaRecord[]): EaRecord[] {
  const connected = accounts.length;
  const tradeable = accounts.filter((account) => account.market_open === true && account.is_trade_allowed === true).length;
  return [
    {
      detail: 'SQLite + Go API online',
      title: 'System Health',
      tone: 'green',
      value: 'Healthy'
    },
    {
      detail: 'active terminals reporting',
      title: 'Connected Accounts',
      tone: 'amber',
      value: String(connected)
    },
    {
      detail: 'market open and trading allowed',
      title: 'Tradeable Accounts',
      tone: 'blue',
      value: String(tradeable)
    },
    {
      detail: 'Replay validated, shadow diff pending',
      title: 'Cutover Health',
      tone: 'orange',
      value: 'Baseline Only'
    }
  ];
}

function auditChecks(report: ReturnType<typeof buildShadowReport>): EaRecord[] {
  if (report.last_shadow_event_at.length === 0) {
    return [
      {
        detail: 'Replay fixture has not been approved yet',
        label: 'Replay Parity',
        tone: 'orange',
        value: 'pending'
      },
      {
        detail: 'Waiting for mirrored production traffic',
        label: 'Shadow Drift',
        tone: 'orange',
        value: 'pending'
      },
      {
        detail: 'Live shadow traffic has not started yet',
        label: 'Protocol Errors',
        tone: 'amber',
        value: '0.00%'
      }
    ];
  }
  return [
    {
      detail: report.signal_drift_rate <= 0.02 ? 'Replay fixture matched baseline or drift is within threshold' : 'Replay fixture drift is above threshold',
      label: 'Replay Parity',
      tone: report.signal_drift_rate <= 0.02 ? 'green' : 'orange',
      value: report.signal_drift_rate <= 0.02 ? 'validated' : 'pending'
    },
    {
      detail: report.last_shadow_event_at.length > 0 ? `Last shadow event at ${report.last_shadow_event_at}` : 'Waiting for mirrored production traffic',
      label: 'Shadow Drift',
      tone: report.last_shadow_event_at.length > 0 ? 'blue' : 'orange',
      value: report.last_shadow_event_at.length > 0 ? 'active' : 'pending'
    },
    {
      detail: report.protocol_error_rate === 0 ? 'No contract mismatches observed in replay or shadow mode' : 'Protocol mismatches detected in shadow mode',
      label: 'Protocol Errors',
      tone: report.protocol_error_rate === 0 ? 'green' : 'amber',
      value: `${(report.protocol_error_rate * 100).toFixed(2)}%`
    }
  ];
}

function buildAuditBody(store: EaStore, timestamp: string): EaRecord {
  const comparisons = store.listShadowComparisons();
  const report = buildShadowReport(comparisons);
  const summary = auditChecks(report);
  if (comparisons.length === 0) {
    return {
      status: 'OK',
      generated_at: timestamp,
      summary,
      report: {
        ready: false,
        protocol_error_rate: 0,
        signal_drift_rate: 0,
        command_drift_rate: 0,
        last_shadow_event_at: '0001-01-01T00:00:00Z',
        missing_capabilities: ['shadow_traffic'],
        checks: summary
      },
      events: []
    };
  }
  return {
    status: 'OK',
    generated_at: timestamp,
    summary,
    report,
    events: []
  };
}

function eventStreamSnapshot(store: EaStore, timestamp: string): string {
  const accountId = store.listAccountIds()[0];
  if (accountId == null) {
    return '';
  }
  return formatSseFrame({
    event_id: 'evt_1',
    event_type: 'heartbeat',
    account_id: accountId,
    source: 'test',
    timestamp,
    payload: { status: 'OK' }
  });
}

function eaVersionResponse(releaseRoot: string): JsonResponse {
  const release = currentEaRelease(releaseRoot);
  if (!release.ok) {
    return { statusCode: 500, body: { status: 'ERROR', message: release.message } };
  }
  return {
    statusCode: 200,
    body: {
      status: 'OK',
      version: release.info.version,
      build: release.info.build,
      changelog: release.info.changelog
    }
  };
}

function eaVersionCheckResponse(releaseRoot: string): JsonResponse {
  const release = currentEaRelease(releaseRoot);
  if (!release.ok) {
    return { statusCode: 500, body: { status: 'ERROR', message: release.message } };
  }
  return {
    statusCode: 200,
    body: {
      latest_version: release.info.version,
      latest_build: release.info.build,
      force_update: false
    }
  };
}

function eaDownloadResponse(releaseRoot: string): JsonResponse {
  try {
    return {
      statusCode: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="GoldBolt_Client.mq4"'
      },
      body: null,
      rawBody: readFileSync(join(releaseRoot, 'mt4_ea', 'GoldBolt_Client.mq4'))
    };
  } catch {
    return { statusCode: 404, body: { status: 'ERROR', message: 'file not found' } };
  }
}

function prometheusMetricsResponse(): JsonResponse {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
    },
    body: null,
    rawBody: [
      '# HELP goldbot_http_requests_total Total number of HTTP requests',
      '# TYPE goldbot_http_requests_total counter',
      'goldbot_http_requests_total{method="GET",path="/metrics",status="200"} 1',
      '# HELP goldbot_db_connections_open Number of open database connections',
      '# TYPE goldbot_db_connections_open gauge',
      'goldbot_db_connections_open 0',
      '# HELP goldbot_db_connections_in_use Number of database connections in use',
      '# TYPE goldbot_db_connections_in_use gauge',
      'goldbot_db_connections_in_use 0',
      ''
    ].join('\n')
  };
}

function staticDashboardResponse(method: string, path: string, releaseRoot: string): JsonResponse | null {
  const distDir = join(releaseRoot, 'web', 'dashboard', 'dist');
  if (!isDirectory(distDir)) {
    return null;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return {
      statusCode: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: null,
      rawBody: 'method not allowed\n'
    };
  }

  const target = resolveDashboardFile(distDir, path);
  if (target == null) {
    return null;
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentTypeForPath(target)
    },
    body: null,
    rawBody: method === 'HEAD' ? '' : readFileSync(target)
  };
}

function resolveDashboardFile(distDir: string, requestPath: string): string | undefined {
  const cleaned = cleanDashboardPath(requestPath);
  if (cleaned == null) {
    return undefined;
  }

  const candidates = cleaned.length === 0
    ? [join(distDir, 'index.html')]
    : [
        join(distDir, cleaned),
        join(distDir, cleaned, 'index.html'),
        join(distDir, `${cleaned}.html`),
        ...(cleaned.startsWith('accounts/')
          ? [
              join(distDir, 'accounts', '__dynamic__', 'index.html'),
              join(distDir, 'accounts', '__dynamic__.html')
            ]
          : []),
        ...(extname(cleaned).length === 0 ? [join(distDir, 'index.html')] : [])
      ];

  return candidates.find((candidate) => isFile(candidate));
}

function cleanDashboardPath(requestPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  const cleaned = normalize(`/${decoded}`).replace(/^[/\\]+/, '');
  if (cleaned === '.') {
    return '';
  }
  if (cleaned === '..' || cleaned.startsWith('../') || cleaned.startsWith('..\\')) {
    return undefined;
  }
  return cleaned;
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function currentEaRelease(releaseRoot: string): { ok: true; info: EaReleaseInfo } | { ok: false; message: string } {
  const fallback: EaReleaseInfo = { version: '0.0.0', build: 0, changelog: '' };
  let raw: string;
  try {
    raw = readFileSync(join(releaseRoot, 'mt4_ea', 'version.json'), 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: true, info: fallback };
    }
    return { ok: false, message: `read EA version file: ${errorMessage(error)}` };
  }

  try {
    const payload = JSON.parse(raw) as unknown;
    if (!isRecord(payload)) {
      return { ok: false, message: 'decode EA version file: expected object' };
    }
    return {
      ok: true,
      info: {
        version: typeof payload.version === 'string' ? payload.version : fallback.version,
        build: typeof payload.build === 'number' && Number.isInteger(payload.build) ? payload.build : fallback.build,
        changelog: typeof payload.changelog === 'string' ? payload.changelog : fallback.changelog
      }
    };
  } catch (error) {
    return { ok: false, message: `decode EA version file: ${errorMessage(error)}` };
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1_000_000_000_000) / 1_000_000_000_000 : 0;
}

function optionalNumberField(record: EaRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayNumberField(record: EaRecord, field: string): number[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];
}

function booleanField(record: EaRecord, field: string): boolean {
  return record[field] === true;
}

function stringFieldOrEmpty(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(record: EaRecord, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function symbolOrDefault(payload: EaRecord): string {
  return typeof payload.symbol === 'string' && payload.symbol.length > 0 ? payload.symbol : 'XAUUSD';
}

function currentPriceFromTick(tick: EaRecord): number {
  return optionalNumberField(tick, 'ask') ?? optionalNumberField(tick, 'bid') ?? 0;
}

function parseDateMillis(value: string): number | undefined {
  if (value.length === 0) {
    return undefined;
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : undefined;
}

function toPositionManagerPosition(position: EaRecord): PositionManagerPosition {
  return {
    ticket: optionalNumberField(position, 'ticket'),
    symbol: stringFieldOrEmpty(position, 'symbol'),
    type: stringFieldOrEmpty(position, 'type'),
    lots: optionalNumberField(position, 'lots'),
    openPrice: optionalNumberField(position, 'openPrice'),
    open_price: optionalNumberField(position, 'open_price'),
    profit: optionalNumberField(position, 'profit'),
    comment: stringFieldOrEmpty(position, 'comment'),
    strategy: stringFieldOrEmpty(position, 'strategy'),
    magic: optionalNumberField(position, 'magic')
  };
}

function recordField(record: EaRecord, field: string): EaRecord | undefined {
  const value = record[field];
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as EaRecord) : undefined;
}

function jsonTypeName(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return 'bool';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      return 'object';
    default:
      return typeof value;
  }
}

function decodeIntFieldError(record: EaRecord, field: string, goFieldPath: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${goFieldPath} of type int`;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return `decode trade_plan: json: cannot unmarshal number ${String(value)} into Go struct field ${goFieldPath} of type int`;
  }
  return undefined;
}

function decodeFloatFieldError(record: EaRecord, field: string, goFieldPath: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${goFieldPath} of type float64`;
  }
  if (!Number.isFinite(value)) {
    return `decode trade_plan: json: cannot unmarshal number ${String(value)} into Go struct field ${goFieldPath} of type float64`;
  }
  return undefined;
}

function decodeFloatArrayFieldError(record: EaRecord, field: string, goFieldPath: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${goFieldPath} of type float64`;
  }
  for (const entry of value) {
    if (typeof entry !== 'number') {
      return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(entry)} into Go struct field ${goFieldPath} of type float64`;
    }
    if (!Number.isFinite(entry)) {
      return `decode trade_plan: json: cannot unmarshal number ${String(entry)} into Go struct field ${goFieldPath} of type float64`;
    }
  }
  return undefined;
}

function decodeStringArrayFieldError(record: EaRecord, field: string, goFieldPath: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${goFieldPath} of type []string`;
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(entry)} into Go struct field ${goFieldPath} of type string`;
    }
  }
  return undefined;
}

function decodeBoolFieldError(record: EaRecord, field: string, goFieldPath: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    return `decode trade_plan: json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${goFieldPath} of type bool`;
  }
  return undefined;
}

function decodeEntryZoneError(entryZone: EaRecord | undefined): string | undefined {
  if (entryZone == null) {
    return undefined;
  }
  const minError = decodeFloatFieldError(entryZone, 'min', 'TradePlan.entry_zone.min');
  if (minError != null) {
    return minError;
  }
  const maxError = decodeFloatFieldError(entryZone, 'max', 'TradePlan.entry_zone.max');
  if (maxError != null) {
    return maxError;
  }
  return undefined;
}

function decodeTimeFieldError(record: EaRecord, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return 'decode trade_plan: Time.UnmarshalJSON: input is not a JSON string';
  }
  return undefined;
}

function isRecord(value: unknown): value is EaRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasInvalidOptionalNumber(record: EaRecord, fields: readonly string[]): boolean {
  return fields.some((field) => {
    const value = record[field];
    return value != null && (typeof value !== 'number' || !Number.isFinite(value));
  });
}

function hasInvalidOptionalString(record: EaRecord, fields: readonly string[]): boolean {
  return fields.some((field) => {
    const value = record[field];
    return value != null && typeof value !== 'string';
  });
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeResponse(res: ServerResponse, response: JsonResponse): void {
  if (response.rawBody != null) {
    res.statusCode = response.statusCode;
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      res.setHeader(name, value);
    }
    res.end(response.rawBody);
    return;
  }
  writeJSON(res, response.statusCode, response.body);
}

function writeJSON(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

async function injectHandler(request: InjectRequest, deps: AppServerDeps): Promise<InjectResponse> {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader(name: string, value: number | string | readonly string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    },
    end(chunk?: string | Buffer) {
      if (chunk != null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }
  } as ServerResponse;

  const response = await routeRequest(
    {
      method: request.method,
      url: request.url,
      headers: request.headers ?? {},
      rawBody: rawBodyFromInject(request.body)
    },
    deps
  );
  writeResponse(res, response);

  return {
    statusCode: res.statusCode,
    headers,
    body: Buffer.concat(chunks).toString('utf8')
  };
}

function rawBodyFromInject(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body == null) {
    return '';
  }
  return JSON.stringify(body);
}
