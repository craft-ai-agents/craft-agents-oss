/**
 * Omnibox pure helpers — prefix grammar + fuzzy score (S-04 §3.3).
 * No React / Electron deps; covered by bun:test.
 */

export type OmniboxPrefix = '' | '>' | '@' | '/' | '!' | '?' | '#'

const PREFIX_CHARS = new Set(['>', '@', '/', '!', '?', '#'])

export interface ParsedOmniboxInput {
  /** Leading mode character, or '' for universal search. */
  prefix: OmniboxPrefix
  /** Remainder after the prefix (escaped leading `\` stripped). */
  query: string
  /** Raw field value. */
  raw: string
}

/**
 * Parse Omnibox input.
 * - First char in `>@/!?#` → mode prefix (unless escaped as `\>` etc.).
 * - `\` before a prefix char at start escapes it into the query.
 */
export function parsePrefix(raw: string): ParsedOmniboxInput {
  if (raw.length === 0) {
    return { prefix: '', query: '', raw }
  }
  // Escaped prefix: `\>` → query starts with `>`
  if (raw.startsWith('\\') && raw.length >= 2 && PREFIX_CHARS.has(raw[1]!)) {
    return { prefix: '', query: raw.slice(1), raw }
  }
  const first = raw[0]!
  if (PREFIX_CHARS.has(first)) {
    return {
      prefix: first as OmniboxPrefix,
      query: raw.slice(1),
      raw,
    }
  }
  return { prefix: '', query: raw, raw }
}

/**
 * Score how well `target` matches `query` (case-insensitive).
 * Returns 0 when no match; higher is better (max ~1).
 *
 * Priority:
 *  1. exact equality → 1
 *  2. starts-with → 0.9
 *  3. word-boundary (space/punctuation) → 0.75
 *  4. substring → 0.5 + density bonus
 *  5. subsequence → 0.2 + density bonus
 */
export function scoreMatch(target: string, query: string): number {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return 0
  const t = target.toLowerCase()
  if (t.length === 0) return 0

  if (t === q) return 1
  if (t.startsWith(q)) return 0.9

  // Word-boundary: match at start of a word after space/punctuation
  const boundary = new RegExp(
    `(?:^|[\\s\\-_./:()\\[\\]{}])${escapeRegExp(q)}`,
    'i',
  )
  if (boundary.test(target)) return 0.75

  const idx = t.indexOf(q)
  if (idx >= 0) {
    // Earlier + denser substring scores higher within the 0.5 band
    const density = q.length / t.length
    const position = 1 - idx / Math.max(t.length, 1)
    return 0.5 + 0.2 * density + 0.1 * position
  }

  if (isSubsequence(t, q)) {
    const density = q.length / t.length
    return 0.2 + 0.15 * density
  }

  return 0
}

/** Best score across several candidate strings. */
export function scoreMatchAny(targets: Array<string | undefined | null>, query: string): number {
  let best = 0
  for (const target of targets) {
    if (!target) continue
    const s = scoreMatch(target, query)
    if (s > best) best = s
  }
  return best
}

function isSubsequence(target: string, query: string): boolean {
  let ti = 0
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi]!
    const found = target.indexOf(ch, ti)
    if (found < 0) return false
    ti = found + 1
  }
  return true
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
