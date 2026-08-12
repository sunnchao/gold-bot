import type { AccountView } from '../types/comprehensive.js';
import type { TradeAction } from '../types/trade-action.js';

export type AccountActionGuardResult =
  | { ok: true }
  | { ok: false; reason: string };

function sameSymbol(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function positionSymbol(position: unknown): string | undefined {
  if (typeof position === 'object' && position !== null && 'symbol' in position) {
    const raw = (position as { symbol?: unknown }).symbol;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return undefined;
}

export function isSymbolLoaded(accountView: Pick<AccountView, 'symbol' | 'aiSymbols'>): boolean {
  return accountView.aiSymbols.some((symbol) => sameSymbol(symbol, accountView.symbol));
}

export function assertTicketBelongsToAccount(
  accountView: Pick<AccountView, 'accountId' | 'symbol' | 'payload'>,
  action: Extract<TradeAction, { type: 'modify_order' | 'close_order' }>,
): AccountActionGuardResult {
  if (action.account_id !== accountView.accountId) {
    return { ok: false, reason: 'order.account_mismatch' };
  }
  if (!sameSymbol(action.symbol, accountView.symbol)) {
    return { ok: false, reason: 'order.symbol_mismatch' };
  }

  const position = accountView.payload.positions.find((item) => Number(item.ticket) === action.ticket);
  if (!position) {
    return { ok: false, reason: 'order.ticket_not_found' };
  }
  const ownedSymbol = positionSymbol(position);
  if (!ownedSymbol || !sameSymbol(ownedSymbol, action.symbol)) {
    return { ok: false, reason: 'order.symbol_mismatch' };
  }

  return { ok: true };
}

export function validateTradeActionForAccount(
  action: TradeAction,
  accountView: AccountView,
): AccountActionGuardResult {
  if (action.account_id !== accountView.accountId) {
    return { ok: false, reason: 'action.account_mismatch' };
  }
  if (
    (action.type === 'place_market_order' || action.type === 'place_pending_order') &&
    (!action.symbol || !sameSymbol(action.symbol, accountView.symbol))
  ) {
    return { ok: false, reason: 'account.symbol_mismatch' };
  }
  if (!isSymbolLoaded(accountView)) {
    return { ok: false, reason: 'account.symbol_not_loaded' };
  }
  if (action.type === 'modify_order' || action.type === 'close_order') {
    return assertTicketBelongsToAccount(accountView, action);
  }
  return { ok: true };
}
