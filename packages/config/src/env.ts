export type GoldBotEnv = {
  GB_APP_ENV: string;
  GB_APP_SERVER_HOST: string;
  GB_APP_SERVER_PORT: number;
  GB_EA_STORE_SQLITE_PATH: string;
  GB_EA_STORE_POSTGRES_DSN: string;
  GB_NODE_SHADOW_MODE: boolean;
  GB_ADMIN_TOKEN: string;
  GB_LEGACY_TOKENS_PATH: string;
  GB_REDIS_URL: string;
  GB_DISCORD_WEBHOOK_URL: string;
  GB_FEISHU_WEBHOOK_URL: string;
  GB_FEISHU_SECRET: string;
  GB_MAX_DAILY_LOSS_PCT: number;
};

type EnvSource = Partial<Record<string, string | undefined>>;

export function loadGoldBotEnv(source: EnvSource = process.env): GoldBotEnv {
  return {
    GB_APP_ENV: source.GB_APP_ENV ?? 'development',
    GB_APP_SERVER_HOST: source.GB_APP_SERVER_HOST ?? '127.0.0.1',
    GB_APP_SERVER_PORT: parsePort(source.GB_APP_SERVER_PORT),
    GB_EA_STORE_SQLITE_PATH: source.GB_EA_STORE_SQLITE_PATH ?? '',
    GB_EA_STORE_POSTGRES_DSN: source.GB_EA_STORE_POSTGRES_DSN ?? '',
    GB_NODE_SHADOW_MODE: parseBoolean(source.GB_NODE_SHADOW_MODE, false),
    GB_ADMIN_TOKEN: source.GB_ADMIN_TOKEN ?? source.ADMIN_TOKEN ?? '',
    GB_LEGACY_TOKENS_PATH: source.GB_LEGACY_TOKENS_PATH ?? '',
    GB_REDIS_URL: source.GB_REDIS_URL ?? '',
    GB_DISCORD_WEBHOOK_URL: source.GB_DISCORD_WEBHOOK_URL ?? '',
    GB_FEISHU_WEBHOOK_URL: source.GB_FEISHU_WEBHOOK_URL ?? '',
    GB_FEISHU_SECRET: source.GB_FEISHU_SECRET ?? '',
    // 日亏保护阈值（Phase 5.1）：当日已实现回撤达到该比例时阻断新信号/LLM 分析
    GB_MAX_DAILY_LOSS_PCT: parseRatio('GB_MAX_DAILY_LOSS_PCT', source.GB_MAX_DAILY_LOSS_PCT, 0.05)
  };
}

function parsePort(value: string | undefined): number {
  if (value == null || value.trim() === '') {
    return 3000;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`GB_APP_SERVER_PORT must be a valid TCP port, got ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`Expected boolean string "true" or "false", got ${value}`);
}

function parseRatio(name: string, value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`${name} must be a ratio in (0, 1), got ${value}`);
  }
  return parsed;
}
