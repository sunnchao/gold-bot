import type { SymbolProfile } from '../config/symbol-profile.js';
import type { MarketOrderAction, PendingOrderAction, TradeAction } from '../types/trade-action.js';

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

export function toolUseToTradeAction(
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
