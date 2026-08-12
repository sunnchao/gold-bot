import { DEFAULT_MAX_LOTS, DEFAULT_MIN_LOTS, type SymbolProfile } from '../config/symbol-profile.js';
import type {
  CloseOrderAction,
  MarketOrderAction,
  ModifyOrderAction,
  PendingOrderAction,
  TradeAction,
} from '../types/trade-action.js';

type ToolUseLike = {
  name: string;
  input: Record<string, unknown>;
};

type NumberParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; reason: string };
type RequiredNumberParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

function doNothing(reasoning: string): TradeAction {
  return { type: 'do_nothing', reasoning };
}

function accountDoNothing(accountId: string, reasoning: string): TradeAction {
  return { type: 'do_nothing', account_id: accountId, reasoning };
}

function readAccountId(input: Record<string, unknown>): string | undefined {
  const accountId = typeof input.account_id === 'string' ? input.account_id.trim() : '';
  return accountId.length > 0 ? accountId : undefined;
}

function readString(input: Record<string, unknown>, field: string): string | undefined {
  const value = typeof input[field] === 'string' ? input[field].trim() : '';
  return value.length > 0 ? value : undefined;
}

function readSymbol(input: Record<string, unknown>, profile: SymbolProfile, expectedSymbol?: string): string {
  return readString(input, 'symbol') ?? expectedSymbol ?? profile.symbol;
}

function formatPrice(price: number, profile: SymbolProfile): string {
  return Number.isFinite(price) ? price.toFixed(profile.pricePrecision) : String(price);
}

function readNumber(
  input: Record<string, unknown>,
  field: string,
  required = true,
): NumberParseResult {
  const raw = input[field];
  if ((raw === undefined || raw === null || raw === '') && !required) {
    return { ok: true, value: undefined };
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `invalid numeric field ${field}: ${String(raw)}` };
  }

  return { ok: true, value };
}

function readRequiredNumber(
  input: Record<string, unknown>,
  field: string,
): RequiredNumberParseResult {
  const parsed = readNumber(input, field, true);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value === undefined) {
    return { ok: false, reason: `missing numeric field ${field}` };
  }
  return { ok: true, value: parsed.value };
}

function readOptionalNumber(input: Record<string, unknown>, field: string): NumberParseResult {
  return readNumber(input, field, false);
}

function getSide(input: Record<string, unknown>): 'buy' | 'sell' | undefined {
  const side = String(input.side);
  return side === 'buy' || side === 'sell' ? side : undefined;
}

function validateLots(lots: number, profile: SymbolProfile): string | undefined {
  const minLots = profile.minLots ?? DEFAULT_MIN_LOTS;
  const maxLots = profile.maxLots ?? DEFAULT_MAX_LOTS;

  if (lots < minLots || lots > maxLots) {
    return `lots ${lots} outside allowed range ${minLots}-${maxLots} for ${profile.symbol}`;
  }
  return undefined;
}

export function toolUseToTradeAction(
  toolUse: ToolUseLike,
  currentPrice: number,
  profile: SymbolProfile,
  expectedSymbol?: string,
): TradeAction | undefined {
  const accountId = readAccountId(toolUse.input);
  if (!accountId) {
    return undefined;
  }

  if (toolUse.name === 'do_nothing') {
    return { ...doNothing(String(toolUse.input.reasoning ?? '')), account_id: accountId };
  }

  if (toolUse.name === 'place_market_order') {
    const side = getSide(toolUse.input);
    if (!side) {
      return accountDoNothing(accountId, `invalid market order side: ${String(toolUse.input.side)}`);
    }

    const stopLoss = readRequiredNumber(toolUse.input, 'stop_loss');
    if (!stopLoss.ok) return accountDoNothing(accountId, stopLoss.reason);
    const takeProfit1 = readRequiredNumber(toolUse.input, 'take_profit_1');
    if (!takeProfit1.ok) return accountDoNothing(accountId, takeProfit1.reason);
    const takeProfit2 = readOptionalNumber(toolUse.input, 'take_profit_2');
    if (!takeProfit2.ok) return accountDoNothing(accountId, takeProfit2.reason);
    const lots = readRequiredNumber(toolUse.input, 'lots');
    if (!lots.ok) return accountDoNothing(accountId, lots.reason);
    const lotValidationError = validateLots(lots.value, profile);
    if (lotValidationError) return accountDoNothing(accountId, lotValidationError);

    return {
      type: 'place_market_order',
      account_id: accountId,
      symbol: readSymbol(toolUse.input, profile, expectedSymbol),
      side,
      stop_loss: stopLoss.value,
      take_profit_1: takeProfit1.value,
      take_profit_2: takeProfit2.value,
      lots: lots.value,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies MarketOrderAction;
  }

  if (toolUse.name === 'place_pending_order') {
    const side = getSide(toolUse.input);
    if (!side) {
      return accountDoNothing(accountId, `invalid pending order side: ${String(toolUse.input.side)}`);
    }

    const entryPrice = readRequiredNumber(toolUse.input, 'entry_price');
    if (!entryPrice.ok) return accountDoNothing(accountId, entryPrice.reason);
    const stopLoss = readRequiredNumber(toolUse.input, 'stop_loss');
    if (!stopLoss.ok) return accountDoNothing(accountId, stopLoss.reason);
    const takeProfit1 = readRequiredNumber(toolUse.input, 'take_profit_1');
    if (!takeProfit1.ok) return accountDoNothing(accountId, takeProfit1.reason);
    const takeProfit2 = readOptionalNumber(toolUse.input, 'take_profit_2');
    if (!takeProfit2.ok) return accountDoNothing(accountId, takeProfit2.reason);
    const lots = readRequiredNumber(toolUse.input, 'lots');
    if (!lots.ok) return accountDoNothing(accountId, lots.reason);
    const lotValidationError = validateLots(lots.value, profile);
    if (lotValidationError) return accountDoNothing(accountId, lotValidationError);
    const expiryHours = readOptionalNumber(toolUse.input, 'expiry_hours');
    if (!expiryHours.ok) return accountDoNothing(accountId, expiryHours.reason);

    const orderType = String(toolUse.input.order_type) === 'stop' ? 'stop' : 'limit';

    if (orderType === 'limit' && Number.isFinite(currentPrice) && currentPrice > 0) {
      if (side === 'buy' && entryPrice.value >= currentPrice) {
        return accountDoNothing(
          accountId,
          `BUY_LIMIT entry ${formatPrice(entryPrice.value, profile)} >= current ${formatPrice(currentPrice, profile)}, should be below current price`,
        );
      }
      if (side === 'sell' && entryPrice.value <= currentPrice) {
        return accountDoNothing(
          accountId,
          `SELL_LIMIT entry ${formatPrice(entryPrice.value, profile)} <= current ${formatPrice(currentPrice, profile)}, should be above current price`,
        );
      }
    }

    return {
      type: 'place_pending_order',
      account_id: accountId,
      symbol: readSymbol(toolUse.input, profile, expectedSymbol),
      side,
      entry_price: entryPrice.value,
      stop_loss: stopLoss.value,
      take_profit_1: takeProfit1.value,
      take_profit_2: takeProfit2.value,
      lots: lots.value,
      order_type: orderType,
      expiry_hours: expiryHours.value ?? 4,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies PendingOrderAction;
  }

  if (toolUse.name === 'modify_order') {
    const symbol = readString(toolUse.input, 'symbol');
    if (!symbol) return accountDoNothing(accountId, 'missing modify_order symbol');
    const ticket = readRequiredNumber(toolUse.input, 'ticket');
    if (!ticket.ok) return accountDoNothing(accountId, ticket.reason);
    const newSl = readOptionalNumber(toolUse.input, 'new_sl');
    if (!newSl.ok) return accountDoNothing(accountId, newSl.reason);
    const newTp1 = readOptionalNumber(toolUse.input, 'new_tp1');
    if (!newTp1.ok) return accountDoNothing(accountId, newTp1.reason);
    const newTp2 = readOptionalNumber(toolUse.input, 'new_tp2');
    if (!newTp2.ok) return accountDoNothing(accountId, newTp2.reason);

    return {
      type: 'modify_order',
      account_id: accountId,
      symbol,
      ticket: ticket.value,
      new_sl: newSl.value,
      new_tp1: newTp1.value,
      new_tp2: newTp2.value,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies ModifyOrderAction;
  }

  if (toolUse.name === 'close_order') {
    const symbol = readString(toolUse.input, 'symbol');
    if (!symbol) return accountDoNothing(accountId, 'missing close_order symbol');
    const ticket = readRequiredNumber(toolUse.input, 'ticket');
    if (!ticket.ok) return accountDoNothing(accountId, ticket.reason);

    return {
      type: 'close_order',
      account_id: accountId,
      symbol,
      ticket: ticket.value,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies CloseOrderAction;
  }

  return undefined;
}

export function toolUseToTradeActionLegacy(
  toolUse: ToolUseLike,
  currentPrice: number,
  profile: SymbolProfile,
): TradeAction | undefined {
  if (toolUse.name === 'do_nothing') {
    return doNothing(String(toolUse.input.reasoning ?? ''));
  }

  if (toolUse.name === 'place_market_order') {
    const side = getSide(toolUse.input);
    if (!side) {
      return doNothing(`invalid market order side: ${String(toolUse.input.side)}`);
    }

    const stopLoss = readRequiredNumber(toolUse.input, 'stop_loss');
    if (!stopLoss.ok) return doNothing(stopLoss.reason);
    const takeProfit1 = readRequiredNumber(toolUse.input, 'take_profit_1');
    if (!takeProfit1.ok) return doNothing(takeProfit1.reason);
    const takeProfit2 = readOptionalNumber(toolUse.input, 'take_profit_2');
    if (!takeProfit2.ok) return doNothing(takeProfit2.reason);
    const lots = readRequiredNumber(toolUse.input, 'lots');
    if (!lots.ok) return doNothing(lots.reason);
    const lotValidationError = validateLots(lots.value, profile);
    if (lotValidationError) return doNothing(lotValidationError);

    return {
      type: 'place_market_order',
      side,
      stop_loss: stopLoss.value,
      take_profit_1: takeProfit1.value,
      take_profit_2: takeProfit2.value,
      lots: lots.value,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies MarketOrderAction;
  }

  if (toolUse.name === 'place_pending_order') {
    const side = getSide(toolUse.input);
    if (!side) {
      return doNothing(`invalid pending order side: ${String(toolUse.input.side)}`);
    }

    const entryPrice = readRequiredNumber(toolUse.input, 'entry_price');
    if (!entryPrice.ok) return doNothing(entryPrice.reason);
    const stopLoss = readRequiredNumber(toolUse.input, 'stop_loss');
    if (!stopLoss.ok) return doNothing(stopLoss.reason);
    const takeProfit1 = readRequiredNumber(toolUse.input, 'take_profit_1');
    if (!takeProfit1.ok) return doNothing(takeProfit1.reason);
    const takeProfit2 = readOptionalNumber(toolUse.input, 'take_profit_2');
    if (!takeProfit2.ok) return doNothing(takeProfit2.reason);
    const lots = readRequiredNumber(toolUse.input, 'lots');
    if (!lots.ok) return doNothing(lots.reason);
    const lotValidationError = validateLots(lots.value, profile);
    if (lotValidationError) return doNothing(lotValidationError);
    const expiryHours = readOptionalNumber(toolUse.input, 'expiry_hours');
    if (!expiryHours.ok) return doNothing(expiryHours.reason);

    const orderType = String(toolUse.input.order_type) === 'stop' ? 'stop' : 'limit';

    if (orderType === 'limit' && Number.isFinite(currentPrice) && currentPrice > 0) {
      if (side === 'buy' && entryPrice.value >= currentPrice) {
        return doNothing(
          `BUY_LIMIT entry ${formatPrice(entryPrice.value, profile)} >= current ${formatPrice(currentPrice, profile)}, should be below current price`,
        );
      }
      if (side === 'sell' && entryPrice.value <= currentPrice) {
        return doNothing(
          `SELL_LIMIT entry ${formatPrice(entryPrice.value, profile)} <= current ${formatPrice(currentPrice, profile)}, should be above current price`,
        );
      }
    }

    return {
      type: 'place_pending_order',
      side,
      entry_price: entryPrice.value,
      stop_loss: stopLoss.value,
      take_profit_1: takeProfit1.value,
      take_profit_2: takeProfit2.value,
      lots: lots.value,
      order_type: orderType,
      expiry_hours: expiryHours.value ?? 4,
      reason: String(toolUse.input.reason ?? ''),
    } satisfies PendingOrderAction;
  }

  return undefined;
}
