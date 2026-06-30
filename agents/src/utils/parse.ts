/**
 * Safe JSON parsing utilities for LLM responses.
 * Wraps Zod.safeParse() so agents never throw on invalid LLM output.
 */

import { z } from 'zod';
import { getLogger } from './logger.js';

export interface SafeParseResult<T> {
  success: true;
  data: T;
}

export interface SafeParseError {
  success: false;
  error: string;
}

export type SafeParseOutcome<T> = SafeParseResult<T> | SafeParseError;

/** Extract first JSON object from a possibly-wrapped string. */
export function extractJson(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/**
 * Safely parse a single LLM response with a Zod schema.
 * Returns null on any failure (no JSON, invalid JSON, schema mismatch).
 */
export function safeParseResponse<T>(
  raw: string,
  schema: z.ZodType<T>,
  context?: Record<string, unknown>,
): T | null {
  const logger = getLogger();
  const json = extractJson(raw);
  if (!json) {
    logger.warn({ raw: raw.slice(0, 200), ...context }, 'safeParse: no JSON found');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    logger.warn(
      { raw: raw.slice(0, 200), err: (err as Error).message, ...context },
      'safeParse: JSON.parse failed',
    );
    return null;
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues.slice(0, 5), ...context },
      'safeParse: Zod validation failed',
    );
    return null;
  }

  return result.data;
}

/**
 * Safely parse a batch LLM response keyed by symbol.
 * Returns a Record of successfully parsed entries; failed ones are silently dropped.
 */
export function safeParseBatchResponse<T>(
  raw: string,
  schema: z.ZodType<T>,
  context?: Record<string, unknown>,
): Record<string, T> {
  const logger = getLogger();
  const json = extractJson(raw);
  if (!json) {
    logger.warn({ raw: raw.slice(0, 200), ...context }, 'safeParseBatch: no JSON found');
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    logger.warn(
      { raw: raw.slice(0, 200), err: (err as Error).message, ...context },
      'safeParseBatch: JSON.parse failed',
    );
    return {};
  }

  const results: Record<string, T> = {};
  for (const [symbol, data] of Object.entries(parsed)) {
    const result = schema.safeParse(data);
    if (result.success) {
      results[symbol] = result.data;
    } else {
      logger.warn(
        { symbol, issues: result.error.issues.slice(0, 5), ...context },
        'safeParseBatch: per-symbol Zod validation failed',
      );
    }
  }
  return results;
}
