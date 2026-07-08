export type RiskGateStatus = 'accepted' | 'rejected' | 'clamped';

export type RiskGateInput = {
  now?: string;
  account: {
    accountId?: string;
    leverage?: number;
  };
  runtime: {
    equity?: number;
    freeMargin?: number;
    marketOpen: boolean;
    isTradeAllowed: boolean;
    lastTickAt?: string;
  };
  state: {
    tick: {
      symbol?: string;
      bid?: number;
      ask?: number;
      spread?: number;
    };
    positions: Array<{
      ticket?: number;
      symbol?: string;
      type?: string;
      lots?: number;
      strategy?: string;
    }>;
  };
  plan: {
    decisionId?: string;
    accountId?: string;
    symbol: string;
    mode: string;
    side: string;
    entryZone?: { min?: number; max?: number };
    stopLoss?: number;
    takeProfit?: number[];
    maxLots?: number;
    expiresAt?: string;
  };
  allowAdd?: boolean;
  allowHedge?: boolean;
  sourceStrategy?: string;
};

export type RiskGateResult = {
  decisionId?: string;
  mode?: string;
  symbol?: string;
  status: RiskGateStatus;
  auditOnly: boolean;
  reasonCodes: string[];
  requestedLots?: number;
  allowedLots?: number;
  maxRiskLots?: number;
  maxMarginLots?: number;
  canProduceLiveCommands: false;
};

export type MarketFilterSeverity = 'blocking' | 'warning';

export type MarketFilter = {
  code: string;
  severity: MarketFilterSeverity;
};

export type MarketFilterInput = {
  now?: string;
  symbol?: string;
  runtime: {
    marketOpen: boolean;
    isTradeAllowed: boolean;
    lastTickAt?: string;
  };
  state: {
    tick: {
      symbol?: string;
      spread?: number;
    };
    bars?: Record<string, Array<{ atr?: number; ATR?: number }>>;
  };
};

export type MarketFilterResult = {
  blocked: boolean;
  blocking: MarketFilter[];
  warnings: MarketFilter[];
  reason_codes: string[];
};

type SymbolMeta = {
  symbol: string;
  contractSize: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  maxSpread: number;
  minSLDistance: number;
  maxSLDistance: number;
};

const defaultMaxTickAgeMs = 2 * 60 * 1000;
const defaultMaxRiskPct = 0.02;
const defaultMarginUsePct = 0.5;
const marketFilterMaxSpread = 5.0;
const atrExpansionRatio = 2.0;
const minAtrHistoryForFilter = 10;

export function evaluateMarketFilters(input: MarketFilterInput): MarketFilterResult {
  const now = input.now == null ? new Date() : new Date(input.now);
  const symbol = baseSymbol(input.symbol ?? input.state.tick.symbol ?? '');
  const result: MarketFilterResult = {
    blocked: false,
    blocking: [],
    warnings: [],
    reason_codes: []
  };
  const add = (code: string, severity: MarketFilterSeverity): void => {
    const filter = { code, severity };
    if (severity === 'blocking') {
      result.blocked = true;
      result.blocking.push(filter);
    } else {
      result.warnings.push(filter);
    }
    result.reason_codes.push(code);
  };

  if (!input.runtime.marketOpen) {
    add('market.closed', 'blocking');
  }
  if (!input.runtime.isTradeAllowed) {
    add('market.trade_not_allowed', 'blocking');
  }
  if (input.runtime.lastTickAt == null || input.runtime.lastTickAt.length === 0) {
    add('tick.missing', 'blocking');
  } else if (now.getTime() - new Date(input.runtime.lastTickAt).getTime() > defaultMaxTickAgeMs) {
    add('tick.stale', 'blocking');
  }
  if ((input.state.tick.spread ?? 0) > maxSpreadForMarketFilter(symbol)) {
    add('spread.too_wide', 'blocking');
  }
  if (isSymbolCloseWindow(now, symbol)) {
    add('session.friday_close_window', 'blocking');
  }
  if (isSymbolRolloverWindow(now, symbol)) {
    add('session.rollover_window', 'warning');
  }
  if (isSymbolLowLiquiditySession(now, symbol)) {
    add('session.low_liquidity', 'warning');
  }
  if (hasAtrExpansion(input.state.bars?.M30 ?? [])) {
    add('volatility.atr_expansion', 'warning');
  }

  return result;
}

export function evaluateRiskGate(input: RiskGateInput): RiskGateResult {
  if (input.plan == null) {
    return {
      status: 'accepted',
      auditOnly: false,
      reasonCodes: ['plan.absent'],
      canProduceLiveCommands: false
    };
  }

  const now = input.now == null ? new Date() : new Date(input.now);
  const mode = input.plan.mode.toLowerCase();
  const symbol = baseSymbol(input.plan.symbol);
  const result: RiskGateResult = {
    decisionId: input.plan.decisionId,
    mode,
    symbol,
    status: 'accepted',
    auditOnly: isAuditOnlyMode(mode),
    reasonCodes: [],
    canProduceLiveCommands: false
  };

  if (!isExecutableMode(mode)) {
    result.reasonCodes.push('action.non_executable');
    return result;
  }

  const meta = metadataFor(symbol);
  const tradeabilityRejects = collectTradeabilityRejects(input, now, meta);
  if (tradeabilityRejects.length > 0) {
    result.status = 'rejected';
    result.reasonCodes.push(...tradeabilityRejects);
    return result;
  }

  if (mode === 'close' || mode === 'reduce') {
    result.reasonCodes.push('action.audit_safe');
    return result;
  }

  const validation = validateExpandableRisk(input, meta);
  result.requestedLots = validation.requestedLots;
  result.allowedLots = validation.allowedLots;
  result.maxRiskLots = validation.maxRiskLots;
  result.maxMarginLots = validation.maxMarginLots;

  if (validation.rejects.length > 0) {
    result.status = 'rejected';
    result.reasonCodes.push(...validation.rejects);
    return result;
  }
  if (validation.clamped) {
    result.status = 'clamped';
    result.reasonCodes.push('lots.clamped');
    return result;
  }

  result.reasonCodes.push('lots.accepted');
  return result;
}

function collectTradeabilityRejects(input: RiskGateInput, now: Date, meta: SymbolMeta): string[] {
  const reasons: string[] = [];
  if (!input.runtime.marketOpen) {
    reasons.push('market.closed');
  }
  if (!input.runtime.isTradeAllowed) {
    reasons.push('market.trade_not_allowed');
  }
  if (input.runtime.lastTickAt == null || input.runtime.lastTickAt.length === 0) {
    reasons.push('tick.missing');
  } else if (now.getTime() - new Date(input.runtime.lastTickAt).getTime() > defaultMaxTickAgeMs) {
    reasons.push('tick.stale');
  }
  if ((input.state.tick.bid ?? 0) <= 0 || (input.state.tick.ask ?? 0) <= 0) {
    reasons.push('tick.missing_price');
  }
  if ((input.state.tick.spread ?? 0) > meta.maxSpread) {
    reasons.push('spread.too_wide');
  }
  if (input.plan.expiresAt != null && input.plan.expiresAt.length > 0 && now.getTime() > new Date(input.plan.expiresAt).getTime()) {
    reasons.push('plan.expired');
  }
  return reasons;
}

function validateExpandableRisk(
  input: RiskGateInput,
  meta: SymbolMeta
): {
  requestedLots: number;
  allowedLots: number;
  maxRiskLots: number;
  maxMarginLots: number;
  clamped: boolean;
  rejects: string[];
} {
  const requestedLots = input.plan.maxLots ?? 0;
  let allowedLots = 0;
  let maxRiskLots = 0;
  let maxMarginLots = 0;
  let clamped = false;
  const rejects: string[] = [];
  const entry = executionPrice(input.state.tick, input.plan.side);
  const stopLoss = input.plan.stopLoss ?? 0;

  if (entry <= 0) {
    rejects.push('entry.missing');
  }
  if (stopLoss <= 0) {
    rejects.push('sl.missing');
  }
  if (entry > 0 && stopLoss > 0) {
    const distance = Math.abs(entry - stopLoss);
    if (input.plan.side.toLowerCase() === 'buy' && stopLoss >= entry) {
      rejects.push('sl.wrong_side');
    }
    if (input.plan.side.toLowerCase() === 'sell' && stopLoss <= entry) {
      rejects.push('sl.wrong_side');
    }
    if (distance < meta.minSLDistance) {
      rejects.push('sl.too_close');
    }
    if (distance > meta.maxSLDistance) {
      rejects.push('sl.too_far');
    }
    maxRiskLots = roundDownLot(((input.runtime.equity ?? 0) * defaultMaxRiskPct) / (distance * meta.contractSize), meta.lotStep);
  }
  if (requestedLots <= 0) {
    rejects.push('lots.missing');
  }
  if ((input.runtime.freeMargin ?? 0) <= 0) {
    rejects.push('margin.free_margin_missing');
  }
  if (entry > 0 && (input.runtime.freeMargin ?? 0) > 0) {
    const leverage = (input.account.leverage ?? 0) > 0 ? input.account.leverage ?? 1 : 1;
    const marginPerLot = (entry * meta.contractSize) / leverage;
    if (marginPerLot > 0) {
      maxMarginLots = roundDownLot(((input.runtime.freeMargin ?? 0) * defaultMarginUsePct) / marginPerLot, meta.lotStep);
    }
  }
  if (rejects.length > 0) {
    return { requestedLots, allowedLots, maxRiskLots, maxMarginLots, clamped, rejects };
  }

  rejects.push(...positionConflictRejects(input));
  if (rejects.length > 0) {
    return { requestedLots, allowedLots, maxRiskLots, maxMarginLots, clamped, rejects };
  }

  allowedLots = roundDownLot(minPositive(requestedLots, meta.maxLot, maxRiskLots, maxMarginLots), meta.lotStep);
  if (allowedLots < meta.minLot) {
    rejects.push('lots.below_min_after_clamp');
    return { requestedLots, allowedLots, maxRiskLots, maxMarginLots, clamped, rejects };
  }

  clamped = allowedLots < requestedLots;
  return { requestedLots, allowedLots, maxRiskLots, maxMarginLots, clamped, rejects };
}

function positionConflictRejects(input: RiskGateInput): string[] {
  const reasons: string[] = [];
  const planSide = input.plan.side.toLowerCase();
  const planSymbol = baseSymbol(input.plan.symbol);
  let addRejected = false;
  let hedgeRejected = false;

  for (const position of input.state.positions) {
    if ((position.ticket ?? 0) <= 0 || (position.lots ?? 0) <= 0) {
      continue;
    }
    if (position.symbol != null && position.symbol.length > 0 && baseSymbol(position.symbol) !== planSymbol) {
      continue;
    }
    const side = positionSide(position.type ?? '');
    if (side === '' || planSide === 'none') {
      continue;
    }
    if ((input.sourceStrategy ?? '') !== '' && (position.strategy ?? '') !== '' && position.strategy !== input.sourceStrategy) {
      continue;
    }
    if (side === planSide && input.allowAdd !== true && !addRejected) {
      reasons.push('position.add_not_allowed');
      addRejected = true;
    }
    if (side !== planSide && input.allowHedge !== true && !hedgeRejected) {
      reasons.push('position.hedge_not_allowed');
      hedgeRejected = true;
    }
  }

  return reasons;
}

function positionSide(value: string): string {
  switch (value.trim().toUpperCase()) {
    case 'BUY':
      return 'buy';
    case 'SELL':
      return 'sell';
    default:
      return '';
  }
}

function executionPrice(tick: RiskGateInput['state']['tick'], side: string): number {
  switch (side.toLowerCase()) {
    case 'buy':
      return tick.ask ?? 0;
    case 'sell':
      return tick.bid ?? 0;
    default:
      return (tick.bid ?? 0) > 0 && (tick.ask ?? 0) > 0 ? ((tick.bid ?? 0) + (tick.ask ?? 0)) / 2 : 0;
  }
}

function isExecutableMode(mode: string): boolean {
  return ['approve', 'modify', 'reduce', 'close'].includes(mode);
}

function isAuditOnlyMode(mode: string): boolean {
  return ['observe', 'veto'].includes(mode);
}

function metadataFor(symbol: string): SymbolMeta {
  switch (baseSymbol(symbol)) {
    case 'GBPUSD':
      return { symbol: 'GBPUSD', contractSize: 100000, minLot: 0.01, maxLot: 30, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.0005, maxSLDistance: 0.05 };
    case 'USDCAD':
      return { symbol: 'USDCAD', contractSize: 100000, minLot: 0.01, maxLot: 30, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.0005, maxSLDistance: 0.05 };
    case 'GBPJPY':
      return { symbol: 'GBPJPY', contractSize: 100000, minLot: 0.01, maxLot: 20, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.03, maxSLDistance: 8 };
    case 'EURJPY':
      return { symbol: 'EURJPY', contractSize: 100000, minLot: 0.01, maxLot: 20, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.03, maxSLDistance: 7 };
    case 'USDJPY':
      return { symbol: 'USDJPY', contractSize: 100000, minLot: 0.01, maxLot: 30, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.02, maxSLDistance: 6 };
    case 'US100CASH':
      return { symbol: 'US100CASH', contractSize: 1, minLot: 0.01, maxLot: 20, lotStep: 0.01, maxSpread: 80, minSLDistance: 10, maxSLDistance: 3000 };
    case 'USOILCASH':
      return { symbol: 'USOILCASH', contractSize: 100, minLot: 0.01, maxLot: 30, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.05, maxSLDistance: 10 };
    case 'UKOILCASH':
      return { symbol: 'UKOILCASH', contractSize: 100, minLot: 0.01, maxLot: 30, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.05, maxSLDistance: 10 };
    default:
      return { symbol: 'XAUUSD', contractSize: 100, minLot: 0.01, maxLot: 50, lotStep: 0.01, maxSpread: 80, minSLDistance: 0.5, maxSLDistance: 100 };
  }
}

function baseSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase().replace(/M#$/, '').replace(/#$/, '');
  switch (normalized) {
    case 'GOLD':
    case 'XAUUSD':
      return 'XAUUSD';
    case 'US100':
    case 'NAS100':
    case 'US100CASH':
      return 'US100CASH';
    case 'USOIL':
    case 'WTI':
    case 'USOILCASH':
      return 'USOILCASH';
    case 'UKOIL':
    case 'BRENT':
    case 'UKOILCASH':
      return 'UKOILCASH';
    default:
      return normalized;
  }
}

function maxSpreadForMarketFilter(symbol: string): number {
  switch (baseSymbol(symbol)) {
    case 'GBPJPY':
      return 6.0;
    case 'EURJPY':
    case 'USDJPY':
      return 5.0;
    case 'GBPUSD':
    case 'USDCAD':
      return 4.0;
    default:
      return marketFilterMaxSpread;
  }
}

function isSymbolCloseWindow(now: Date, symbol: string): boolean {
  switch (baseSymbol(symbol)) {
    case 'US100CASH': {
      const day = now.getUTCDay();
      if (day === 0 || day === 6) {
        return true;
      }
      return now.getUTCHours() >= 4;
    }
    default:
      return now.getUTCDay() === 5 && now.getUTCHours() >= 20;
  }
}

function isSymbolRolloverWindow(now: Date, symbol: string): boolean {
  if (baseSymbol(symbol) === 'US100CASH') {
    return false;
  }
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minuteOfDay >= 21 * 60 + 55 && minuteOfDay <= 22 * 60 + 10;
}

function isSymbolLowLiquiditySession(now: Date, symbol: string): boolean {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (baseSymbol(symbol) === 'US100CASH') {
    const openMin = 21 * 60 + 30;
    const closeMin = 4 * 60;
    if (minuteOfDay >= openMin - 30 && minuteOfDay < openMin) {
      return true;
    }
    if (minuteOfDay >= openMin && minuteOfDay < openMin + 20) {
      return true;
    }
    if (minuteOfDay >= closeMin - 15 && minuteOfDay < closeMin) {
      return true;
    }
    return minuteOfDay < openMin - 30 || minuteOfDay >= closeMin;
  }
  return minuteOfDay > 22 * 60 + 10 || minuteOfDay < 60;
}

function hasAtrExpansion(bars: Array<{ atr?: number; ATR?: number }>): boolean {
  if (bars.length < minAtrHistoryForFilter + 1) {
    return false;
  }
  const latest = atrValue(bars[bars.length - 1]);
  if (latest <= 0) {
    return false;
  }
  let sum = 0;
  let count = 0;
  for (const bar of bars.slice(0, -1)) {
    const value = atrValue(bar);
    if (value <= 0) {
      continue;
    }
    sum += value;
    count += 1;
  }
  if (count < minAtrHistoryForFilter) {
    return false;
  }
  const average = sum / count;
  return average > 0 && latest >= average * atrExpansionRatio;
}

function atrValue(bar: { atr?: number; ATR?: number }): number {
  return bar.atr ?? bar.ATR ?? 0;
}

function minPositive(...values: number[]): number {
  let min = 0;
  for (const value of values) {
    if (value <= 0) {
      continue;
    }
    if (min === 0 || value < min) {
      min = value;
    }
  }
  return min;
}

function roundDownLot(value: number, step: number): number {
  if (value <= 0 || step <= 0) {
    return 0;
  }
  return Math.floor(value / step + 1e-9) * step;
}
