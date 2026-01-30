/**
 * Centralized fuzzy search utility using uFuzzy
 *
 * Features:
 * - Word boundary aware matching ("proj" matches "My Project")
 * - Full CJK (Chinese/Japanese/Korean) support via Unicode mode
 * - Transparent scoring for sorting by relevance
 * - Match ranges for highlighting
 */

import uFuzzy from '@leeoniya/ufuzzy'

// Unicode mode for CJK support (Chinese, Japanese, Korean)
// This is 50-75% slower than ASCII mode, but negligible for small lists (<1000 items)
const uf = new uFuzzy({
  unicode: true,
  interSplit: "[^\\p{L}\\d']+", // Split on non-letter/digit
  intraSplit: '\\p{Ll}\\p{Lu}', // Split on case change (camelCase)
})

export interface FuzzyResult<T> {
  item: T
  /** Match score - higher is better */
  score: number
  /** Character ranges for highlighting: [[start, end], ...] */
  ranges?: number[][]
}

/**
 * Fuzzy search/filter a list of items
 * Returns items sorted by match quality (best first)
 *
 * @param items - Array of items to search
 * @param query - Search query string
 * @param getText - Function to extract searchable text from each item
 * @returns Filtered and sorted results with scores
 *
 * @example
 * const results = fuzzyFilter(commands, 'cmt', cmd => cmd.label)
 * // Returns commands matching "cmt" like "commit", sorted by relevance
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string
): FuzzyResult<T>[] {
  if (!query.trim()) {
    return items.map((item) => ({ item, score: 0 }))
  }

  const haystack = items.map(getText)
  const idxs = uf.filter(haystack, query)

  if (!idxs || idxs.length === 0) return []

  const info = uf.info(idxs, haystack, query)
  const order = uf.sort(info, haystack, query)

  return order.map((i) => ({
    item: items[idxs[i]],
    score: info.score?.[i] ?? 0,
    ranges: info.ranges?.[i],
  }))
}

/**
 * Get fuzzy match score for a single text string
 * Useful for sorting/prioritization without full filtering
 *
 * @param text - Text to match against
 * @param query - Search query
 * @returns Score (higher = better match), 0 if no match
 *
 * @example
 * const score = fuzzyScore("My Project", "proj")
 * // Returns positive score for word boundary match
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query.trim()) return 0

  const idxs = uf.filter([text], query)
  if (!idxs || idxs.length === 0) return 0

  const info = uf.info(idxs, [text], query)
  // info.score can be undefined if no scoring info available
  return info.score?.[0] ?? 1
}

/**
 * Check if text fuzzy-matches the query
 * Simple boolean check, faster than getting full score
 *
 * @param text - Text to match against
 * @param query - Search query
 * @returns true if matches
 */
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query.trim()) return true

  const idxs = uf.filter([text], query)
  return idxs !== null && idxs.length > 0
}
