import { describe, expect, it } from 'bun:test'
import {
  OTHER_PROVIDER_ENTRY,
  OTHER_PROVIDER_KEY,
  clampIndex,
  filterProviders,
  moveIndex,
  providerMonogram,
  resolveProviderIconSlug,
  type PiProviderEntry,
} from '../provider-catalog'

/** Shaped like a real getPiApiKeyProviders() response (anthropic/google/openai pinned first). */
const CATALOG: PiProviderEntry[] = [
  { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { key: 'google', label: 'Google AI Studio', placeholder: 'AIza...' },
  { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { key: 'amazon-bedrock', label: 'Amazon Bedrock', placeholder: 'AKIA...' },
  { key: 'cerebras', label: 'Cerebras', placeholder: 'csk-...' },
  { key: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
  { key: 'mistral', label: 'Mistral', placeholder: 'Paste your key here...' },
  { key: 'openai-eu', label: 'Openai Eu', placeholder: 'sk-...' },
  { key: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
  { key: 'zai', label: 'z.ai (GLM)', placeholder: 'Paste your key here...' },
]

const keysOf = (entries: PiProviderEntry[]) => entries.map((entry) => entry.key)

describe('filterProviders', () => {
  it('returns the whole catalog, in order, for an empty query', () => {
    expect(keysOf(filterProviders(CATALOG, ''))).toEqual(keysOf(CATALOG))
    expect(keysOf(filterProviders(CATALOG, '   '))).toEqual(keysOf(CATALOG))
  })

  it('finds Mistral from a prefix', () => {
    expect(keysOf(filterProviders(CATALOG, 'mist'))).toEqual(['mistral'])
  })

  it('matches the provider key as well as the label', () => {
    expect(keysOf(filterProviders(CATALOG, 'bedrock'))).toEqual(['amazon-bedrock'])
    expect(keysOf(filterProviders(CATALOG, 'zai'))).toEqual(['zai'])
  })

  it('ignores case, spaces, dots and hyphens on both sides', () => {
    expect(keysOf(filterProviders(CATALOG, 'z.ai'))).toEqual(['zai'])
    expect(keysOf(filterProviders(CATALOG, 'OpenAI EU'))).toEqual(['openai-eu'])
    expect(keysOf(filterProviders(CATALOG, 'amazon bedrock'))).toEqual(['amazon-bedrock'])
  })

  it('ranks label prefixes above substring hits', () => {
    // 'open' prefixes OpenAI / Openai Eu / OpenRouter; 'amazon-bedrock' is not a hit at all.
    expect(keysOf(filterProviders(CATALOG, 'open'))).toEqual(['openai', 'openai-eu', 'openrouter'])
  })

  it('keeps catalog priority order within an equal rank', () => {
    // Both are pure substring hits on "ai"; anthropic outranks google only via catalog order.
    const result = keysOf(filterProviders(CATALOG, 'ai'))
    expect(result.indexOf('google')).toBeLessThan(result.indexOf('openai'))
  })

  it('returns nothing when the query matches no provider', () => {
    expect(filterProviders(CATALOG, 'definitely-not-a-provider')).toEqual([])
  })

  it('does not mutate the input catalog', () => {
    const snapshot = keysOf(CATALOG)
    filterProviders(CATALOG, 'open')
    expect(keysOf(CATALOG)).toEqual(snapshot)
  })
})

describe('moveIndex / clampIndex', () => {
  it('wraps around both ends', () => {
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(1, 1, 3)).toBe(2)
  })

  it('stays at 0 for an empty list', () => {
    expect(moveIndex(0, 1, 0)).toBe(0)
    expect(clampIndex(4, 0)).toBe(0)
  })

  it('recovers from an out-of-range cursor after the list shrinks', () => {
    expect(clampIndex(9, 3)).toBe(2)
    expect(clampIndex(-2, 3)).toBe(0)
    expect(moveIndex(9, 1, 3)).toBe(0)
  })
})

describe('the Other entry', () => {
  it('reuses the ApiKeyInput "custom" preset key so it can preselect downstream', () => {
    expect(OTHER_PROVIDER_KEY).toBe('custom')
    expect(OTHER_PROVIDER_ENTRY.key).toBe('custom')
    expect(OTHER_PROVIDER_ENTRY.label).toContain('OpenAI-compatible')
  })
})

describe('resolveProviderIconSlug', () => {
  it('maps known providers to bundled brand icons', () => {
    expect(resolveProviderIconSlug('anthropic')).toBe('claude')
    expect(resolveProviderIconSlug('amazon-bedrock')).toBe('aws')
    expect(resolveProviderIconSlug('vercel-ai-gateway')).toBe('vercel')
    expect(resolveProviderIconSlug('azure-openai-responses')).toBe('azure')
    expect(resolveProviderIconSlug('openai-eu')).toBe('openai')
    expect(resolveProviderIconSlug('minimax-cn')).toBe('minimax')
  })

  it('returns null for providers with no icon so the caller draws a monogram', () => {
    expect(resolveProviderIconSlug('deepseek')).toBeNull()
    expect(resolveProviderIconSlug('cerebras')).toBeNull()
  })
})

describe('providerMonogram', () => {
  it('uses the first alphanumeric character, uppercased', () => {
    expect(providerMonogram('DeepSeek')).toBe('D')
    expect(providerMonogram('z.ai (GLM)')).toBe('Z')
    expect(providerMonogram('  groq')).toBe('G')
  })

  it('falls back to ? for an unusable label', () => {
    expect(providerMonogram('—')).toBe('?')
  })
})
