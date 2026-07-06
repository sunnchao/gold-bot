# App Server Runtime Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/app-server` the default Gold Bolt backend runtime for EA routes, admin APIs, AI result intake, and SSE while Go remains only as oracle and rollback reference.

**Architecture:** Keep `packages/trading-core` pure and computation-only, move runtime authority into `apps/app-server` service modules, and expand `packages/persistence` plus `packages/observability` to carry command state, shadow state, and cutover readiness. The first slice stops short of Go deletion and source-tree relocation for `agents/` and `web/dashboard/`, but it must make those clients consume Node as their primary backend authority.

**Tech Stack:** TypeScript, Node.js, pnpm workspace, Vitest, `node:http`, `node:sqlite`, existing `@gold-bot/*` workspace packages

---

## File Structure

- Create: `apps/app-server/src/http/json.ts`
- Create: `apps/app-server/src/http/response.ts`
- Create: `apps/app-server/src/middleware/auth.ts`
- Create: `apps/app-server/src/routes/ea.ts`
- Create: `apps/app-server/src/routes/admin.ts`
- Create: `apps/app-server/src/routes/ai.ts`
- Create: `apps/app-server/src/services/analysis/service.ts`
- Create: `apps/app-server/src/services/scheduler/service.ts`
- Create: `apps/app-server/src/services/command-lifecycle/service.ts`
- Create: `apps/app-server/src/services/shadow/service.ts`
- Create: `apps/app-server/src/services/shadow/service.spec.ts`
- Create: `apps/app-server/src/services/command-lifecycle/service.spec.ts`
- Modify: `apps/app-server/src/app.ts`
- Modify: `apps/app-server/src/app.spec.ts`
- Modify: `apps/app-server/src/index.ts`
- Create: `packages/shared-contracts/src/runtime.ts`
- Create: `packages/shared-contracts/src/runtime.spec.ts`
- Modify: `packages/shared-contracts/src/index.ts`
- Create: `packages/persistence/src/runtime-state.ts`
- Create: `packages/persistence/src/commands.ts`
- Create: `packages/persistence/src/shadow.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/persistence/src/index.spec.ts`
- Create: `packages/observability/src/sse.ts`
- Create: `packages/observability/src/shadow-report.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `packages/observability/src/index.spec.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.spec.ts`
- Modify: `agents/src/config/app-config.service.ts`
- Modify: `agents/src/config/app-config.service.test.ts`
- Modify: `.env.example`
- Modify: `apps/app-server/README.md`

## Task 1: Split `app-server` into route and auth modules without behavior change

**Files:**
- Create: `apps/app-server/src/http/json.ts`
- Create: `apps/app-server/src/http/response.ts`
- Create: `apps/app-server/src/middleware/auth.ts`
- Create: `apps/app-server/src/routes/ea.ts`
- Create: `apps/app-server/src/routes/admin.ts`
- Create: `apps/app-server/src/routes/ai.ts`
- Modify: `apps/app-server/src/app.ts`
- Modify: `apps/app-server/src/app.spec.ts`

- [ ] **Step 1: Write failing unit tests for extracted auth and route helpers**

```ts
import { describe, expect, it } from 'vitest';
import { extractRouteToken, authorizeRouteAccount } from './middleware/auth.js';

describe('route auth helpers', () => {
  it('prefers X-API-Token over X-API-Key and query token', () => {
    expect(
      extractRouteToken(
        { 'x-api-token': 'primary', 'x-api-key': 'secondary' },
        '/heartbeat?token=query-token',
      ),
    ).toBe('primary');
  });

  it('rejects account access when token binding does not match account id', () => {
    const allowed = authorizeRouteAccount(
      new Map([['token-a', new Set(['90011087'])]]),
      'token-a',
      '90022000',
      new Set(),
    );
    expect(allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm the modules do not exist yet**

Run: `pnpm --filter app-server test -- middleware/auth`
Expected: FAIL with module-not-found for `middleware/auth.ts`

- [ ] **Step 3: Add shared JSON and response helpers**

```ts
export type JsonResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
  rawBody?: string;
};

export function ok(body: unknown): JsonResponse {
  return { statusCode: 200, body };
}

export function error(statusCode: number, message: string): JsonResponse {
  return { statusCode, body: { status: 'ERROR', message } };
}
```

```ts
export function parseJsonObject(rawBody: string): { ok: true; body: Record<string, unknown> } | { ok: false } {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Extract auth helpers and route modules from `app.ts`**

```ts
export function extractRouteToken(headers: HeaderMap, url: string): string | null {
  return extractAuthToken(headers, url);
}

export function authorizeRouteAccount(
  tokenAccounts: Map<string, Set<string>> | null,
  token: string | null,
  accountId: string,
  adminTokens: Set<string>,
): boolean {
  if (token != null && adminTokens.has(token)) return true;
  if (tokenAccounts == null) return true;
  if (token == null) return false;
  const accounts = tokenAccounts.get(token);
  return accounts?.has(accountId) ?? false;
}
```

```ts
export function handleEaRoute(request: EaRouteRequest, deps: AppServerDeps): JsonResponse {
  if (request.method !== 'POST') {
    return error(405, 'method not allowed');
  }
  const token = extractRouteToken(request.headers, request.url);
  const parsed = parseJsonObject(request.rawBody);
  if (!parsed.ok) return error(400, 'invalid JSON');
  const accountId = stringFieldOrEmpty(parsed.body, 'account_id').trim();
  if (accountId.length === 0) return error(400, 'missing account_id');
  if (!authorizeRouteAccount(deps.tokenAccounts, token, accountId, deps.adminTokens)) {
    return error(403, 'token not authorized for account');
  }
  switch (request.path) {
    case '/register':
      deps.store.saveRegistration(parsed.body);
      return ok({ status: 'OK', message: 'registered' });
    case '/heartbeat':
      deps.store.saveHeartbeat(parsed.body);
      return ok({ status: 'OK', server_time: deps.nowUnix() });
    case '/tick':
      deps.store.saveTick(parsed.body);
      return ok({ status: 'OK' });
    case '/bars':
      deps.store.saveBars(parsed.body);
      return ok({ status: 'OK', received: Array.isArray(parsed.body.bars) ? parsed.body.bars.length : 0 });
    case '/positions':
      deps.store.savePositions(parsed.body);
      return ok({ status: 'OK', count: Array.isArray(parsed.body.positions) ? parsed.body.positions.length : 0 });
    case '/order_result':
      deps.store.saveOrderResult(parsed.body);
      return ok({ status: 'OK' });
    case '/poll':
      const commands = deps.store.pollCommands(accountId);
      return ok({ status: 'OK', commands, count: commands.length });
    default:
      return error(404, 'not found');
  }
}
```

```ts
export function handleAdminRoute(request: AdminRouteRequest, deps: AppServerDeps): JsonResponse {
  const parts = request.path.replace(/^\/+/, '').split('/');
  if (request.method !== 'GET') {
    return error(405, 'method not allowed');
  }
  if (parts[0] === 'api' && parts[1] === 'symbols' && parts[2] != null) {
    return ok(deps.store.listSymbols(parts[2]));
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'overview') {
    const accounts = accountSummaries(deps.store);
    return ok({ status: 'OK', generated_at: deps.nowIso(), cards: overviewCards(accounts), accounts });
  }
  if (parts[0] === 'api' && parts[1] === 'ai_symbols' && parts[2] != null) {
    return ok(deps.store.listAISymbols(parts[2]));
  }
  if (parts[0] === 'api' && parts[1] === 'pending_signal' && parts[2] != null && parts[3] != null) {
    return ok(deps.store.getPendingSignals(parts[2], parts[3]));
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'accounts') {
    return ok({ status: 'OK', accounts: accountSummaries(deps.store) });
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'audit') {
    return ok(buildAuditEnvelope(deps.store, deps.nowIso()));
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'events' && parts[3] === 'stream') {
    return {
      statusCode: 200,
      headers: eventStreamHeaders(),
      body: null,
      rawBody: buildEventStreamSnapshot(deps.store, deps.nowIso()),
    };
  }
  return error(404, 'not found');
}
```

```ts
export function handleAIRoute(request: AIRouteRequest, deps: AppServerDeps): JsonResponse {
  const parts = request.path.replace(/^\/+/, '').split('/');
  if (parts[0] === 'api' && parts[1] === 'analysis_payload' && parts[2] != null && request.method === 'GET') {
    return ok(analysisPayload(deps.store, parts[2], 'XAUUSD', deps.nowIso()));
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'ai_result' && parts[3] != null && parts[4] != null) {
    return handleAIResultRoute(request.method, parts[3], parts[4], request.rawBody, deps);
  }
  return error(404, 'not found');
}
```

- [ ] **Step 5: Reduce `app.ts` to wiring only**

```ts
async function routeRequest(request: RouteRequest, deps: AppServerDeps): Promise<JsonResponse> {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/healthz') {
    return ok({ status: 'ok', phase: 1 });
  }
  if (isEaCompatEndpoint(path)) {
    return handleEaRoute({ ...request, path }, deps);
  }
  if (path.startsWith('/api/')) {
    if (path.includes('/analysis_payload/') || path.includes('/ai_result/')) {
      return handleAIRoute({ ...request, path }, deps);
    }
    return handleAdminRoute({ ...request, path }, deps);
  }
  return error(404, 'not found');
}
```

- [ ] **Step 6: Run regression tests for the behavior-preserving extraction**

Run: `pnpm --filter app-server test`
Expected: PASS with existing EA/admin/AI fixture tests still green

- [ ] **Step 7: Commit the route split**

```bash
git add apps/app-server/src/app.ts apps/app-server/src/app.spec.ts apps/app-server/src/http apps/app-server/src/middleware apps/app-server/src/routes
git commit -m "refactor: split app-server routes and auth helpers"
```

## Task 2: Add runtime mode and command state persistence

**Files:**
- Create: `packages/shared-contracts/src/runtime.ts`
- Create: `packages/shared-contracts/src/runtime.spec.ts`
- Modify: `packages/shared-contracts/src/index.ts`
- Create: `packages/persistence/src/runtime-state.ts`
- Create: `packages/persistence/src/commands.ts`
- Create: `packages/persistence/src/shadow.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/persistence/src/index.spec.ts`

- [ ] **Step 1: Write failing tests for runtime modes and command states**

```ts
import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from './index.js';

describe('runtime state persistence', () => {
  it('defaults an unseen account to oracle mode', () => {
    const store = createInMemoryEaStore();
    expect(store.getRuntimeMode('90011087')).toBe('oracle');
  });

  it('moves commands from queued to delivered to acked', () => {
    const store = createInMemoryEaStore();
    const command = store.saveCommandCandidate('90011087', {
      source: 'ai_result',
      symbol: 'XAUUSD',
      action: 'SIGNAL',
      strategy: 'pullback',
      mode: 'approve',
    });
    store.setRuntimeMode('90011087', 'cutover');
    store.promoteCommand(command.command_id);
    expect(store.pollCommands('90011087')).toHaveLength(1);
    store.reconcileCommandResult('90011087', command.command_id, 'filled', 1001);
    expect(store.getCommand(command.command_id)?.status).toBe('acked');
  });
});
```

- [ ] **Step 2: Run persistence tests and confirm the APIs do not exist**

Run: `pnpm --filter @gold-bot/persistence test`
Expected: FAIL with missing `getRuntimeMode`, `setRuntimeMode`, `saveCommandCandidate`, and `reconcileCommandResult`

- [ ] **Step 3: Add shared runtime enums and types**

```ts
export const runtimeModes = ['oracle', 'shadow', 'cutover', 'rollback'] as const;
export type RuntimeMode = (typeof runtimeModes)[number];

export const commandStatuses = ['draft', 'shadow_only', 'queued', 'delivered', 'acked', 'rejected', 'failed', 'superseded'] as const;
export type CommandStatus = (typeof commandStatuses)[number];
```

- [ ] **Step 4: Extend persistence interfaces and SQLite schema**

```ts
export type RuntimeStateRecord = {
  account_id: string;
  mode: RuntimeMode;
  cutover_enabled: boolean;
  updated_at: string;
};

export type StoredCommand = EaCommand & {
  account_id: string;
  status: CommandStatus;
  source: 'ea_analysis' | 'position_review' | 'ai_result';
  created_at: string;
  delivered_at?: string;
  result?: string;
};
```

```sql
CREATE TABLE IF NOT EXISTS runtime_state (
  account_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  cutover_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runtime_commands (
  command_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  ticket INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 5: Implement explicit command promotion and reconciliation APIs**

```ts
saveCommandCandidate(accountId: string, candidate: CommandCandidate): StoredCommand
promoteCommand(commandId: string): void
getCommand(commandId: string): StoredCommand | undefined
getRuntimeMode(accountId: string): RuntimeMode
setRuntimeMode(accountId: string, mode: RuntimeMode): void
reconcileCommandResult(accountId: string, commandId: string, result: string, ticket?: number): void
```

```ts
pollCommands(accountId: string) {
  const queued = commandsFor(accountId).filter((command) => command.status === 'queued');
  for (const command of queued) {
    command.status = 'delivered';
    command.delivered_at = nowIso();
  }
  return queued.map(toEaCommand);
}
```

- [ ] **Step 6: Run persistence and shared-contracts verification**

Run: `pnpm --filter @gold-bot/shared-contracts test`
Expected: PASS

Run: `pnpm --filter @gold-bot/persistence test`
Expected: PASS with in-memory and SQLite state-machine coverage green

- [ ] **Step 7: Commit the runtime state model**

```bash
git add packages/shared-contracts/src packages/persistence/src
git commit -m "feat: add runtime modes and command state persistence"
```

## Task 3: Replace placeholder audit and SSE ownership with real observability state

**Files:**
- Create: `packages/observability/src/sse.ts`
- Create: `packages/observability/src/shadow-report.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `packages/observability/src/index.spec.ts`
- Modify: `packages/persistence/src/shadow.ts`
- Create: `apps/app-server/src/services/shadow/service.ts`
- Create: `apps/app-server/src/services/shadow/service.spec.ts`
- Modify: `apps/app-server/src/routes/admin.ts`
- Modify: `apps/app-server/src/app.spec.ts`

- [ ] **Step 1: Write failing tests for real audit reporting**

```ts
it('renders /api/v1/audit from persisted shadow state instead of placeholders', async () => {
  const store = createInMemoryEaStore();
  store.recordShadowComparison({
    account_id: '90011087',
    symbol: 'XAUUSD',
    protocol_ok: true,
    signal_drift: false,
    command_drift: true,
    created_at: '2026-07-02T12:00:00.000Z',
  });

  const server = createAppServer({ store, nowIso: () => '2026-07-02T12:05:00.000Z' });
  const response = await server.inject({ method: 'GET', url: '/api/v1/audit' });
  const body = JSON.parse(response.body);

  expect(body.report.ready).toBe(false);
  expect(body.report.last_shadow_event_at).toBe('2026-07-02T12:00:00.000Z');
  expect(body.report.command_drift_rate).toBeGreaterThan(0);
  expect(body.report.missing_capabilities).not.toContain('shadow_traffic');
});
```

- [ ] **Step 2: Run the relevant tests and confirm audit is still hardcoded**

Run: `pnpm --filter app-server test -- audit`
Expected: FAIL because `/api/v1/audit` still returns the placeholder report from `app.ts`

- [ ] **Step 3: Add shadow comparison persistence and report formatters**

```ts
export type ShadowComparison = {
  account_id: string;
  symbol: string;
  protocol_ok: boolean;
  signal_drift: boolean;
  command_drift: boolean;
  created_at: string;
};
```

```ts
export function buildShadowReport(comparisons: ShadowComparison[]): CutoverReport {
  const total = comparisons.length;
  const protocolErrors = comparisons.filter((item) => !item.protocol_ok).length;
  const signalDrifts = comparisons.filter((item) => item.signal_drift).length;
  const commandDrifts = comparisons.filter((item) => item.command_drift).length;
  const last = comparisons.at(-1)?.created_at ?? '';
  return {
    ready: total > 0 && protocolErrors === 0 && signalDrifts / Math.max(total, 1) <= 0.02 && commandDrifts / Math.max(total, 1) <= 0.02,
    protocol_error_rate: total === 0 ? 0 : protocolErrors / total,
    signal_drift_rate: total === 0 ? 0 : signalDrifts / total,
    command_drift_rate: total === 0 ? 0 : commandDrifts / total,
    last_shadow_event_at: last,
    missing_capabilities: total === 0 ? ['shadow_traffic'] : [],
  };
}
```

```ts
export function buildAuditEnvelope(store: EaStore, nowIso: () => string) {
  const comparisons = store.listShadowComparisons();
  const report = buildShadowReport(comparisons);
  return {
    status: 'OK',
    generated_at: nowIso(),
    summary: buildAuditSummary(report),
    report,
    events: store.listAuditEvents(),
  };
}
```

```ts
export function eventStreamHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };
}
```

```ts
export function formatSseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
```

```ts
export function buildEventStreamSnapshot(store: EaStore, nowIso: () => string): string {
  const events = store.listAuditEvents();
  const seed = events.length === 0 ? [{ event_id: 'bootstrap', event_type: 'audit.snapshot', source: 'app-server', timestamp: nowIso(), payload: null }] : events;
  return seed.map((event) => formatSseFrame(event)).join('');
}
```

- [ ] **Step 4: Replace admin-route placeholders with shadow service calls**

```ts
const shadowService = createShadowService(deps.store);
const report = shadowService.auditReport();
return ok({
  status: 'OK',
  generated_at: deps.nowIso(),
  summary: report.summary,
  report: report.report,
  events: report.events,
});
```

- [ ] **Step 5: Route event streaming through `@gold-bot/observability`**

```ts
return {
  statusCode: 200,
  headers: eventStreamHeaders(),
  body: null,
  rawBody: snapshotEvents.map((event) => formatSseFrame(event)).join(''),
};
```

- [ ] **Step 6: Run observability and app-server verification**

Run: `pnpm --filter @gold-bot/observability test`
Expected: PASS

Run: `pnpm --filter app-server test`
Expected: PASS with audit and SSE tests no longer depending on hardcoded placeholder state

- [ ] **Step 7: Commit the shadow and audit slice**

```bash
git add packages/observability/src packages/persistence/src/shadow.ts apps/app-server/src/services/shadow apps/app-server/src/routes/admin.ts apps/app-server/src/app.spec.ts
git commit -m "feat: back audit and sse with real shadow state"
```

## Task 4: Introduce analysis orchestration, scheduler, and unified command pipeline

**Files:**
- Create: `apps/app-server/src/services/analysis/service.ts`
- Create: `apps/app-server/src/services/scheduler/service.ts`
- Create: `apps/app-server/src/services/command-lifecycle/service.ts`
- Create: `apps/app-server/src/services/command-lifecycle/service.spec.ts`
- Modify: `apps/app-server/src/routes/ea.ts`
- Modify: `apps/app-server/src/routes/ai.ts`
- Modify: `apps/app-server/src/app.spec.ts`

- [ ] **Step 1: Write failing tests for mode-aware command issuance**

```ts
it('keeps analysis-derived commands shadow_only while the account is in shadow mode', async () => {
  const store = createInMemoryEaStore();
  store.setRuntimeMode('90011087', 'shadow');
  const server = createAppServer({ store });

  await server.inject({
    method: 'POST',
    url: '/api/v2/ai_result/90011087/XAUUSD',
    body: {
      trade_plan: {
        decision_id: 'd-1',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        confidence: 80,
        entry_price: 3345.5,
        stop_loss: 3338,
        take_profit: [3358],
      },
    },
  });

  expect(store.listCommands('90011087').map((command) => command.status)).toEqual(['shadow_only']);
  expect(store.pollCommands('90011087')).toEqual([]);
});

it('queues commands only for cutover accounts', async () => {
  const store = createInMemoryEaStore();
  store.setRuntimeMode('90011087', 'cutover');
  const server = createAppServer({ store });
  await server.inject({
    method: 'POST',
    url: '/api/v2/ai_result/90011087/XAUUSD',
    body: {
      trade_plan: {
        decision_id: 'd-1',
        account_id: '90011087',
        symbol: 'XAUUSD',
        mode: 'approve',
        side: 'buy',
        confidence: 80,
        entry_price: 3345.5,
        stop_loss: 3338,
        take_profit: [3358],
      },
    },
  });
  expect(store.pollCommands('90011087')).toHaveLength(1);
});
```

- [ ] **Step 2: Run app-server tests and confirm there is no unified command lifecycle yet**

Run: `pnpm --filter app-server test -- command-lifecycle`
Expected: FAIL with missing lifecycle service and missing runtime-mode-aware queue behavior

- [ ] **Step 3: Add a synchronous analysis service over current `trading-core` outputs**

```ts
export class AnalysisService {
  constructor(private readonly store: EaStore, private readonly nowIso: () => string) {}

  analyzeAccountSymbol(accountId: string, symbol: string) {
    const replay = runReplay(loadReplaySnapshot(this.store, accountId, symbol, this.nowIso()));
    const positionSummary = summarizePositions(loadPositionSummaryInput(this.store, accountId, symbol));
    return { replay, positionSummary };
  }
}
```

- [ ] **Step 4: Add the unified command lifecycle service**

```ts
export class CommandLifecycleService {
  constructor(private readonly store: EaStore, private readonly nowIso: () => string) {}

  acceptCandidate(accountId: string, candidate: CommandCandidate) {
    const mode = this.store.getRuntimeMode(accountId);
    const command = this.store.saveCommandCandidate(accountId, candidate);
    if (mode === 'cutover') {
      this.store.promoteCommand(command.command_id);
    }
    if (mode === 'oracle' || mode === 'shadow' || mode === 'rollback') {
      this.store.demoteCommandToShadowOnly(command.command_id);
    }
    return this.store.getCommand(command.command_id)!;
  }

  reconcile(accountId: string, commandId: string, result: string, ticket?: number) {
    this.store.reconcileCommandResult(accountId, commandId, result, ticket);
  }
}
```

- [ ] **Step 5: Hook EA bars/positions and AI results into the same pipeline**

```ts
case '/bars':
  deps.store.saveBars(parsed.body);
  deps.scheduler.enqueueAnalysis(accountId, symbol, timeframe);
  return ok({ status: 'OK', received: bars.length });
```

```ts
const candidate = tradePlanToCommandCandidate(accountId, symbol, tradePlan, riskGate, deps.nowIso());
const stored = deps.commandLifecycle.acceptCandidate(accountId, candidate);
return ok({
  status: 'OK',
  received: true,
  decision: { decision_id: stored.command_id, mode: tradePlan.mode, symbol, confidence: tradePlan.confidence },
  risk_gate: riskGate,
  command_status: stored.status,
});
```

- [ ] **Step 6: Run the runtime-critical verification set**

Run: `pnpm --filter app-server test`
Expected: PASS with `/poll` still empty for non-cutover accounts and live queueing enabled only for cutover accounts

Run: `pnpm --filter @gold-bot/persistence test`
Expected: PASS

Run: `pnpm --filter @gold-bot/trading-core test`
Expected: PASS

- [ ] **Step 7: Commit the unified runtime pipeline**

```bash
git add apps/app-server/src/services apps/app-server/src/routes apps/app-server/src/app.spec.ts
git commit -m "feat: add unified app-server command pipeline"
```

## Task 5: Make Node the default backend authority for current clients and docs

**Files:**
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.spec.ts`
- Modify: `agents/src/config/app-config.service.ts`
- Modify: `agents/src/config/app-config.service.test.ts`
- Modify: `.env.example`
- Modify: `apps/app-server/README.md`

- [ ] **Step 1: Write failing tests for Node-first backend defaults**

```ts
import { describe, expect, it } from 'vitest';
import { validateConfig } from './app-config.service.js';

describe('agent backend defaults', () => {
  it('defaults GOLDBOT_API_URL to the Node app-server port', () => {
    const config = validateConfig({ ACCOUNTS_CONFIG: '[{"id":"90011087","symbols":["XAUUSD"]}]' });
    expect(config.goldbotApiUrl).toBe('http://127.0.0.1:3000');
  });
});
```

- [ ] **Step 2: Run the affected tests and confirm current defaults still point at Go**

Run: `pnpm --filter app-agent test -- app-config.service`
Expected: FAIL because `goldbotApiUrl` currently defaults to `http://localhost:8880`

- [ ] **Step 3: Change defaults and documentation to point at app-server**

```ts
goldbotApiUrl: env.GOLDBOT_API_URL ?? 'http://127.0.0.1:3000',
```

```env
GOLDBOT_API_URL=http://127.0.0.1:3000
GB_APP_SERVER_HOST=127.0.0.1
GB_APP_SERVER_PORT=3000
GB_NODE_SHADOW_MODE=true
```

```md
Current behavior:
- `GET /healthz` returns `{"status":"ok","phase":1}`.
- EA routes, admin APIs, AI routes, and SSE now run through Node `app-server`.
- Go remains oracle-only until later cutover phases.
```

- [ ] **Step 4: Add an app-server integration regression for client-facing Node authority**

```ts
it('continues to serve overview and event stream data from the Node runtime', async () => {
  const server = createAppServer();
  expect((await server.inject({ method: 'GET', url: '/api/v1/overview' })).statusCode).toBe(200);
  expect((await server.inject({ method: 'GET', url: '/api/v1/events/stream' })).statusCode).toBe(200);
});
```

- [ ] **Step 5: Run the integration checkpoint commands**

Run: `pnpm --filter app-server build`
Expected: PASS

Run: `pnpm --filter @gold-bot/persistence build`
Expected: PASS

Run: `pnpm --filter @gold-bot/trading-core build`
Expected: PASS

Run: `GOCACHE=.cache/go-build go test ./internal/... -count=1`
Expected: PASS

- [ ] **Step 6: Commit the Node-first authority defaults**

```bash
git add packages/config/src agents/src/config .env.example apps/app-server/README.md apps/app-server/src/app.spec.ts
git commit -m "chore: point clients at node app-server authority"
```

## Self-Review Checklist

- [ ] Every task maps back to the approved spec:
  - route and auth split
  - runtime modes and command states
  - real audit/shadow state
  - unified command pipeline
  - Node-first backend authority for clients
- [ ] No task deletes Go or moves `agents/` / `web/dashboard/` source trees
- [ ] No step introduces live issuance without explicit `cutover` mode
- [ ] Every code-changing step includes code and exact commands
- [ ] Every verification command uses the narrowed runtime-critical suite for fast iteration and the documented stage-check suite for integration
