import { validateConfig, type AccountConfig, type AppConfig } from './app-config.service.js';

export type { AccountConfig, AppConfig };

// --- Cached config ---

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load .env via dotenv (synchronous)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as typeof import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not available, rely on process.env
  }

  return loadConfigFromEnv();
}

/**
 * Load config directly from process.env without dotenv.
 * Useful for testing or when env is already populated.
 */
export function loadConfigFromEnv(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = validateConfig(process.env);
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
