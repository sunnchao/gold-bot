# EA Route Detailed Logging Design

## Goal

Add detailed server-side logs for the EA lifecycle endpoints `/register`, `/heartbeat`, and `/tick` in the Node app server. The logs should help confirm that live EA traffic is reaching the server and show the key account and market fields needed for operations debugging.

## Scope

- Implement in `apps/app-server/src/routes/ea.ts`, where the EA compatibility endpoints are handled.
- Wire logging through `createAppServer()` so production runtime writes to `console.log`.
- Keep tests able to inject a log collector without depending on global console output.
- Do not modify Go source files.
- Do not modify MQL4 or MQL5 EA code.
- Do not log API tokens, request headers, or full raw request bodies.

## Approach

Use a small injected logger function on the EA route dependencies.

- `/register`: log after `saveRegistration()` succeeds.
- `/heartbeat`: log after `saveHeartbeat()` succeeds.
- `/tick`: log after `saveTick()` succeeds.
- Other EA routes stay unchanged.
- Failed auth, invalid JSON, validation failures, and persistence failures do not emit successful receipt logs.

This keeps logging close to the endpoint side effect and avoids duplicating parsing or persistence logic elsewhere.

## Log Format

Use one line per accepted request with a stable prefix and endpoint-specific key/value fields.

- Register: `[EA-REGISTER] account_id=... broker=... server_name=... account_name=... account_type=... currency=... leverage=... strategies=... ai_symbols=...`
- Heartbeat: `[EA-HEARTBEAT] account_id=... balance=... equity=... margin=... free_margin=... market_open=... is_trade_allowed=... server_time=... ai_symbols=...`
- Tick: `[EA-TICK] account_id=... symbol=... bid=... ask=... spread=... time=...`

Values come from validated, normalized payload fields where normalization exists. Optional missing values are printed as empty values, not as raw JSON.

## Testing

Add app-server route tests that inject a log collector and verify:

- accepted `/register`, `/heartbeat`, and `/tick` requests emit the expected prefixed log lines;
- logs include useful endpoint fields;
- logs do not include `X-API-Token` or the test token value;
- invalid requests do not emit lifecycle success logs.

Run targeted app-server tests and typecheck.
