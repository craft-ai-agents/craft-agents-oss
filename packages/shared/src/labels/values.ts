/**
 * Label Value Utilities
 *
 * Parser and formatter for label entries that carry typed values.
 * Session labels are stored as flat strings: "bug" (boolean) or "priority::3" (valued).
 * The :: separator splits label ID from value. Values are type-inferred at parse time.
 *
 * Value type inference order:
 * 1. ISO date (YYYY-MM-DD) → Date
 * 2. Finite number → number
 * 3. Everything else → string
 */

import type { ParsedLabelEntry } from './types.ts';

/** Separator between label ID and value in session label entries */
const VALUE_SEPARATOR = '::';

/** ISO date pattern: YYYY-MM-DD (date-only, strict format) */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** ISO datetime pattern: YYYY-MM-DDTHH:mm (date + time, no seconds) */
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Simple decimal number: optional negative, digits, optional decimal portion */
const DECIMAL_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Parse a session label entry into its structured form.
 * Splits on the first :: only (values may themselves contain ::).
 *
 * Examples:
 *   "bug"                  → { id: "bug" }
 *   "priority::3"          → { id: "priority", rawValue: "3", value: 3 }
 *   "due::2026-01-30"      → { id: "due", rawValue: "2026-01-30", value: Date }
 *   "url::https://a::b"    → { id: "url", rawValue: "https://a::b", value: "https://a::b" }
 */
export function parseLabelEntry(entry: string): ParsedLabelEntry {
  const separatorIndex = entry.indexOf(VALUE_SEPARATOR);

  // No separator → boolean label
  if (separatorIndex === -1) {
    return { id: entry };
  }

  const id = entry.substring(0, separatorIndex);
  const rawValue = entry.substring(separatorIndex + VALUE_SEPARATOR.length);

  return {
    id,
    rawValue,
    value: inferTypedValue(rawValue),
  };
}

/**
 * Format a label ID and optional value into the stored string form.
 * Handles Date serialization to ISO date string (YYYY-MM-DD).
 *
 * Examples:
 *   formatLabelEntry("bug")              → "bug"
 *   formatLabelEntry("priority", 3)      → "priority::3"
 *   formatLabelEntry("due", new Date())  → "due::2026-01-23"
 *   formatLabelEntry("link", "https://") → "link::https://"
 */
export function formatLabelEntry(id: string, value?: string | number | Date): string {
  if (value === undefined) {
    return id;
  }

  // Serialize Date to ISO string — include time if not midnight UTC
  if (value instanceof Date) {
    const hours = value.getUTCHours();
    const minutes = value.getUTCMinutes();
    const hasTime = hours !== 0 || minutes !== 0;
    const serialized = hasTime
      ? `${value.toISOString().split('T')[0]}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
      : value.toISOString().split('T')[0];
    return `${id}${VALUE_SEPARATOR}${serialized}`;
  }

  return `${id}${VALUE_SEPARATOR}${String(value)}`;
}

/**
 * Quick extraction of label ID from an entry string.
 * Use this when you only need the ID (e.g., for validation/filtering)
 * without the overhead of full parsing.
 *
 * "priority::3" → "priority"
 * "bug"         → "bug"
 */
export function extractLabelId(entry: string): string {
  const separatorIndex = entry.indexOf(VALUE_SEPARATOR);
  return separatorIndex === -1 ? entry : entry.substring(0, separatorIndex);
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Infer the typed value from a raw string.
 * Order matters: date check first (dates also parse as numbers in some cases),
 * then number, then fallback to string.
 */
function inferTypedValue(raw: string): string | number | Date {
  // 1. Check ISO datetime format (YYYY-MM-DDTHH:mm) — must check before date-only
  if (ISO_DATETIME_REGEX.test(raw)) {
    const date = new Date(raw + ':00Z');
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // 2. Check ISO date format (YYYY-MM-DD)
  if (ISO_DATE_REGEX.test(raw)) {
    const date = new Date(raw + 'T00:00:00Z');
    // Validate the date is real by round-tripping: prevents JS Date clamping
    // invalid dates (e.g., 2026-02-29 → 2026-03-01) from being silently accepted
    const roundTrip = date.toISOString().split('T')[0];
    if (roundTrip === raw) {
      return date;
    }
  }

  // 3. Check if it's a simple decimal number (reject hex, octal, binary, scientific notation)
  if (DECIMAL_NUMBER_REGEX.test(raw)) {
    return Number(raw);
  }

  // 4. Fallback: plain string
  return raw;
}
