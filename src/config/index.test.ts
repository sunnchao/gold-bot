import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv, resetConfig, type AccountConfig } from '../config/index.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    process.env = { ...originalEnv };
    // Set required env vars for valid config
    process.env.GOLDBOT_API_URL = 'http://localhost:8880';
    process.env.GOLDBOT_API_TOKEN = 'test-token';
    process.env.LLM_API_KEY = 'sk-test-key';
    process.env.LLM_MODEL = 'gpt-4o';
    process.env.ACCOUNTS_CONFIG = JSON.stringify([{ id: 'acc-001', symbols: ['XAUUSD'] }]);
    process.env.ACCOUNTS_CONFIG_FILE = '/tmp/nonexistent-accounts.json';
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it('should load valid config from env vars', () => {
    const config = loadConfigFromEnv();
    expect(config).toBeDefined();
    expect(config.goldbotApiUrl).toBe('http://localhost:8880');
    expect(config.goldbotApiToken).toBe('test-token');
    expect(config.llmModel).toBe('gpt-4o');
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].id).toBe('acc-001');
    expect(config.accounts[0].symbols).toEqual(['XAUUSD']);
  });

  it('should cache config on subsequent calls', () => {
    const config1 = loadConfigFromEnv();
    const config2 = loadConfigFromEnv();
    expect(config1).toBe(config2);
  });

  it('should validate account config', () => {
    process.env.ACCOUNTS_CONFIG = JSON.stringify([{ id: '', symbols: ['XAUUSD'] }]);
    expect(() => loadConfigFromEnv()).toThrow();
  });

  it('should reject invalid ACCOUNTS_CONFIG JSON', () => {
    process.env.ACCOUNTS_CONFIG = 'not-json';
    expect(() => loadConfigFromEnv()).toThrow('ACCOUNTS_CONFIG must be a valid JSON array');
  });

  it('should use default values for optional fields', () => {
    const config = loadConfigFromEnv();
    expect(config.logLevel).toBe('info');
    expect(config.port).toBe(3100);
    expect(config.scheduleCron).toBe('*/5 * * * *');
  });
});
