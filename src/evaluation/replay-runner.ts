import { Injectable } from '@nestjs/common';
import type { AISignalResult, TradePlan } from '../types/agent.js';
import type { GoldbotPayload, PendingSignal } from '../types/goldbot.js';

const REPLAY_FIXTURE_SCHEMA_VERSION = 'replay_fixture.v1' as const;
const REPLAY_REPORT_SCHEMA_VERSION = 'replay_report.v1' as const;
const REDACTED = '[REDACTED]';

type JsonObject = Record<string, unknown>;

export interface ReplayLlmResponseInput {
  agent: string;
  model?: string;
  prompt?: unknown;
  systemPrompt?: unknown;
  rawResponse: string;
  parsedOutput?: unknown;
  parseError?: string;
}

export interface ReplayLlmResponse {
  agent: string;
  model?: string;
  prompt?: unknown;
  system_prompt?: unknown;
  raw_response: string;
  parsed_output?: unknown;
  parse_error?: string;
}

export type ReplayParsedOutputs = Record<string, unknown>;

export interface CaptureReplayFixtureInput {
  fixtureId: string;
  capturedAt?: string;
  accountId: string;
  symbol: string;
  analysisPayload: GoldbotPayload;
  pendingSignal?: PendingSignal;
  llmResponses: ReplayLlmResponseInput[];
  parsedOutputs: ReplayParsedOutputs;
  finalSignal?: AISignalResult;
  finalTradePlan?: TradePlan;
}

export interface ReplayFixture {
  schema_version: typeof REPLAY_FIXTURE_SCHEMA_VERSION;
  fixture_id: string;
  captured_at: string;
  account_id: string;
  symbol: string;
  analysis_payload: GoldbotPayload;
  pending_signal?: PendingSignal;
  llm_responses: ReplayLlmResponse[];
  parsed_outputs: ReplayParsedOutputs;
  final_signal?: AISignalResult;
  final_trade_plan?: TradePlan;
}

export interface ReplayCandidateResult {
  fixture_id: string;
  account_id: string;
  symbol: string;
  source: 'fixture' | 'candidate' | 'live' | string;
  parsed_outputs: ReplayParsedOutputs;
  raw_llm_responses?: ReplayLlmResponse[];
  final_signal?: AISignalResult;
  trade_plan?: TradePlan;
  parse_failures: string[];
}

export type ReplayCandidateRunner = (
  fixture: ReplayFixture,
) => Promise<ReplayCandidateResult> | ReplayCandidateResult;

export interface ReplayFixtureOptions {
  allowLiveLlm?: boolean;
  liveRunner?: ReplayCandidateRunner;
}

export interface DriftMetricOptions {
  stopLossTolerance?: number;
  maxLotsTolerance?: number;
}

export interface ReplayAuditMetrics {
  total_fixtures: number;
  compared_fixtures: number;
  parse_failure_count: number;
  parse_failure_rate: number;
  direction_drift_count: number;
  direction_drift_rate: number;
  mode_drift_count: number;
  mode_drift_rate: number;
  stop_loss_drift_count: number;
  stop_loss_drift_rate: number;
  stop_loss_average_abs_delta: number;
  stop_loss_max_abs_delta: number;
  max_lots_drift_count: number;
  max_lots_drift_rate: number;
  max_lots_average_abs_delta: number;
  max_lots_max_abs_delta: number;
}

export interface ReplayFixturesOptions extends ReplayFixtureOptions {
  candidateRunner?: ReplayCandidateRunner;
  metrics?: DriftMetricOptions;
}

export interface ReplayReport {
  schema_version: typeof REPLAY_REPORT_SCHEMA_VERSION;
  generated_at: string;
  fixture_count: number;
  baseline_results: ReplayCandidateResult[];
  candidate_results: ReplayCandidateResult[];
  metrics: ReplayAuditMetrics;
}

const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|bearer|token|secret|password|passwd|webhook|cookie|signature|sign)$/i;

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED)
    .replace(
      /\b((?:api[_-]?key|token|secret|password|authorization)=)[^\s&"']+/gi,
      `$1${REDACTED}`,
    );
}

function redactUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, seen));
  }

  const redacted: JsonObject = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactUnknown(entry, seen);
  }
  return redacted;
}

export function redactSecrets<T>(value: T): T {
  return redactUnknown(value, new WeakSet<object>()) as T;
}

export function captureReplayFixture(input: CaptureReplayFixtureInput): ReplayFixture {
  const fixture: ReplayFixture = {
    schema_version: REPLAY_FIXTURE_SCHEMA_VERSION,
    fixture_id: input.fixtureId,
    captured_at: input.capturedAt ?? new Date().toISOString(),
    account_id: input.accountId,
    symbol: input.symbol,
    analysis_payload: redactSecrets(input.analysisPayload),
    llm_responses: input.llmResponses.map((response) =>
      redactSecrets({
        agent: response.agent,
        model: response.model,
        prompt: response.prompt,
        system_prompt: response.systemPrompt,
        raw_response: response.rawResponse,
        parsed_output: response.parsedOutput,
        parse_error: response.parseError,
      }),
    ),
    parsed_outputs: redactSecrets(input.parsedOutputs),
  };

  if (input.pendingSignal) {
    fixture.pending_signal = redactSecrets(input.pendingSignal);
  }
  if (input.finalSignal) {
    fixture.final_signal = redactSecrets(input.finalSignal);
  }
  if (input.finalTradePlan) {
    fixture.final_trade_plan = redactSecrets(input.finalTradePlan);
  }

  return fixture;
}

function parseFailuresFromResponses(responses: ReplayLlmResponse[]): string[] {
  return responses
    .filter((response) => response.parse_error || response.parsed_output == null)
    .map((response) =>
      response.parse_error ? `${response.agent}: ${response.parse_error}` : response.agent,
    );
}

function fixtureToCandidateResult(fixture: ReplayFixture): ReplayCandidateResult {
  return {
    fixture_id: fixture.fixture_id,
    account_id: fixture.account_id,
    symbol: fixture.symbol,
    source: 'fixture',
    parsed_outputs: fixture.parsed_outputs,
    raw_llm_responses: fixture.llm_responses,
    final_signal: fixture.final_signal,
    trade_plan: fixture.final_trade_plan,
    parse_failures: parseFailuresFromResponses(fixture.llm_responses),
  };
}

export async function replayFixture(
  fixture: ReplayFixture,
  options: ReplayFixtureOptions = {},
): Promise<ReplayCandidateResult> {
  if (options.allowLiveLlm) {
    if (!options.liveRunner) {
      throw new Error('allowLiveLlm requires a liveRunner');
    }
    return options.liveRunner(fixture);
  }

  return fixtureToCandidateResult(fixture);
}

function byFixtureId(results: ReplayCandidateResult[]): Map<string, ReplayCandidateResult> {
  return new Map(results.map((result) => [result.fixture_id, result]));
}

function directionOf(result: ReplayCandidateResult): string | undefined {
  return (
    result.trade_plan?.side ??
    result.final_signal?.arbitration?.direction ??
    result.final_signal?.bias
  );
}

function modeOf(result: ReplayCandidateResult): string | undefined {
  return result.trade_plan?.mode ?? result.final_signal?.arbitration?.action;
}

function stopLossOf(result: ReplayCandidateResult): number | undefined {
  const value = result.trade_plan?.stop_loss ?? result.final_signal?.suggested_sl;
  return Number.isFinite(value) ? value : undefined;
}

function maxLotsOf(result: ReplayCandidateResult): number | undefined {
  const value = result.trade_plan?.max_lots ?? result.final_signal?.max_position_size;
  return Number.isFinite(value) ? value : undefined;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function computeReplayMetrics(
  baseline: ReplayCandidateResult[],
  candidate: ReplayCandidateResult[],
  options: DriftMetricOptions = {},
): ReplayAuditMetrics {
  const baselineById = byFixtureId(baseline);
  const stopLossTolerance = options.stopLossTolerance ?? 0;
  const maxLotsTolerance = options.maxLotsTolerance ?? 0;

  let comparedFixtures = 0;
  let directionDriftCount = 0;
  let modeDriftCount = 0;
  let stopLossDriftCount = 0;
  let maxLotsDriftCount = 0;
  const stopLossDeltas: number[] = [];
  const maxLotsDeltas: number[] = [];

  for (const candidateResult of candidate) {
    const baselineResult = baselineById.get(candidateResult.fixture_id);
    if (!baselineResult) {
      continue;
    }

    comparedFixtures += 1;

    const baselineDirection = directionOf(baselineResult);
    const candidateDirection = directionOf(candidateResult);
    if (
      baselineDirection != null &&
      candidateDirection != null &&
      baselineDirection !== candidateDirection
    ) {
      directionDriftCount += 1;
    }

    const baselineMode = modeOf(baselineResult);
    const candidateMode = modeOf(candidateResult);
    if (baselineMode != null && candidateMode != null && baselineMode !== candidateMode) {
      modeDriftCount += 1;
    }

    const baselineStopLoss = stopLossOf(baselineResult);
    const candidateStopLoss = stopLossOf(candidateResult);
    if (baselineStopLoss != null && candidateStopLoss != null) {
      const delta = round(Math.abs(candidateStopLoss - baselineStopLoss));
      stopLossDeltas.push(delta);
      if (delta > stopLossTolerance) {
        stopLossDriftCount += 1;
      }
    }

    const baselineMaxLots = maxLotsOf(baselineResult);
    const candidateMaxLots = maxLotsOf(candidateResult);
    if (baselineMaxLots != null && candidateMaxLots != null) {
      const delta = round(Math.abs(candidateMaxLots - baselineMaxLots));
      maxLotsDeltas.push(delta);
      if (delta > maxLotsTolerance) {
        maxLotsDriftCount += 1;
      }
    }
  }

  const parseFailureCount = candidate.filter(
    (result) => result.parse_failures.length > 0,
  ).length;
  const totalFixtures = candidate.length;

  return {
    total_fixtures: totalFixtures,
    compared_fixtures: comparedFixtures,
    parse_failure_count: parseFailureCount,
    parse_failure_rate: rate(parseFailureCount, totalFixtures),
    direction_drift_count: directionDriftCount,
    direction_drift_rate: rate(directionDriftCount, comparedFixtures),
    mode_drift_count: modeDriftCount,
    mode_drift_rate: rate(modeDriftCount, comparedFixtures),
    stop_loss_drift_count: stopLossDriftCount,
    stop_loss_drift_rate: rate(stopLossDriftCount, comparedFixtures),
    stop_loss_average_abs_delta: average(stopLossDeltas),
    stop_loss_max_abs_delta:
      stopLossDeltas.length === 0 ? 0 : Math.max(...stopLossDeltas),
    max_lots_drift_count: maxLotsDriftCount,
    max_lots_drift_rate: rate(maxLotsDriftCount, comparedFixtures),
    max_lots_average_abs_delta: average(maxLotsDeltas),
    max_lots_max_abs_delta: maxLotsDeltas.length === 0 ? 0 : Math.max(...maxLotsDeltas),
  };
}

export async function replayFixtures(
  fixtures: ReplayFixture[],
  options: ReplayFixturesOptions = {},
): Promise<ReplayReport> {
  const baselineResults = await Promise.all(
    fixtures.map((fixture) => replayFixture(fixture)),
  );
  const candidateRunner = options.candidateRunner;
  const candidateResults = candidateRunner
    ? await Promise.all(fixtures.map((fixture) => candidateRunner(fixture)))
    : baselineResults;

  return {
    schema_version: REPLAY_REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    fixture_count: fixtures.length,
    baseline_results: baselineResults,
    candidate_results: candidateResults,
    metrics: computeReplayMetrics(baselineResults, candidateResults, options.metrics),
  };
}

@Injectable()
export class ReplayEvaluationService {
  captureFixture(input: CaptureReplayFixtureInput): ReplayFixture {
    return captureReplayFixture(input);
  }

  replayFixture(
    fixture: ReplayFixture,
    options?: ReplayFixtureOptions,
  ): Promise<ReplayCandidateResult> {
    return replayFixture(fixture, options);
  }

  replayFixtures(
    fixtures: ReplayFixture[],
    options?: ReplayFixturesOptions,
  ): Promise<ReplayReport> {
    return replayFixtures(fixtures, options);
  }

  computeMetrics(
    baseline: ReplayCandidateResult[],
    candidate: ReplayCandidateResult[],
    options?: DriftMetricOptions,
  ): ReplayAuditMetrics {
    return computeReplayMetrics(baseline, candidate, options);
  }
}
