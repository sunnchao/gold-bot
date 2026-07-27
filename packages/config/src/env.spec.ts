import { describe, expect, it } from 'vitest';
import { loadGoldBotEnv } from './env.js';

describe('loadGoldBotEnv', () => {
  it('loads placeholder GB variables with defaults', () => {
    expect(loadGoldBotEnv({})).toEqual({
      GB_APP_ENV: 'development',
      GB_APP_SERVER_HOST: '127.0.0.1',
      GB_APP_SERVER_PORT: 3000,
      GB_EA_STORE_SQLITE_PATH: '',
      GB_EA_STORE_POSTGRES_DSN: '',
      GB_NODE_SHADOW_MODE: false,
      GB_ADMIN_TOKEN: '',
      GB_LEGACY_TOKENS_PATH: '',
      GB_REDIS_URL: '',
      GB_DISCORD_WEBHOOK_URL: '',
      GB_FEISHU_WEBHOOK_URL: '',
      GB_FEISHU_SECRET: '',
      GB_MAX_DAILY_LOSS_PCT: 0.05
    });
  });

  it('parses explicit app-server settings', () => {
    expect(
      loadGoldBotEnv({
        GB_APP_ENV: 'test',
        GB_APP_SERVER_HOST: '0.0.0.0',
        GB_APP_SERVER_PORT: '3100',
        GB_EA_STORE_SQLITE_PATH: '/tmp/gold-bot-ea.sqlite',
        GB_NODE_SHADOW_MODE: 'false',
        GB_ADMIN_TOKEN: 'gb-admin-token'
      })
    ).toEqual({
      GB_APP_ENV: 'test',
      GB_APP_SERVER_HOST: '0.0.0.0',
      GB_APP_SERVER_PORT: 3100,
      GB_EA_STORE_SQLITE_PATH: '/tmp/gold-bot-ea.sqlite',
      GB_EA_STORE_POSTGRES_DSN: '',
      GB_NODE_SHADOW_MODE: false,
      GB_ADMIN_TOKEN: 'gb-admin-token',
      GB_LEGACY_TOKENS_PATH: '',
      GB_REDIS_URL: '',
      GB_DISCORD_WEBHOOK_URL: '',
      GB_FEISHU_WEBHOOK_URL: '',
      GB_FEISHU_SECRET: '',
      GB_MAX_DAILY_LOSS_PCT: 0.05
    });
  });

  it('falls back to legacy ADMIN_TOKEN for Go-compatible admin bootstrap', () => {
    expect(loadGoldBotEnv({ ADMIN_TOKEN: 'legacy-admin-token' }).GB_ADMIN_TOKEN).toBe('legacy-admin-token');
  });

  it('parses GB_MAX_DAILY_LOSS_PCT and rejects out-of-range ratios', () => {
    expect(loadGoldBotEnv({ GB_MAX_DAILY_LOSS_PCT: '0.03' }).GB_MAX_DAILY_LOSS_PCT).toBe(0.03);
    expect(() => loadGoldBotEnv({ GB_MAX_DAILY_LOSS_PCT: '1.5' })).toThrow(/GB_MAX_DAILY_LOSS_PCT/);
    expect(() => loadGoldBotEnv({ GB_MAX_DAILY_LOSS_PCT: 'abc' })).toThrow(/GB_MAX_DAILY_LOSS_PCT/);
  });
});
