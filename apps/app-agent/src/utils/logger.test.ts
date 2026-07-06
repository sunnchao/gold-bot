import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLogger, resetLogger } from '../utils/logger.js';

describe('getLogger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetLogger();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetLogger();
  });

  it('should return a pino logger', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('should return the same instance on repeated calls', () => {
    const logger1 = getLogger();
    const logger2 = getLogger();
    expect(logger1).toBe(logger2);
  });

  it('should respect LOG_LEVEL env var', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = getLogger();
    expect(logger.level).toBe('debug');
  });
});
