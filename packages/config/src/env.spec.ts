import { describe, expect, it } from 'vitest';
import { loadGoldBotEnv } from './env.js';

describe('loadGoldBotEnv', () => {
  it('loads placeholder GB variables with defaults', () => {
    expect(loadGoldBotEnv({})).toEqual({
      GB_APP_ENV: 'development',
      GB_APP_SERVER_HOST: '127.0.0.1',
      GB_APP_SERVER_PORT: 3000,
      GB_EA_STORE_SQLITE_PATH: '',
      GB_NODE_SHADOW_MODE: true
    });
  });

  it('parses explicit app-server settings', () => {
    expect(
      loadGoldBotEnv({
        GB_APP_ENV: 'test',
        GB_APP_SERVER_HOST: '0.0.0.0',
        GB_APP_SERVER_PORT: '3100',
        GB_EA_STORE_SQLITE_PATH: '/tmp/gold-bot-ea.sqlite',
        GB_NODE_SHADOW_MODE: 'false'
      })
    ).toEqual({
      GB_APP_ENV: 'test',
      GB_APP_SERVER_HOST: '0.0.0.0',
      GB_APP_SERVER_PORT: 3100,
      GB_EA_STORE_SQLITE_PATH: '/tmp/gold-bot-ea.sqlite',
      GB_NODE_SHADOW_MODE: false
    });
  });
});
