import { Injectable } from '@nestjs/common';
import pRetry from 'p-retry';
import { z } from 'zod';
import type { GoldbotPayload, PendingSignal } from '../types/goldbot.js';
import type { AISignalResult } from '../types/agent.js';
import { AppConfigService } from '../config/app-config.service.js';
import { getLogger } from '../utils/logger.js';
import { GoldbotPayloadSchema, PendingSignalSchema } from '../types/schemas.js';

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 3;

const AccountSymbolsSchema = z.array(z.string().min(1));

export type AccountSymbols = { symbols: string[] };

// Transformer: gold-bot returns array directly, but we expose { symbols } for consumers
function toAccountSymbols(raw: unknown): AccountSymbols {
  const symbols = AccountSymbolsSchema.parse(raw);
  return { symbols };
}

export class GoldbotAPI {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const logger = getLogger();

    return pRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
          logger.debug({ url, method: options.method ?? 'GET' }, 'GoldbotAPI request');

          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-API-Token': this.token,
              ...options.headers,
            },
          });

          if (!response.ok) {
            const body = await response.text().catch(() => 'no body');
            throw new Error(`GoldbotAPI ${options.method ?? 'GET'} ${path} failed: ${response.status} ${body}`);
          }

          // Validate JSON response with Zod at runtime
          const rawJson = await response.json();
          return schema.parse(rawJson);
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        retries: RETRY_ATTEMPTS,
        minTimeout: 1000,
        maxTimeout: 10000,
        factor: 2,
        onFailedAttempt: (error) => {
          logger.warn(
            { attempt: error.attemptNumber, retriesLeft: error.retriesLeft, path },
            'GoldbotAPI request failed, retrying...'
          );
        },
      }
    );
  }

  async fetchAnalysisPayload(accountId: string, symbol: string): Promise<GoldbotPayload> {
    return this.request<GoldbotPayload>(
      `/api/v2/analysis_payload/${encodeURIComponent(accountId)}/${encodeURIComponent(symbol)}`,
      {},
      GoldbotPayloadSchema,
    );
  }

  async fetchPendingSignal(accountId: string, symbol: string): Promise<PendingSignal | null> {
    try {
      const signalOrSignals = await this.request<PendingSignal | PendingSignal[]>(
        `/api/pending_signal/${encodeURIComponent(accountId)}/${encodeURIComponent(symbol)}`,
        {},
        z.union([PendingSignalSchema, z.array(PendingSignalSchema)]),
      );
      if (Array.isArray(signalOrSignals)) {
        return signalOrSignals[0] ?? null;
      }
      return signalOrSignals;
    } catch (error) {
      const logger = getLogger();
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('404') || errMsg.includes('204')) {
        logger.debug({ accountId, symbol }, 'No pending signal found');
        return null;
      }
      throw error;
    }
  }

  async fetchAccountSymbols(accountId: string): Promise<AccountSymbols> {
    const raw = await this.request<string[]>(
      `/api/ai_symbols/${encodeURIComponent(accountId)}`,
      {},
      z.array(z.string().min(1)),
    );
    return toAccountSymbols(raw);
  }

  async postAIResult(accountId: string, symbol: string, result: AISignalResult): Promise<void> {
    await this.request<unknown>(
      `/api/v2/ai_result/${encodeURIComponent(accountId)}/${encodeURIComponent(symbol)}`,
      {
        method: 'POST',
        body: JSON.stringify(result),
      },
      z.unknown(),
    );
  }
}

@Injectable()
export class GoldbotApiService extends GoldbotAPI {
  constructor(config: AppConfigService) {
    super(config.goldbot.apiUrl, config.goldbot.apiToken);
  }
}
