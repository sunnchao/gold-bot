import { Injectable } from '@nestjs/common';
import { AppConfigService } from './app-config.service.js';
import type { GoldbotBar, GoldbotPayload } from '../types/goldbot.js';
import { GoldbotApiService } from '../tools/goldbot-api.js';
import { getLogger } from '../utils/logger.js';

const PREFERRED_ATR_TIMEFRAMES = ['H1', 'M30', 'M15', 'H4'] as const;
const DEFAULT_ATR_PERIOD = 14;

export interface BarSourceResolution {
  canonicalSymbol: string;
  sourceAccount: string;
  sourceSymbol: string;
  useShared: boolean;
}

function cleanSymbol(symbol: string): string {
  return symbol.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function canonicalSymbol(symbol: string): string {
  const cleaned = cleanSymbol(symbol);
  if (cleaned === 'GOLD' || cleaned === 'GOLDM' || cleaned.startsWith('XAUUSD')) {
    return 'XAUUSD';
  }
  if (cleaned === 'SILVER' || cleaned === 'SILVERM' || cleaned.startsWith('XAGUSD')) {
    return 'XAGUSD';
  }
  if (cleaned === 'US100CASH') {
    return 'US100CASH';
  }
  return cleaned;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function barsFor(payload: GoldbotPayload, timeframe: string): GoldbotBar[] {
  const bars = payload.bars;
  if (!bars) {
    return [];
  }
  const exact = bars[timeframe];
  if (Array.isArray(exact)) {
    return exact;
  }
  const key = Object.keys(bars).find((candidate) => candidate.toUpperCase() === timeframe);
  const matched = key ? bars[key] : undefined;
  return Array.isArray(matched) ? matched : [];
}

function trueRange(bar: GoldbotBar, previousClose?: number): number | undefined {
  const high = finiteNumber(bar.high);
  const low = finiteNumber(bar.low);
  if (high == null || low == null) {
    return undefined;
  }
  if (previousClose == null) {
    return high - low;
  }
  return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
}

export function atrOf(payload: GoldbotPayload, period = DEFAULT_ATR_PERIOD): number {
  for (const timeframe of PREFERRED_ATR_TIMEFRAMES) {
    const bars = barsFor(payload, timeframe);
    const latestBarAtr = bars
      .slice()
      .reverse()
      .map((bar) => finiteNumber(bar.atr))
      .find((atr) => atr != null && atr > 0);
    if (latestBarAtr != null) {
      return latestBarAtr;
    }

    if (bars.length < 2) {
      continue;
    }
    const ranges: number[] = [];
    for (let index = 0; index < bars.length; index += 1) {
      const previousClose = index > 0 ? finiteNumber(bars[index - 1].close) : undefined;
      const range = trueRange(bars[index], previousClose);
      if (range != null && range > 0) {
        ranges.push(range);
      }
    }
    const sample = ranges.slice(-period);
    if (sample.length > 0) {
      return sample.reduce((sum, value) => sum + value, 0) / sample.length;
    }
  }

  for (const timeframe of PREFERRED_ATR_TIMEFRAMES) {
    const indicator = payload.indicators?.[timeframe] ?? payload.indicators?.[timeframe.toLowerCase()];
    const atr = finiteNumber(indicator?.atr);
    if (atr != null && atr > 0) {
      return atr;
    }
  }

  return 0;
}

@Injectable()
export class BarSourceService {
  private readonly symbolsCache = new Map<string, string[]>();

  constructor(
    private readonly config: AppConfigService,
    private readonly goldbotApi: GoldbotApiService,
  ) {}

  async barSourceFor(accountId: string, symbol: string): Promise<BarSourceResolution> {
    const canonical = canonicalSymbol(symbol);
    const marketAccount = this.config.marketBarAccount;

    if (marketAccount === accountId) {
      return {
        canonicalSymbol: canonical,
        sourceAccount: accountId,
        sourceSymbol: symbol,
        useShared: false,
      };
    }

    const marketSymbols = await this.fetchAccountSymbols(marketAccount);
    const sourceSymbol = marketSymbols.find((candidate) => canonicalSymbol(candidate) === canonical);
    if (!sourceSymbol) {
      return {
        canonicalSymbol: canonical,
        sourceAccount: accountId,
        sourceSymbol: symbol,
        useShared: false,
      };
    }

    return {
      canonicalSymbol: canonical,
      sourceAccount: marketAccount,
      sourceSymbol,
      useShared: true,
    };
  }

  async accountSymbols(accountId: string): Promise<string[]> {
    return this.fetchAccountSymbols(accountId);
  }

  private async fetchAccountSymbols(accountId: string): Promise<string[]> {
    const cached = this.symbolsCache.get(accountId);
    if (cached) {
      return [...cached];
    }

    try {
      const result = await this.goldbotApi.fetchAccountSymbols(accountId);
      const symbols = [...new Set(result.symbols.map((item) => item.trim()).filter(Boolean))];
      this.symbolsCache.set(accountId, symbols);
      return [...symbols];
    } catch (err) {
      getLogger().warn(
        { accountId, err: err instanceof Error ? err.message : String(err) },
        'barSource: failed to load ai_symbols',
      );
      return [];
    }
  }
}
