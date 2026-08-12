import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AccountConfigSchema = z.object({
  id: z.string().min(1, 'Account ID is required'),
  symbols: z.array(z.string().min(1)).min(1, 'At least one symbol is required'),
});

export type AccountConfig = z.infer<typeof AccountConfigSchema>;

const BooleanConfigSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const AppConfigSchema = z.object({
  goldbotApiUrl: z.string().url(),
  goldbotApiToken: z.string().min(1),
  redisUrl: z.string().min(1),
  llmProvider: z.string().min(1),
  llmBaseUrl: z.string().url(),
  llmApiKey: z.string().min(1),
  llmModel: z.string().min(1),
  llmTradeModel: z.string().min(1).default('deepseek-v4-flash-0731'),
  llmFallbackModel: z.string().min(1),
  llmTimeout: z.coerce.number().int().positive().default(240000),
  llmMaxRetries: z.coerce.number().int().min(0).default(3),
  llmEnablePromptCaching: z.coerce.boolean().default(false),
  marketFirstEnabled: BooleanConfigSchema.default(false),
  marketBarAccount: z.string().min(1).default('90011087'),
  marketInsightTtlMs: z.coerce.number().int().positive().default(600000),
  priceDeviationToleranceAtr: z.coerce.number().positive().default(0.25),
  scheduleCron: z.string().min(1).default('*/5 * * * *'),
  accounts: z.array(AccountConfigSchema).min(1, 'At least one account is required'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  port: z.coerce.number().int().positive().default(3100),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

function parseAccounts(env: Record<string, unknown>): unknown {
  const rawAccounts = env.ACCOUNTS_CONFIG;
  if (typeof rawAccounts === 'string') {
    try {
      return JSON.parse(rawAccounts);
    } catch {
      const filePath =
        typeof env.ACCOUNTS_CONFIG_FILE === 'string'
          ? env.ACCOUNTS_CONFIG_FILE
          : path.resolve(process.cwd(), 'accounts.json');
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
      throw new Error('ACCOUNTS_CONFIG must be a valid JSON array');
    }
  }

  return [];
}

export function validateConfig(env: Record<string, unknown>): AppConfig {
  const raw = {
    goldbotApiUrl: env.GOLDBOT_API_URL ?? 'http://127.0.0.1:3000',
    goldbotApiToken: env.GOLDBOT_API_TOKEN ?? 'test-token',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    llmProvider: env.LLM_PROVIDER ?? 'openai',
    llmBaseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    llmApiKey: env.LLM_API_KEY ?? 'sk-test',
    llmModel: env.LLM_MODEL ?? 'gpt-4o',
    llmTradeModel: env.LLM_TRADE_MODEL ?? 'deepseek-v4-flash-0731',
    llmFallbackModel: env.LLM_FALLBACK_MODEL ?? 'gpt-4o-mini',
    llmTimeout: env.LLM_TIMEOUT ?? '120000',
    llmMaxRetries: env.LLM_MAX_RETRIES ?? '3',
    llmEnablePromptCaching: env.LLM_ENABLE_PROMPT_CACHING ?? 'false',
    marketFirstEnabled: env.MARKET_FIRST_ENABLED ?? 'false',
    marketBarAccount: env.MARKET_BAR_ACCOUNT ?? '90011087',
    marketInsightTtlMs: env.MARKET_INSIGHT_TTL_MS ?? '600000',
    priceDeviationToleranceAtr: env.PRICE_DEVIATION_TOLERANCE_ATR ?? '0.25',
    scheduleCron: env.SCHEDULE_CRON ?? '*/5 * * * *',
    accounts: parseAccounts(env),
    logLevel: env.LOG_LEVEL ?? 'info',
    port: env.PORT ?? '3100',
  };

  return AppConfigSchema.parse(raw);
}

export const APP_CONFIG = Symbol('APP_CONFIG');

@Injectable()
export class AppConfigService {
  private accountsConfig: AccountConfig[];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.accountsConfig = config.accounts.map((account) => ({
      ...account,
      symbols: [...account.symbols],
    }));
  }

  get port(): number {
    return this.config.port;
  }

  get logLevel(): AppConfig['logLevel'] {
    return this.config.logLevel;
  }

  get goldbot(): { apiUrl: string; apiToken: string } {
    return {
      apiUrl: this.config.goldbotApiUrl,
      apiToken: this.config.goldbotApiToken,
    };
  }

  get redisUrl(): string {
    return this.config.redisUrl;
  }

  get llm(): {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    fallbackModel: string;
    timeout: number;
    maxRetries: number;
    enablePromptCaching: boolean;
  } {
    return {
      provider: this.config.llmProvider,
      baseUrl: this.config.llmBaseUrl,
      apiKey: this.config.llmApiKey,
      model: this.config.llmModel,
      fallbackModel: this.config.llmFallbackModel,
      timeout: this.config.llmTimeout,
      maxRetries: this.config.llmMaxRetries,
      enablePromptCaching: this.config.llmEnablePromptCaching,
    };
  }

  get llmTradeModel(): string {
    return this.config.llmTradeModel;
  }

  get marketFirstEnabled(): boolean {
    return this.config.marketFirstEnabled;
  }

  get marketBarAccount(): string {
    return this.config.marketBarAccount;
  }

  get marketInsightTtlMs(): number {
    return this.config.marketInsightTtlMs;
  }

  get priceDeviationToleranceAtr(): number {
    return this.config.priceDeviationToleranceAtr;
  }

  get scheduleCron(): string {
    return this.config.scheduleCron;
  }

  get accounts(): AccountConfig[] {
    return this.accountsConfig.map((account) => ({
      ...account,
      symbols: [...account.symbols],
    }));
  }

  get staticAccounts(): AccountConfig[] {
    return this.config.accounts.map((account) => ({
      ...account,
      symbols: [...account.symbols],
    }));
  }

  get raw(): AppConfig {
    return {
      ...this.config,
      accounts: this.accounts,
    };
  }

  updateAccountSymbols(accountId: string, symbols: string[]): void {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    AccountConfigSchema.parse({ id: accountId, symbols: normalizedSymbols });

    this.accountsConfig = this.accountsConfig.map((account) =>
      account.id === accountId
        ? {
            ...account,
            symbols: normalizedSymbols,
          }
        : account,
    );
  }
}
