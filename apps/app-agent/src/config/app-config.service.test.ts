import { describe, expect, it } from 'vitest';
import { AppConfigService, validateConfig } from './app-config.service.js';

const env = {
  GOLDBOT_API_URL: 'http://127.0.0.1:3000',
  GOLDBOT_API_TOKEN: 'test-token',
  REDIS_URL: 'redis://localhost:6379',
  LLM_PROVIDER: 'openai',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  LLM_API_KEY: 'sk-test-key',
  LLM_MODEL: 'gpt-4o',
  LLM_FALLBACK_MODEL: 'gpt-4o-mini',
  LLM_TIMEOUT: '240000',
  LLM_MAX_RETRIES: '3',
  SCHEDULE_CRON: '*/5 * * * *',
  ACCOUNTS_CONFIG: JSON.stringify([{ id: 'acc-001', symbols: ['XAUUSD'] }]),
  ACCOUNTS_CONFIG_FILE: '/tmp/nonexistent-accounts.json',
  LOG_LEVEL: 'info',
  PORT: '3100',
};

describe('validateConfig', () => {
  it('validates and coerces environment variables', () => {
    const config = validateConfig(env);

    expect(config.port).toBe(3100);
    expect(config.accounts).toEqual([{ id: 'acc-001', symbols: ['XAUUSD'] }]);
    expect(config.llmTimeout).toBe(240000);
  });

  it('rejects invalid account JSON', () => {
    expect(() => validateConfig({ ...env, ACCOUNTS_CONFIG: 'not-json' })).toThrow(
      'ACCOUNTS_CONFIG must be a valid JSON array',
    );
  });
});

describe('AppConfigService', () => {
  it('exposes strongly typed config values', () => {
    const service = new AppConfigService(validateConfig(env));

    expect(service.port).toBe(3100);
    expect(service.goldbot).toEqual({
      apiUrl: 'http://127.0.0.1:3000',
      apiToken: 'test-token',
    });
    expect(service.llm.model).toBe('gpt-4o');
    expect(service.accounts[0].symbols).toEqual(['XAUUSD']);
  });

  it('updates runtime account symbols while preserving static fallback config', () => {
    const service = new AppConfigService(validateConfig(env));

    service.updateAccountSymbols('acc-001', ['XAUUSD', 'US100Cash', 'XAUUSD']);

    expect(service.accounts[0].symbols).toEqual(['XAUUSD', 'US100Cash']);
    expect(service.staticAccounts[0].symbols).toEqual(['XAUUSD']);
    expect(service.raw.accounts[0].symbols).toEqual(['XAUUSD', 'US100Cash']);
  });

  it('returns defensive copies of account config', () => {
    const service = new AppConfigService(validateConfig(env));
    const accounts = service.accounts;

    accounts[0].symbols.push('US100Cash');

    expect(service.accounts[0].symbols).toEqual(['XAUUSD']);
  });

  it('defaults the Goldbot API URL to the Node app-server authority', () => {
    const config = validateConfig({
      ...env,
      GOLDBOT_API_URL: undefined,
    });

    expect(config.goldbotApiUrl).toBe('http://127.0.0.1:3000');
  });
});
