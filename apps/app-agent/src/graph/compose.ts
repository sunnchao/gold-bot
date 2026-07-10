import { createHash } from 'node:crypto';
import type { AnalysisGraphStateType } from './state.js';
import type {
  AISignalResult,
  TradePlan,
  TradePlanExecutionType,
  TradePlanMode,
  TradePlanRequestedOrderType,
  TradePlanSide,
} from '../types/agent.js';
import type { ArbitrationResult } from '../types/analysis.js';
import type { PendingOrderAction, MarketOrderAction } from '../types/trade-action.js';

const TRADE_PLAN_SCHEMA_VERSION = 'trade_plan.v1' as const;
const TRADE_PLAN_EXPIRY_MS = 15 * 60 * 1000;

function decisionIdFor(accountId: string, symbol: string, timestamp: string, arbitration: ArbitrationResult): string {
  const input = [
    TRADE_PLAN_SCHEMA_VERSION,
    accountId,
    symbol,
    timestamp,
    arbitration.final_direction,
    arbitration.action,
    arbitration.confidence,
  ].join('|');
  return `tpv1_${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

function modeFromState(state: AnalysisGraphStateType): TradePlanMode {
  // 挂单不需要考虑点差、session 类过滤条件 — 只对真正阻断市场的条件 veto
  const criticalBlocking = ['market.closed', 'market.trade_not_allowed', 'tick.missing', 'tick.stale'];
  if (marketFilterCodes(state).blocking.some((code) => criticalBlocking.includes(code))) {
    return 'veto';
  }

  const action = state.arbitration?.action;
  const exitSuggestion = state.technicalAnalysis?.recommendation;

  if (exitSuggestion === 'partial_close') {
    return 'reduce';
  }
  if (exitSuggestion === 'close') {
    return 'close';
  }
  if (action === 'close') {
    return 'close';
  }
  if (action === 'modify') {
    return 'modify';
  }
  if (action === 'open') {
    return 'approve';
  }
  if (state.arbitration?.final_direction === 'dual') {
    return 'approve';
  }
  if (state.arbitration?.final_direction === 'hold') {
    return 'observe';
  }
  return 'observe';
}

function sideFromArbitration(arbitration: ArbitrationResult): TradePlanSide {
  if (arbitration.final_direction === 'buy') {
    return 'buy';
  }
  if (arbitration.final_direction === 'sell') {
    return 'sell';
  }
  if (arbitration.final_direction === 'dual') {
    return 'dual';
  }
  return 'none';
}

function hasBlockingMarketFilters(state: AnalysisGraphStateType): boolean {
  return marketFilterCodes(state).blocking.length > 0;
}

function marketFilterCodes(state: AnalysisGraphStateType): { blocking: string[]; warnings: string[] } {
  const filters = state.payload?.market_filters;
  if (!filters) {
    return { blocking: [], warnings: [] };
  }

  return {
    blocking: (filters.blocking ?? []).map((filter) => filter.code).filter(Boolean),
    warnings: (filters.warnings ?? []).map((filter) => filter.code).filter(Boolean),
  };
}

function takeProfitFromState(state: AnalysisGraphStateType, side: TradePlanSide): number[] {
  const technical = state.technicalAnalysis;
  if (!technical) {
    return [];
  }

  const levels = side === 'sell' ? technical.support_levels : technical.resistance_levels;
  return levels
    .map((level) => level.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .slice(0, 3);
}

function isActiveMode(mode: TradePlanMode): boolean {
  return mode !== 'observe' && mode !== 'veto';
}

function reasonCodesFor(
  mode: TradePlanMode,
  side: TradePlanSide,
  state: AnalysisGraphStateType,
  extraCodes: string[] = [],
): string[] {
  const codes = [`mode.${mode}`, `side.${side}`];
  const filters = marketFilterCodes(state);
  codes.push(...filters.blocking, ...filters.warnings);
  if (state.riskAssessment?.riskLevel) {
    codes.push(`risk.${state.riskAssessment.riskLevel}`);
  }
  if (state.waveAnalysis?.wave_confirmation) {
    codes.push(`wave.${state.waveAnalysis.wave_confirmation}`);
  }
  if (state.chanlunAnalysis?.latest_signal) {
    codes.push(`chanlun.${state.chanlunAnalysis.latest_signal}`);
  }
  codes.push(...extraCodes);
  return codes;
}

/**
 * buildTradePlanFromTradeAction — 从 function calling 结果直接构建 TradePlan。
 * 优先于 buildTradePlan()，因为参数来自 API 强制约束的 tool schema，不会矛盾。
 */
function buildTradePlanFromTradeAction(
  state: AnalysisGraphStateType,
  action: PendingOrderAction | MarketOrderAction,
): TradePlan | undefined {
  if (!state.arbitration) return undefined;
  const isMarket = action.type === 'place_market_order';
  if (!isMarket && action.order_type === 'stop') {
    return undefined;
  }
  const executionType: TradePlanExecutionType = isMarket ? 'market' : 'limit';
  const requestedOrderType: TradePlanRequestedOrderType = isMarket
    ? 'market'
    : action.side === 'buy'
      ? 'BUY_LIMIT'
      : 'SELL_LIMIT';
  const bid = state.payload?.market.bid ?? 0;
  const ask = state.payload?.market.ask ?? bid;
  const entry = isMarket
    ? { min: bid, max: ask }
    : { min: (action as PendingOrderAction).entry_price, max: (action as PendingOrderAction).entry_price };
  const tp = [action.take_profit_1, ...(action.take_profit_2 ? [action.take_profit_2] : [])];
  const expiryMs = isMarket
    ? 15 * 60 * 1000
    : ((action as PendingOrderAction).expiry_hours ?? 4) * 3600 * 1000;
  const timestamp = state.timestamp ?? new Date().toISOString();

  return {
    schema_version: TRADE_PLAN_SCHEMA_VERSION,
    decision_id: decisionIdFor(state.accountId, state.symbol, timestamp, state.arbitration),
    account_id: state.accountId,
    symbol: state.symbol,
    mode: 'approve',
    side: action.side,
    confidence: state.arbitration.confidence ?? 70,
    entry_zone: entry,
    execution_type: executionType,
    requested_order_type: requestedOrderType,
    stop_loss: action.stop_loss,
    take_profit: tp,
    max_lots: action.lots,
    expires_at: new Date(Date.now() + expiryMs).toISOString(),
    reason_codes: [`fc.${action.type}`, `side.${action.side}`, `order.${requestedOrderType}`],
    conflicts: [],
    narrative: action.reason,
    add_on: state.riskAssessment?.addOn ?? false,
  };
}

function buildTradePlan(state: AnalysisGraphStateType, confidence: number): TradePlan | undefined {
  const arbitration = state.arbitration;
  if (!arbitration) {
    return undefined;
  }

  const intendedMode = modeFromState(state);
  const intendedSide = intendedMode === 'veto' ? 'none' : sideFromArbitration(arbitration);
  const filters = marketFilterCodes(state);
  const timestamp = state.timestamp || new Date().toISOString();
  const bid = state.payload?.market.bid ?? 0;
  const ask = state.payload?.market.ask ?? bid;
  const entryMin = Math.min(bid, ask);
  const entryMax = Math.max(bid, ask);
  const expiresAt = new Date(new Date(timestamp).getTime() + TRADE_PLAN_EXPIRY_MS).toISOString();
  const takeProfit = takeProfitFromState(state, intendedSide);
  const stopLoss = state.riskAssessment?.suggestedSL ?? 0;
  const maxLots = state.riskAssessment?.maxPositionSize ?? 0;
  const hasCompleteExecutionFields =
    intendedSide !== 'none' &&
    entryMin > 0 &&
    entryMax > 0 &&
    stopLoss > 0 &&
    takeProfit.length > 0 &&
    maxLots > 0;
  const missingExecutionFields =
    isActiveMode(intendedMode) && !hasCompleteExecutionFields;
  const mode = missingExecutionFields ? 'observe' : intendedMode;
  const side = missingExecutionFields || mode === 'veto' ? 'none' : intendedSide;
  const extraReasonCodes = missingExecutionFields
    ? ['execution.incomplete_fields']
    : mode === 'approve'
      ? ['order.market']
      : [];

  if (intendedSide === 'dual') {
    return undefined;  // dual side not supported for single trade plan
  }

  return {
    schema_version: TRADE_PLAN_SCHEMA_VERSION,
    decision_id: decisionIdFor(state.accountId, state.symbol, timestamp, arbitration),
    account_id: state.accountId,
    symbol: state.symbol,
    mode,
    side,
    confidence,
    entry_zone: {
      min: mode === 'observe' || mode === 'veto' ? 0 : entryMin,
      max: mode === 'observe' || mode === 'veto' ? 0 : entryMax,
    },
    ...(mode === 'approve'
      ? { execution_type: 'market' as const, requested_order_type: 'market' as const }
      : {}),
    stop_loss: mode === 'observe' || mode === 'veto' ? 0 : stopLoss,
    take_profit: mode === 'observe' || mode === 'veto' ? [] : takeProfit,
    max_lots: mode === 'observe' || mode === 'veto' ? 0 : maxLots,
    expires_at: expiresAt,
    reason_codes: reasonCodesFor(mode, side, state, extraReasonCodes),
    conflicts:
      missingExecutionFields
        ? ['execution.incomplete_fields']
        : mode === 'veto'
        ? filters.blocking
        : arbitration.primary_contradiction === 'none' ? [] : [arbitration.primary_contradiction],
    narrative: arbitration.reasoning,
    add_on: state.riskAssessment?.addOn ?? false,
  };
}

function buildSingleTradePlan(
  state: AnalysisGraphStateType,
  side: 'buy' | 'sell',
  confidence: number,
): TradePlan | undefined {
  const arbitration = state.arbitration;
  if (!arbitration) {
    return undefined;
  }

  const intendedMode = modeFromState(state);
  const filters = marketFilterCodes(state);
  const timestamp = state.timestamp || new Date().toISOString();
  const bid = state.payload?.market.bid ?? 0;
  const ask = state.payload?.market.ask ?? bid;
  const entryMin = Math.min(bid, ask);
  const entryMax = Math.max(bid, ask);
  const expiresAt = new Date(new Date(timestamp).getTime() + TRADE_PLAN_EXPIRY_MS).toISOString();
  const takeProfit = takeProfitFromState(state, side);
  const stopLoss = state.riskAssessment?.suggestedSL ?? 0;
  const maxLots = state.riskAssessment?.maxPositionSize ?? 0;
  const hasCompleteExecutionFields =
    entryMin > 0 &&
    entryMax > 0 &&
    stopLoss > 0 &&
    takeProfit.length > 0 &&
    maxLots > 0;
  const missingExecutionFields =
    isActiveMode(intendedMode) && !hasCompleteExecutionFields;
  const mode = missingExecutionFields ? 'observe' : intendedMode;
  const extraReasonCodes = missingExecutionFields
    ? ['execution.incomplete_fields']
    : mode === 'approve'
      ? ['order.market']
      : [];

  return {
    schema_version: TRADE_PLAN_SCHEMA_VERSION,
    decision_id: decisionIdFor(state.accountId, state.symbol, timestamp, arbitration),
    account_id: state.accountId,
    symbol: state.symbol,
    mode,
    side,
    confidence,
    entry_zone: {
      min: mode === 'observe' || mode === 'veto' ? 0 : entryMin,
      max: mode === 'observe' || mode === 'veto' ? 0 : entryMax,
    },
    ...(mode === 'approve'
      ? { execution_type: 'market' as const, requested_order_type: 'market' as const }
      : {}),
    stop_loss: mode === 'observe' || mode === 'veto' ? 0 : stopLoss,
    take_profit: mode === 'observe' || mode === 'veto' ? [] : takeProfit,
    max_lots: mode === 'observe' || mode === 'veto' ? 0 : maxLots,
    expires_at: expiresAt,
    reason_codes: reasonCodesFor(mode, side, state, extraReasonCodes),
    conflicts:
      missingExecutionFields
        ? ['execution.incomplete_fields']
        : mode === 'veto'
        ? filters.blocking
        : arbitration.primary_contradiction === 'none' ? [] : [arbitration.primary_contradiction],
    narrative: arbitration.reasoning,
    add_on: state.riskAssessment?.addOn ?? false,
  };
}

function buildDualTradePlan(
  state: AnalysisGraphStateType,
  confidence: number,
): import('../types/agent.js').DualTradePlan | undefined {
  const arbitration = state.arbitration;
  if (!arbitration || arbitration.final_direction !== 'dual') {
    return undefined;
  }

  const buyPlan = buildSingleTradePlan(state, 'buy', confidence);
  const sellPlan = buildSingleTradePlan(state, 'sell', confidence);

  if (!buyPlan || !sellPlan) {
    return undefined;
  }

  return {
    buy: buyPlan,
    sell: sellPlan,
    is_dual_direction: true,
  };
}

export function composeFinalSignal(state: AnalysisGraphStateType): AISignalResult | null {
  const {
    technicalAnalysis: technical,
    waveAnalysis,
    chanlunAnalysis,
    riskAssessment,
  } = state;
  let { arbitration } = state;
  const filters = marketFilterCodes(state);
  const marketBlocked = filters.blocking.length > 0;

  // Guard: must have arbitration to publish a meaningful signal
  if (!arbitration) {
    return null;
  }

  let bias: AISignalResult['bias'] =
    arbitration?.final_direction === 'buy'
      ? 'bullish'
      : arbitration?.final_direction === 'sell'
        ? 'bearish'
        : technical?.bias ?? 'neutral';

  if (chanlunAnalysis?.latest_signal === 'buy') {
    bias = 'bullish';
  } else if (chanlunAnalysis?.latest_signal === 'sell') {
    bias = 'bearish';
  }

  let confidence = arbitration?.confidence ?? technical?.confidence ?? 50;
  if (
    waveAnalysis?.trend_strength === 'strong' &&
    waveAnalysis.wave_confirmation === 'confirmed'
  ) {
    confidence = Math.min(100, confidence + 10);
  }

  /**
   * 动态置信度阈值计算
   * 根据趋势强度、多周期共振、持仓盈亏动态调整执行阈值
   */
  function getDynamicConfidenceThreshold(
    trendStrength: string | undefined,
    multiTfAlign: boolean,
    currentPositionPnL: number,
  ): number {
    let baseThreshold = 58;

    if (trendStrength === 'strong') baseThreshold -= 8;
    else if (trendStrength === 'weak') baseThreshold += 6;

    if (multiTfAlign) baseThreshold -= 5;

    if (currentPositionPnL < -20) baseThreshold += 15;

    return Math.max(35, Math.min(75, baseThreshold));
  }

  const dynamicThreshold = getDynamicConfidenceThreshold(
    waveAnalysis?.trend_strength,
    arbitration?.dow_theory?.multi_tf_confirm ?? false,
    0, // TODO: integrate position P&L when available
  );

  if (arbitration && confidence < dynamicThreshold && arbitration.action === 'open') {
    const gatedConfidence = Math.min(confidence, dynamicThreshold - 5);
    arbitration = {
      ...arbitration,
      action: 'hold',
      confidence: gatedConfidence,
    };
    confidence = gatedConfidence;
  }

  const effectiveState =
    arbitration === state.arbitration ? state : { ...state, arbitration };
  const tradeAction =
    arbitration.action === 'open' ? state.tradeAction : undefined;

  return {
    bias,
    confidence,
    exit_suggestion: technical?.recommendation ?? 'none',
    risk_alert: (() => {
      // 挂单模式（function calling 的 place_pending_order）：只有 critical blocking 才 alert
      if (state.tradeAction?.type === 'place_pending_order') {
        const criticalBlocking = ['market.closed', 'market.trade_not_allowed', 'tick.missing', 'tick.stale'];
        return filters.blocking.some(code => criticalBlocking.includes(code))
          || riskAssessment?.riskLevel === 'high'
          || riskAssessment?.riskLevel === 'extreme';
      }
      // 市价单/其他模式：所有 blocking 都 alert
      return marketBlocked || riskAssessment?.riskLevel === 'high' || riskAssessment?.riskLevel === 'extreme';
    })(),
    risk_level: riskAssessment?.riskLevel,
    alert_reason: [marketBlocked ? filters.blocking.join('; ') : '', riskAssessment?.warnings?.join('; ') ?? '']
      .filter(Boolean)
      .join('; ') || undefined,
    suggested_sl: riskAssessment?.suggestedSL,  // AI 动态止损（支撑位 - ATR缓冲）
    suggested_tp: riskAssessment?.suggestedTP,  // AI 动态止盈（阻力位/Fib目标）
    max_position_size: marketBlocked ? 0 : riskAssessment?.maxPositionSize,  // AI 建议仓位上限
    indicators_summary: technical?.indicators_summary,
    sr_levels: technical
      ? {
          support: technical.support_levels.map((l) => l.price).filter((p) => p !== undefined && p !== null),
          resistance: technical.resistance_levels.map((l) => l.price).filter((p) => p !== undefined && p !== null),
        }
      : undefined,
    arbitration: arbitration
      ? {
          direction: arbitration.final_direction,
          action: arbitration.action,
          reasoning: arbitration.reasoning,
          phase: arbitration.phase,
          contradiction: arbitration.primary_contradiction,
          united_front: arbitration.united_front_analysis,
        }
      : undefined,
    wave_analysis: waveAnalysis
      ? {
          confirmation: waveAnalysis.wave_confirmation,
          extension_wave: waveAnalysis.extension_wave,
        }
      : undefined,
    chanlun_analysis: chanlunAnalysis
      ? {
          trend: chanlunAnalysis.trend,
          signal: chanlunAnalysis.latest_signal,
        }
      : undefined,
    dow_theory: arbitration?.dow_theory,
    wave_theory: arbitration?.wave_theory,
    chanlun_theory: arbitration?.chanlun_theory,
    trade_recommendation: arbitration?.trade_recommendation,
    trade_plan: (tradeAction && tradeAction.type !== 'do_nothing')
      ? buildTradePlanFromTradeAction(effectiveState, tradeAction)
      : buildTradePlan(effectiveState, confidence),
    dual_trade_plan: arbitration.action === 'open'
      ? buildDualTradePlan(effectiveState, confidence)
      : undefined,
  };
}
