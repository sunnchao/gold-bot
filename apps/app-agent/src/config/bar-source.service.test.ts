import { describe, expect, it, vi } from 'vitest';
import { atrOf, BarSourceService, canonicalSymbol } from './bar-source.service.js';
import type { AppConfigService } from './app-config.service.js';
import type { GoldbotApiService } from '../tools/goldbot-api.js';
import type { GoldbotPayload } from '../types/goldbot.js';

const config = {
  marketBarAccount: '90011087',
} as AppConfigService;

function payload(symbol: string): GoldbotPayload {
  return {
    account: {
      account_id: '90011087',
      equity: 1,
      balance: 1,
      margin: 0,
      free_margin: 1,
      currency: 'USD',
      leverage: 100,
    },
    market: { symbol, bid: 100, ask: 101, spread: 1 },
    indicators: {},
    positions: [],
    market_status: { market_open: true, is_trade_allowed: true, tradeable: true },
    strategy_mapping: {},
    bars: {
      H1: [
        { time: '1', open: 98, high: 102, low: 97, close: 100 },
        { time: '2', open: 100, high: 104, low: 99, close: 103 },
      ],
    },
  };
}

describe('bar source service', () => {
  it.each([
    ['GOLD', 'XAUUSD'],
    ['GOLDm#', 'XAUUSD'],
    ['SILVERm#', 'XAGUSD'],
    ['US100Cash', 'US100CASH'],
    ['gbpjpy', 'GBPJPY'],
  ])('canonicalizes %s to %s', (raw, expected) => {
    expect(canonicalSymbol(raw)).toBe(expected);
  });

  it('uses the master account symbol when the canonical symbol is loaded', async () => {
    const api = {
      fetchAccountSymbols: vi.fn().mockResolvedValue({ symbols: ['XAUUSD', 'US100Cash'] }),
    } as unknown as GoldbotApiService;
    const service = new BarSourceService(config, api);

    await expect(service.barSourceFor('81124211', 'GOLDm#')).resolves.toEqual({
      canonicalSymbol: 'XAUUSD',
      sourceAccount: '90011087',
      sourceSymbol: 'XAUUSD',
      useShared: true,
    });
  });

  it('falls back to the account when the master account did not load the symbol', async () => {
    const api = {
      fetchAccountSymbols: vi.fn().mockResolvedValue({ symbols: ['XAUUSD'] }),
    } as unknown as GoldbotApiService;
    const service = new BarSourceService(config, api);

    await expect(service.barSourceFor('81124211', 'GBPJPY')).resolves.toEqual({
      canonicalSymbol: 'GBPJPY',
      sourceAccount: '81124211',
      sourceSymbol: 'GBPJPY',
      useShared: false,
    });
  });

  it('calculates ATR from bars when the payload does not include an ATR field', () => {
    expect(atrOf(payload('XAUUSD'))).toBe(5);
  });
});
