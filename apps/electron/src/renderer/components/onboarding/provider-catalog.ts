/**
 * provider-catalog — pure helpers for the searchable provider picker.
 *
 * Kept free of React and of any asset imports so the filtering, ranking and
 * keyboard math can be unit tested with plain `bun test`.
 *
 * The catalog itself comes from `getPiApiKeyProviders()` (packages/shared/src/config/models-pi.ts),
 * reached from the renderer over RPC via `window.electronAPI.getPiApiKeyProviders()`.
 */

/** One API-key provider as returned by `getPiApiKeyProviders()`. */
export interface PiProviderEntry {
  /** Pi SDK provider id, e.g. 'mistral' — this is the `piAuthProvider` value. */
  key: string
  /** Human-readable name, e.g. 'Mistral'. */
  label: string
  /** API-key hint for the credential step, e.g. 'sk-...'. */
  placeholder: string
}

/**
 * Sentinel key for the catch-all row. Matches the 'custom' preset key that
 * ApiKeyInput already uses for arbitrary OpenAI-compatible endpoints.
 */
export const OTHER_PROVIDER_KEY = 'custom'

/** The always-present "anything else" row, pinned to the bottom of the list. */
export const OTHER_PROVIDER_ENTRY: PiProviderEntry = {
  key: OTHER_PROVIDER_KEY,
  label: 'Other — OpenAI-compatible endpoint',
  placeholder: 'Paste your key here...',
}

/** Reduce a label or key to comparable characters: lowercase alphanumerics only. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Filter the provider catalog by a free-text query, matching on both the
 * human label and the provider key. Punctuation, spaces and hyphens are
 * ignored on both sides, so "z.ai", "zai" and "z ai" all find `zai`, and
 * "openai eu" finds `openai-eu`.
 *
 * Results are ranked: label prefix, then key prefix, then substring. Within a
 * rank the catalog's own ordering is preserved (anthropic / google / openai first).
 *
 * An empty query returns the catalog untouched.
 */
export function filterProviders(providers: readonly PiProviderEntry[], query: string): PiProviderEntry[] {
  const needle = normalize(query)
  if (!needle) return [...providers]

  const scored: Array<{ entry: PiProviderEntry; rank: number }> = []

  for (const entry of providers) {
    const label = normalize(entry.label)
    const key = normalize(entry.key)

    let rank: number
    if (label.startsWith(needle)) rank = 0
    else if (key.startsWith(needle)) rank = 1
    else if (label.includes(needle) || key.includes(needle)) rank = 2
    else continue

    scored.push({ entry, rank })
  }

  // Array#sort is stable, so equal ranks keep the catalog's own priority order.
  return scored.sort((a, b) => a.rank - b.rank).map((item) => item.entry)
}

/**
 * Move a listbox cursor by `delta`, wrapping around both ends.
 * Returns 0 for an empty list so callers never hold an out-of-range index.
 */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0
  const safeCurrent = clampIndex(current, length)
  return (((safeCurrent + delta) % length) + length) % length
}

/** Clamp an index into `[0, length - 1]`, or 0 when the list is empty. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (index < 0) return 0
  if (index > length - 1) return length - 1
  return index
}

/**
 * Brand icons we ship under `@/assets/provider-icons`. Returning a slug rather
 * than an imported URL keeps this module asset-free (and therefore testable).
 */
export type ProviderIconSlug =
  | 'claude'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'mistral'
  | 'ollama'
  | 'huggingface'
  | 'aws'
  | 'azure'
  | 'minimax'
  | 'kimi'
  | 'vercel'
  | 'pi'

const ICON_BY_EXACT_KEY: Record<string, ProviderIconSlug> = {
  anthropic: 'claude',
  'amazon-bedrock': 'aws',
  'vercel-ai-gateway': 'vercel',
  pi: 'pi',
}

/** Prefix rules, longest-first, for the provider ids we do not enumerate. */
const ICON_BY_PREFIX: ReadonlyArray<readonly [string, ProviderIconSlug]> = [
  ['huggingface', 'huggingface'],
  ['openrouter', 'openrouter'],
  ['minimax', 'minimax'],
  ['mistral', 'mistral'],
  ['anthropic', 'claude'],
  ['amazon', 'aws'],
  ['google', 'google'],
  ['openai', 'openai'],
  ['vercel', 'vercel'],
  ['ollama', 'ollama'],
  ['azure', 'azure'],
  ['kimi', 'kimi'],
]

/** Resolve a provider key to one of our bundled brand icons, or null for a monogram. */
export function resolveProviderIconSlug(key: string): ProviderIconSlug | null {
  const normalized = key.toLowerCase()
  const exact = ICON_BY_EXACT_KEY[normalized]
  if (exact) return exact

  for (const [prefix, slug] of ICON_BY_PREFIX) {
    if (normalized.startsWith(prefix)) return slug
  }
  return null
}

/** First letter of a provider label, used when no brand icon exists. */
export function providerMonogram(label: string): string {
  const firstAlphanumeric = label.match(/[a-z0-9]/i)
  return (firstAlphanumeric?.[0] ?? '?').toUpperCase()
}
