import { describe, expect, it } from 'vitest';
import { getSymbolProfile } from '../config/symbol-profile.js';
import { toolUseToTradeAction } from './trade-action-converter.js';

describe('toolUseToTradeAction lot validation', () => {
  it('rejects market orders below the symbol minimum lot size', () => {
    const action = toolUseToTradeAction(
      {
        name: 'place_market_order',
        input: {
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
      reasoning: expect.stringContaining('outside allowed range 0.1-0.5'),
    });
  });

  it('allows the platform minimum lot size for US100Cash', () => {
    const action = toolUseToTradeAction(
      {
        name: 'place_market_order',
        input: {
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
      reasoning: expect.stringContaining('outside allowed range 0.01-0.5'),
    });
  });
});
