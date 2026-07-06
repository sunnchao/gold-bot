/**
 * Conditional edge / routing functions for the analysis workflow.
 */

import type { AnalysisGraphStateType } from "./state.js";

// ─── routeAfterFetch ──────────────────────────────────────────────────────────

function logRouteAfterFetch(
  state: AnalysisGraphStateType,
  decision: "error" | "skip" | "analyze",
  reason: string,
): void {
  console.debug("routeAfterFetch", {
    decision,
    reason,
    primarySymbol: state.symbol,
    symbols: state.symbols,
    payloadSymbols: Object.keys(state.payloads ?? {}),
    primaryMarketOpen:
      (state.payload ?? state.payloads?.[state.symbol])?.market_status
        ?.market_open,
    errorCount: state.errors.length,
  });
}

export function routeAfterFetch(
  state: AnalysisGraphStateType,
): "error" | "skip" | "analyze" {
  const primaryPayload = state.payload ?? state.payloads?.[state.symbol];
  const payloadValues = Object.values(state.payloads ?? {});

  // If fetching produced errors and no payload, route to error
  if (state.errors.length > 0 && !primaryPayload) {
    logRouteAfterFetch(state, "error", "errors-without-primary-payload");
    return "error";
  }

  // Force mode: skip market-closed check entirely
  if (state.forceAnalyze) {
    if (primaryPayload || payloadValues.length > 0) {
      logRouteAfterFetch(state, "analyze", "force-mode-defying-market-closed");
      return "analyze";
    }
  }

  if (payloadValues.length > 0) {
    const allClosed = payloadValues.every(
      (payload) => payload?.market_status?.market_open === false,
    );
    if (allClosed) {
      logRouteAfterFetch(state, "skip", "all-fetched-payloads-closed");
      return "skip";
    }
  } else if (primaryPayload?.market_status?.market_open === false) {
    logRouteAfterFetch(state, "skip", "primary-payload-closed");
    return "skip";
  }

  // Check for critical errors even with partial payload
  const criticalErrors = state.errors.filter(
    (e) => e.startsWith("fetchData:") && !primaryPayload,
  );
  if (criticalErrors.length > 0) {
    logRouteAfterFetch(state, "error", "critical-fetch-errors-without-primary-payload");
    return "error";
  }

  logRouteAfterFetch(state, "analyze", "payloads-available-or-market-open");
  return "analyze";
}

// ─── routeAfterArbitration ────────────────────────────────────────────────────

export function routeAfterArbitration(
  state: AnalysisGraphStateType,
): "publish" | "skip_publish" {
  // Publish only if we have a final signal composed AND it has arbitration data
  if (state.finalSignal && state.finalSignal.arbitration) {
    return "publish";
  }
  if (Object.keys(state.finalSignals ?? {}).length > 0) {
    const hasArbitration = Object.values(state.finalSignals ?? {}).some(
      (s) => s && s.arbitration,
    );
    if (hasArbitration) {
      return "publish";
    }
  }

  return "skip_publish";
}
