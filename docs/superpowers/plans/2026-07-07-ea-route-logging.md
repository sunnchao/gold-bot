# EA Route Detailed Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit detailed, safe server logs for accepted `/register`, `/heartbeat`, and `/tick` EA requests.

**Architecture:** Add an optional logger to app-server options and EA route dependencies. Log only after the endpoint write succeeds, using endpoint-specific field whitelists and one stable prefix per route. Tests inject a collector so assertions do not depend on global console output.

**Tech Stack:** TypeScript, Node HTTP app server, Vitest, pnpm workspace.

---

## Files

- Modify: `apps/app-server/src/app.ts`
  - Add `log?: (message: string) => void` to `AppServerOptions`.
  - Store the logger in app deps, defaulting to no-op for test-friendly server construction.
  - Pass the logger into `handleEaRoute`.
- Modify: `apps/app-server/src/index.ts`
  - Pass `console.log` into `createAppServer()` for the production runtime entrypoint.
- Modify: `apps/app-server/src/routes/ea.ts`
  - Add `log?: (message: string) => void` to `EaRouteDeps`.
  - Emit `/register`, `/heartbeat`, and `/tick` lifecycle logs after successful persistence.
  - Add small helpers for formatting whitelisted key/value fields.
- Modify: `apps/app-server/src/app.spec.ts`
  - Add regression tests for accepted lifecycle logs.
  - Add a regression test that invalid lifecycle requests emit no success log and no token/header data.

## Task 1: Logging Contract Tests

- [ ] **Step 1: Add failing tests in `apps/app-server/src/app.spec.ts`**

Add tests near the existing EA lifecycle route tests:

```ts
  it('logs accepted register heartbeat and tick lifecycle details without token data', async () => {
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
```

- [ ] **Step 2: Run the targeted test and verify red**

Run:

```bash
pnpm --filter app-server test -- src/app.spec.ts -t "EA lifecycle"
```

Expected: FAIL because `log` is not a known `AppServerOptions` property and no lifecycle logs are emitted.

## Task 2: Implement Logger Wiring and Formatting

- [ ] **Step 1: Update `apps/app-server/src/app.ts`**

Add the logger to app options and deps:

```ts
export type AppServerOptions = {
  // Add near the other optional runtime dependencies.
  log?: (message: string) => void;
};

type AppServerDeps = {
  // Add near recordHttp/metrics dependencies.
  log: (message: string) => void;
};
```

Initialize and pass it:

```ts
const baseDeps = {
  // Add alongside releaseRoot/events/alerts setup.
  log: options.log ?? (() => {})
};
```

In the `routeEa()` dependency object, add:

```ts
log: deps.log,
```

- [ ] **Step 2: Update `apps/app-server/src/routes/ea.ts`**

Add the dependency field:

```ts
log?: (message: string) => void;
```

After each successful save:

```ts
await deps.store.saveRegistration(parsed.body);
logEaLifecycle(deps.log, 'register', parsed.body);
return ok({ status: 'OK', message: 'registered' });
```

```ts
await deps.store.saveHeartbeat(parsed.body);
logEaLifecycle(deps.log, 'heartbeat', parsed.body);
return ok({ status: 'OK', server_time: deps.nowUnix() });
```

```ts
await deps.store.saveTick(parsed.body);
logEaLifecycle(deps.log, 'tick', parsed.body);
return ok({ status: 'OK' });
```

Add formatting helpers:

```ts
type EaLifecycleLogKind = 'register' | 'heartbeat' | 'tick';

function logEaLifecycle(log: ((message: string) => void) | undefined, kind: EaLifecycleLogKind, body: EaRecord): void {
  if (log == null) {
    return;
  }
  log(formatEaLifecycleLog(kind, body));
}
```

Use explicit field lists per endpoint and convert arrays/objects to compact summaries. Do not include headers, URL tokens, or raw request bodies.

- [ ] **Step 3: Run targeted tests and verify green**

Run:

```bash
pnpm --filter app-server test -- src/app.spec.ts -t "EA lifecycle"
```

Expected: PASS for the lifecycle tests.

## Task 3: Full Package Verification

- [ ] **Step 1: Run app-server tests**

Run:

```bash
pnpm --filter app-server test
```

Expected: PASS.

- [ ] **Step 2: Run app-server typecheck**

Run:

```bash
pnpm --filter app-server typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect changed file scope**

Run:

```bash
git diff --stat HEAD
```

Expected: changes limited to app-server route/server files plus this spec and plan.
