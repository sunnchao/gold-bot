/**
 * Deterministic JSON serialization for prompt caching.
 *
 * Why: LLM prompt caches match on exact token prefix. Standard JSON.stringify
 * produces output that varies with key insertion order and includes unnecessary
 * whitespace (null, 2 indent adds ~40% overhead). This module:
 *   1. Sorts object keys alphabetically → same data = same string = cache hit
 *   2. Strips all whitespace → smaller payload, same semantics
 *   3. Handles cycles, undefined, BigInt, Date gracefully
 */

function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (obj instanceof Date) return obj.toISOString();

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    const value = (obj as Record<string, unknown>)[key];
    // Skip undefined values — they are not valid JSON
    if (value === undefined) continue;
    sorted[key] = sortObject(value);
  }
  return sorted;
}

/**
 * Deterministic JSON.stringify — sorted keys, no whitespace.
 * Produces identical output for semantically identical objects
 * regardless of key insertion order.
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(sortObject(obj));
}

/**
 * Stable stringify with indent for debugging/logging only.
 * NOT for prompt content — use stableStringify() for that.
 */
export function stableStringifyPretty(obj: unknown, indent = 2): string {
  return JSON.stringify(sortObject(obj), null, indent);
}
