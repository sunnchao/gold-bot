# Go Engine to AI Agents API Contracts

This document records the HTTP contract between the Go trading engine and the NestJS AI agents service. The agents runtime validation lives in `agents/src/types/schemas.ts`.

All requests from agents to the Go engine include `X-API-Token: <GOLDBOT_API_TOKEN>`.

## GET `/api/v2/analysis_payload/:accountId/:symbol`

Returns the market, account, position, strategy mapping, indicator, trend, and context payload used by the agents workflow.

- Producer: Go engine
- Consumer: `agents/src/tools/goldbot-api.ts`
- Response schema: `GoldbotPayloadSchema` in `agents/src/types/schemas.ts`
- Path parameters:
  - `accountId`: EA account identifier
  - `symbol`: trading symbol, for example `XAUUSD`

## GET `/api/ai_symbols/:accountId`

Returns the list of symbols that should be analyzed for an account.

- Producer: Go engine
- Consumer: `agents/src/tools/goldbot-api.ts`
- Response body: `string[]`

## GET `/api/pending_signal/:accountId/:symbol`

Returns the current pending strategy signal for a symbol, if one exists.

- Producer: Go engine
- Consumer: `agents/src/tools/goldbot-api.ts`
- Response schema: `PendingSignalSchema` or `PendingSignalSchema[]` in `agents/src/types/schemas.ts`
- Empty result behavior: agents treat `404` or `204` as no pending signal.

## POST `/api/v2/ai_result/:accountId/:symbol`

Submits AI analysis output and trade-plan decisions back to the Go engine.

- Producer: AI agents
- Consumer: Go engine
- Request schema: AI result and trade-plan schemas in `agents/src/types/schemas.ts`
- Response: success status with a JSON body accepted by the agents client as `unknown`

The Go engine stores the submitted result for audit and can convert accepted trade-plan decisions into downstream EA commands.
