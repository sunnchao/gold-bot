import { describe, expect, it } from 'vitest';
import { assertTicketBelongsToAccount, validateTradeActionForAccount } from './account-action-guard.js';
import type { AccountView } from '../types/comprehensive.js';

function accountView(overrides: Partial<AccountView> = {}): AccountView {
  return {
    accountId: 'A',
    symbol: 'GOLDm#',
    aiSymbols: ['GOLDm#'],
    realtimePrice: 3335,
    atr: 4,
    payload: {
      account: {
        account_id: 'A',
        equity: 10000,
        balance: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 500,
      },
      market: { symbol: 'GOLDm#', bid: 3335, ask: 3335.2, spread: 0.2 },
      indicators: {},
      positions: [
        {
          ticket: 12345,
          symbol: 'GOLDm#',
          strategy: 'ai_signal',
          direction: 'buy',
          entry_price: 3330,
          current_price: 3335,
          lots: 0.1,
          profit: 50,
          sl: 3320,
          tp: 3360,
        },
      ],
      market_status: { market_open: true, is_trade_allowed: true, tradeable: true },
      strategy_mapping: {},
    },
    ...overrides,
  };
}

describe('account action guard', () => {
  it('rejects opening a shared market symbol that is not the account contract', () => {
    expect(validateTradeActionForAccount({
      type: 'place_market_order',
      account_id: 'A',
      symbol: 'XAUUSD',
      side: 'buy',
      stop_loss: 3320,
      take_profit_1: 3360,
      lots: 0.1,
      reason: 'wrong contract',
    }, accountView())).toEqual({ ok: false, reason: 'account.symbol_mismatch' });
  });

  it('fails closed when ai_symbols are missing', () => {
    expect(validateTradeActionForAccount({
      type: 'place_market_order',
      account_id: 'A',
      symbol: 'GOLDm#',
      side: 'buy',
      stop_loss: 3320,
      take_profit_1: 3360,
      lots: 0.1,
      reason: 'missing whitelist',
    }, accountView({ aiSymbols: [] }))).toEqual({ ok: false, reason: 'account.symbol_not_loaded' });
  });

  it('matches account symbols case-insensitively after trimming whitespace', () => {
    expect(validateTradeActionForAccount({
      type: 'place_market_order',
      account_id: 'A',
      symbol: ' goldm# ',
      side: 'buy',
      stop_loss: 3320,
      take_profit_1: 3360,
      lots: 0.1,
      reason: 'case variant',
    }, accountView({ aiSymbols: [' goldm# '] }))).toEqual({ ok: true });
  });

  it('rejects cross-account ticket confusion, missing tickets, and symbol mismatches', () => {
    const view = accountView();
    const base = {
      type: 'modify_order' as const,
      account_id: 'A',
      symbol: 'GOLDm#',
      ticket: 12345,
      new_sl: 3325,
      reason: 'modify',
    };

    expect(assertTicketBelongsToAccount(view, { ...base, account_id: 'B' })).toEqual({
      ok: false,
      reason: 'order.account_mismatch',
    });
    expect(assertTicketBelongsToAccount(view, { ...base, ticket: 99999 })).toEqual({
      ok: false,
      reason: 'order.ticket_not_found',
    });
    expect(assertTicketBelongsToAccount(view, { ...base, symbol: 'XAUUSD' })).toEqual({
      ok: false,
      reason: 'order.symbol_mismatch',
    });
    expect(assertTicketBelongsToAccount({
      ...view,
      payload: {
        ...view.payload,
        positions: [{ ...view.payload.positions[0], symbol: undefined }],
      },
    }, base)).toEqual({
      ok: false,
      reason: 'order.symbol_mismatch',
    });
  });
});
