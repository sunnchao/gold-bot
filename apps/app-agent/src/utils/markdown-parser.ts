/**
 * Markdown structured output parser for LLM responses.
 *
 * Replaces strict JSON parsing with a tolerant Markdown key-value extractor.
 * LLMs follow Markdown format much more reliably than JSON — single field
 * failures no longer destroy the entire output.
 *
 * Format:
 *   ## SECTION NAME
 *   - Key: Value
 *   - Key: Value
 *     - list item 1
 *     - list item 2
 */

// ── Section splitting ────────────────────────────────────────────────────────

/**
 * Split raw LLM output into sections keyed by `## HEADER`.
 * Keys are lowercased with spaces→underscores for reliable lookup.
 */
export function splitSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = raw.split('\n');
  let currentSection = '';
  const currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n'));
      }
      currentSection = normalizeKey(headerMatch[1]);
      currentContent.length = 0;
    } else {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n'));
  }

  // Fallback: if no ## headers found but content exists, treat entire raw as a single "root" section
  if (sections.size === 0 && raw.trim().length > 0) {
    sections.set('root', raw);
  }

  return sections;
}

// ── Field extraction ─────────────────────────────────────────────────────────

/**
 * Extract `- Key: Value` pairs from a section body.
 * Returns a Map of normalized_key → raw_value.
 */
export function extractFields(section: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of section.split('\n')) {
    // Only match top-level KV lines (not indented)
    const kvMatch = line.match(/^-\s+(.+?):\s+(.*)/);
    if (kvMatch) {
      const key = normalizeKey(kvMatch[1]);
      const value = kvMatch[2].trim();
      // Only set if not already present (first occurrence wins)
      if (!fields.has(key)) {
        fields.set(key, value);
      }
    }
  }
  return fields;
}

/**
 * Extract indented list items from a section.
 * Catches lines like `  - something | with | pipes` under a parent key.
 * Excludes lines that match the `- Key: Value` pattern (those are fields, not list items).
 */
export function extractListItems(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split('\n')) {
    // Indented list item: "  - content" or "    - content"
    const listMatch = line.match(/^\s{2,}-\s+(.+)/);
    if (listMatch) {
      const content = listMatch[1].trim();
      // Exclude if it looks like a key-value pair with a colon (but allow pipe-delimited SR lines)
      if (!content.match(/^[^|]+:/) || content.includes('|')) {
        items.push(content);
      }
    }
  }
  return items;
}

// ── Type-safe field accessors ────────────────────────────────────────────────

/**
 * Safely extract an enum value. Returns defaultVal if the raw value is not
 * in the allowed list. Performs case-insensitive + fuzzy matching.
 */
export function getEnumField<T extends string>(
  fields: Map<string, string>,
  key: string,
  allowed: readonly T[],
  defaultVal: T,
): T {
  const raw = fields.get(normalizeKey(key));
  if (!raw) return defaultVal;

  const normalized = raw.trim().toLowerCase();

  // Exact match
  for (const allowedVal of allowed) {
    if (allowedVal.toLowerCase() === normalized) return allowedVal;
  }

  // Fuzzy match: strip underscores/hyphens/spaces
  const cleaned = normalized.replace(/[_\s-]/g, '');
  for (const allowedVal of allowed) {
    if (allowedVal.replace(/[_\s-]/g, '').toLowerCase() === cleaned) return allowedVal;
  }

  return defaultVal;
}

/**
 * Safely extract a numeric value. Extracts the first valid number from the
 * raw string. Returns defaultVal on any failure.
 */
export function getNumberField(
  fields: Map<string, string>,
  key: string,
  defaultVal: number,
  opts?: { min?: number; max?: number },
): number {
  const raw = fields.get(normalizeKey(key));
  if (!raw) return defaultVal;

  // Extract first number (including negative and decimal)
  const numMatch = raw.match(/-?\d+\.?\d*/);
  if (!numMatch) return defaultVal;

  const num = Number(numMatch[0]);
  if (!Number.isFinite(num)) return defaultVal;
  if (opts?.min !== undefined && num < opts.min) return defaultVal;
  if (opts?.max !== undefined && num > opts.max) return defaultVal;

  return num;
}

/**
 * Safely extract a boolean value.
 * Accepts: true/false, 1/0, yes/no (case-insensitive).
 */
export function getBooleanField(
  fields: Map<string, string>,
  key: string,
  defaultVal: boolean,
): boolean {
  const raw = fields.get(normalizeKey(key));
  if (!raw) return defaultVal;

  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return defaultVal;
}

/**
 * Safely extract a string value. Sanitizes HTML tags and truncates to maxLength.
 */
export function getStringField(
  fields: Map<string, string>,
  key: string,
  defaultVal: string = '',
  maxLength: number = 2000,
): string {
  const raw = fields.get(normalizeKey(key));
  if (!raw || raw.trim().length === 0) return defaultVal;

  // Remove HTML/script tags
  const sanitized = raw.replace(/<[^>]*>/g, '').trim();
  if (sanitized.length === 0) return defaultVal;
  return sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

// ── Specialized parsers ──────────────────────────────────────────────────────

/** S/R level line format: `4287.50 | support | strong | H1 | 3` */
export function parseSRLevelLine(
  line: string,
  expectedType: 'support' | 'resistance',
): {
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'moderate' | 'weak';
  timeframe: string;
  touches: number;
} | null {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 2) return null;

  const price = Number(parts[0]);
  if (!Number.isFinite(price) || price <= 0) return null;

  // parts[1] is often the type column, but we force expectedType for consistency
  const strengthRaw = (parts[2] || '').toLowerCase();
  const strength = (['strong', 'moderate', 'weak'] as const).includes(strengthRaw as 'strong' | 'moderate' | 'weak')
    ? (strengthRaw as 'strong' | 'moderate' | 'weak')
    : 'moderate';

  const timeframe = parts[3] || 'H1';
  const touchesRaw = Number(parts[4]);
  const touches = Number.isFinite(touchesRaw) ? Math.max(0, Math.min(20, Math.round(touchesRaw))) : 1;

  return { price, type: expectedType, strength, timeframe, touches };
}

/**
 * Parse S/R level lines from a section, separating support vs resistance
 * based on the content of each line (type column or fallback to expectedType).
 */
export function parseSRLevels(
  lines: string[],
  expectedType: 'support' | 'resistance',
): Array<{
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'moderate' | 'weak';
  timeframe: string;
  touches: number;
}> {
  const results: Array<{
    price: number;
    type: 'support' | 'resistance';
    strength: 'strong' | 'moderate' | 'weak';
    timeframe: string;
    touches: number;
  }> = [];
  for (const line of lines) {
    const parsed = parseSRLevelLine(line, expectedType);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results.slice(0, 6); // Max 6 levels
}

/** Warnings line: semicolon-separated strings */
export function parseWarningsLine(line: string): string[] {
  if (!line) return [];
  return line
    .split(';')
    .map(s => s.trim().replace(/<[^>]*>/g, ''))
    .filter(s => s.length > 0 && s.length <= 500)
    .slice(0, 10);
}

/**
 * Extract warnings from a section. Tries to find all warning-related list items
 * and the "Warnings" key-value field.
 */
export function extractWarnings(fields: Map<string, string>, listItems: string[]): string[] {
  // 1. Try the Warnings field (semicolon-separated)
  const warningsField = fields.get('warnings');
  if (warningsField) {
    return parseWarningsLine(warningsField);
  }

  // 2. Try list items that look like warnings (under a "Warnings" section)
  if (listItems.length > 0) {
    return listItems
      .map(s => s.trim().replace(/<[^>]*>/g, ''))
      .filter(s => s.length > 0 && s.length <= 500)
      .slice(0, 10);
  }

  return [];
}

// ── Key normalization ────────────────────────────────────────────────────────

/** Lowercase + replace spaces/hyphens with underscores */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// ── Dual-format parser (Markdown + JSON fallback) ───────────────────────────

/**
 * Try Markdown parsing first; fall back to JSON extraction if no ## headers found.
 * This provides a smooth migration path.
 */
export function detectFormat(raw: string): 'markdown' | 'json' | 'unknown' {
  if (raw.match(/^##\s+/m)) return 'markdown';
  if (raw.match(/\{[\s\S]*\}/)) return 'json';
  return 'unknown';
}
