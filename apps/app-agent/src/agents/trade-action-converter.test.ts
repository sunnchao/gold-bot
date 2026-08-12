import { describe, expect, it } from 'vitest';
import { getSymbolProfile } from '../config/symbol-profile.js';
import { TRADE_ACTION_TOOLS_LEGACY } from '../types/trade-action.js';
import { toolUseToTradeAction, toolUseToTradeActionLegacy } from './trade-action-converter.js';

describe('toolUseToTradeAction lot validation', () => {
  it('keeps legacy tools account-unaware and limited to open-or-hold actions', () => {
    expect(TRADE_ACTION_TOOLS_LEGACY.map((tool) => tool.name)).toEqual([
      'place_pending_order',
      'place_market_order',
      'do_nothing',
    ]);
    for (const tool of TRADE_ACTION_TOOLS_LEGACY) {
      expect(tool.input_schema.required).not.toContain('account_id');
      expect(Object.keys(tool.input_schema.properties)).not.toContain('account_id');
    }
  });

  it('converts legacy market actions without account_id or symbol', () => {
    const action = toolUseToTradeActionLegacy(
      {
        name: 'place_market_order',
        input: {
          account_id: 'ignored',
          symbol: 'ignored',
          side: 'buy',
          stop_loss: 4280,
          take_profit_1: 4310,
          lots: 0.1,
          reason: 'legacy',
        },
      },
      4290,
      getSymbolProfile('XAUUSD'),
    );

    expect(action).toEqual({
      type: 'place_market_order',
      side: 'buy',
      stop_loss: 4280,
      take_profit_1: 4310,
      take_profit_2: undefined,
      lots: 0.1,
      reason: 'legacy',
    });
  });

  it('rejects market orders below the symbol minimum lot size', () => {
    const action = toolUseToTradeAction(
      {
        name: 'place_market_order',
        input: {
          account_id: '90011087',
          symbol: 'GOLDm#',
          side: 'buy',
          stop_loss: 4280,
          take_profit_1: 4310,
          lots: 0.05,
          reason: 'test',
        },
      },
      4290,
      getSymbolProfile('GOLDm#'),
    );

    expect(action).toEqual({
      type: 'do_nothing',
      account_id: '90011087',
      reasoning: expect.stringContaining('outside allowed range 0.1-0.5'),
    });
  });

  it('allows the platform minimum lot size for US100Cash', () => {
    const action = toolUseToTradeAction(
      {
        name: 'place_market_order',
        input: {
          account_id: '90011087',
          symbol: 'US100Cash',
          side: 'buy',
          stop_loss: 25000,
          take_profit_1: 25200,
          lots: 0.01,
          reason: 'test',
        },
      },
      25100,
      getSymbolProfile('US100Cash'),
    );

    expect(action).toMatchObject({
      type: 'place_market_order',
      lots: 0.01,
    });
  });

  it('rejects pending orders above the symbol maximum lot size', () => {
    const action = toolUseToTradeAction(
      {
        name: 'place_pending_order',
        input: {
          account_id: '90011087',
          symbol: 'XAUUSD',
          side: 'buy',
          entry_price: 4280,
          stop_loss: 4270,
          take_profit_1: 4310,
          lots: 0.6,
          order_type: 'limit',
          reason: 'test',
        },
      },
      4290,
      getSymbolProfile('XAUUSD'),
    );

    expect(action).toEqual({
      type: 'do_nothing',
      account_id: '90011087',
      reasoning: expect.stringContaining('outside allowed range 0.01-0.5'),
    });
  });

  it('drops opening tool calls without account_id', () => {
    expect(toolUseToTradeAction(
      {
        name: 'place_market_order',
        input: {
          symbol: 'XAUUSD',
          side: 'buy',
          stop_loss: 4280,
          take_profit_1: 4310,
          lots: 0.1,
          reason: 'test',
        },
      },
      4290,
      getSymbolProfile('XAUUSD'),
    )).toBeUndefined();
  });

  it('converts modify and close tools with account-aware identity fields', () => {
    expect(toolUseToTradeAction(
      {
        name: 'modify_order',
        input: {
          account_id: '90011087',
          symbol: 'XAUUSD',
          ticket: 12345,
          new_sl: 4280,
          reason: 'tighten stop',
        },
      },
      4290,
      getSymbolProfile('XAUUSD'),
    )).toEqual({
      type: 'modify_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      ticket: 12345,
      new_sl: 4280,
      new_tp1: undefined,
      new_tp2: undefined,
      reason: 'tighten stop',
    });

    expect(toolUseToTradeAction(
      {
        name: 'close_order',
        input: {
          account_id: '90011087',
          symbol: 'XAUUSD',
          ticket: 12345,
          reason: 'close',
        },
      },
      4290,
      getSymbolProfile('XAUUSD'),
    )).toEqual({
      type: 'close_order',
      account_id: '90011087',
      symbol: 'XAUUSD',
      ticket: 12345,
      reason: 'close',
    });
  });
});
