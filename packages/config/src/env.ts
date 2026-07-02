export type GoldBotEnv = {
  GB_APP_ENV: string;
  GB_APP_SERVER_HOST: string;
  GB_APP_SERVER_PORT: number;
  GB_EA_STORE_SQLITE_PATH: string;
  GB_NODE_SHADOW_MODE: boolean;
  GB_ADMIN_TOKEN: string;
};

type EnvSource = Partial<Record<string, string | undefined>>;

export function loadGoldBotEnv(source: EnvSource = process.env): GoldBotEnv {
  return {
    GB_APP_ENV: source.GB_APP_ENV ?? 'development',
    GB_APP_SERVER_HOST: source.GB_APP_SERVER_HOST ?? '127.0.0.1',
    GB_APP_SERVER_PORT: parsePort(source.GB_APP_SERVER_PORT),
    GB_EA_STORE_SQLITE_PATH: source.GB_EA_STORE_SQLITE_PATH ?? '',
    GB_NODE_SHADOW_MODE: parseBoolean(source.GB_NODE_SHADOW_MODE, true),
    GB_ADMIN_TOKEN: source.GB_ADMIN_TOKEN ?? source.ADMIN_TOKEN ?? ''
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
