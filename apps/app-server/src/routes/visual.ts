import type { EaRecord, EaStore } from '@gold-bot/persistence';
import type { HeaderMap } from '@gold-bot/shared-contracts';
import { parseJsonObject } from '../http/json.js';
import { error, type JsonResponse } from '../http/response.js';
import { authorizeApiAccount, requireRouteToken } from '../middleware/auth.js';
import type { IndicatorAlert, IndicatorAlertCache } from './indicator-alert.js';

export type VisualRouteRequest = {
  method: string;
  path: string;
  headers: HeaderMap;
  url: string;
  rawBody: string;
};

export type VisualRouteDeps = {
  store: EaStore;
  nowIso: () => string;
  validTokens: Set<string> | null;
  tokenAccounts: Map<string, Set<string>> | null;
  adminTokens: Set<string>;
  alerts: IndicatorAlertCache;
};

export async function handleVisualRoute(request: VisualRouteRequest, deps: VisualRouteDeps): Promise<JsonResponse> {
  if (request.path !== '/visual/poll') {
    return error(404, 'not found');
  }
  const tokenResult = requireRouteToken(deps.validTokens, request.headers, request.url);
  if (tokenResult.response != null) {
    return tokenResult.response;
  }
  if (request.method !== 'POST') {
    return error(405, 'method not allowed');
  }

  const parsed = parseJsonObject(request.rawBody);
  if (!parsed.ok) {
    return error(400, 'invalid json');
  }
  const accountId = stringField(parsed.body, 'account_id').trim();
  const symbol = stringField(parsed.body, 'symbol').trim();
  const timeframe = stringField(parsed.body, 'timeframe').trim();
  if (accountId.length === 0 || symbol.length === 0) {
    return error(400, 'account_id and symbol are required');
  }
  if (!authorizeApiAccount(deps.tokenAccounts, tokenResult.token, accountId, deps.adminTokens)) {
    return error(403, 'forbidden');
  }

  const alerts = deps.alerts.recent().filter((alert) => alertMatchesVisualPoll(alert, symbol, timeframe));
  return {
    statusCode: 200,
    body: {
      status: 'ok',
      account_id: accountId,
      symbol,
      timeframe,
      server_time: deps.nowIso(),
      tick: visualTick(await deps.store.getLatestTick(accountId, symbol), symbol),
      ai: visualAI(await deps.store.getAIResults(accountId), symbol),
      alerts,
      count: alerts.length
    }
  };
}

function visualTick(tick: EaRecord | undefined, symbol: string): EaRecord {
  if (tick == null) {
    return {
      symbol,
      bid: 0,
      ask: 0,
      spread: 0,
      time: ''
    };
  }
  return {
    symbol: stringField(tick, 'symbol') || symbol,
    bid: numberField(tick, 'bid'),
    ask: numberField(tick, 'ask'),
    spread: numberField(tick, 'spread'),
    time: stringField(tick, 'time')
  };
}

function visualAI(results: EaRecord[], symbol: string): EaRecord {
  const result = [...results].reverse().find((entry) => stringField(entry, 'symbol').toLowerCase() === symbol.toLowerCase());
  if (result == null) {
    return {
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
    };
  }
  const tradePlan = recordField(result, 'trade_plan') ?? {};
  const entryZone = recordField(tradePlan, 'entry_zone') ?? {};
  const riskGate = recordField(result, 'risk_gate') ?? recordField(tradePlan, 'risk_gate') ?? {};
  const summary = {
    has_result: false,
    bias: stringField(result, 'bias'),
    confidence: numberField(result, 'confidence'),
    exit_suggestion: stringField(result, 'exit_suggestion'),
    risk_alert: result.risk_alert === true,
    alert_reason: stringField(result, 'alert_reason'),
    decision_id: stringField(result, 'decision_id') || stringField(tradePlan, 'decision_id'),
    trade_plan_mode: stringField(result, 'trade_plan_mode') || stringField(tradePlan, 'mode'),
    side: stringField(result, 'side') || stringField(tradePlan, 'side'),
    entry_min: numberField(entryZone, 'min'),
    entry_max: numberField(entryZone, 'max'),
    stop_loss: numberField(result, 'stop_loss') || numberField(tradePlan, 'stop_loss'),
    take_profit: numberField(result, 'take_profit') || firstPositiveNumber(tradePlan.take_profit),
    risk_gate_status: stringField(result, 'risk_gate_status') || stringField(riskGate, 'status'),
    narrative: stringField(result, 'narrative') || stringField(tradePlan, 'narrative')
  };
  summary.has_result = visualSummaryHasResult(summary);
  return summary;
}

function visualSummaryHasResult(summary: EaRecord): boolean {
  return (
    stringField(summary, 'bias').length > 0 ||
    numberField(summary, 'confidence') > 0 ||
    stringField(summary, 'exit_suggestion').length > 0 ||
    summary.risk_alert === true ||
    stringField(summary, 'alert_reason').length > 0 ||
    stringField(summary, 'decision_id').length > 0 ||
    stringField(summary, 'trade_plan_mode').length > 0 ||
    stringField(summary, 'side').length > 0 ||
    numberField(summary, 'entry_min') > 0 ||
    numberField(summary, 'entry_max') > 0 ||
    numberField(summary, 'stop_loss') > 0 ||
    numberField(summary, 'take_profit') > 0 ||
    stringField(summary, 'risk_gate_status').length > 0 ||
    stringField(summary, 'narrative').length > 0
  );
}

function alertMatchesVisualPoll(alert: IndicatorAlert, symbol: string, timeframe: string): boolean {
  const alertSymbol = stringField(alert, 'symbol').trim();
  const alertTimeframe = stringField(alert, 'timeframe').trim();
  return (
    (alertSymbol.length === 0 || alertSymbol.toLowerCase() === symbol.toLowerCase()) &&
    (alertTimeframe.length === 0 || alertTimeframe.toLowerCase() === timeframe.toLowerCase())
  );
}

function recordField(record: EaRecord, field: string): EaRecord | undefined {
  const value = record[field];
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as EaRecord) : undefined;
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function firstPositiveNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : 0;
  }
  if (!Array.isArray(value)) {
    return 0;
  }
  for (const entry of value) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      return entry;
    }
  }
  return 0;
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}
