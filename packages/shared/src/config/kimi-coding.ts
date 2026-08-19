export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding'
export const KIMI_CODING_HEADERS = { 'User-Agent': 'KimiCLI/1.5' } as const

export interface KimiCodingCatalogModel {
  id: string
  name: string
  reasoning: boolean
  thinkingLevelMap?: Partial<Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>>
  input: Array<'text' | 'image'>
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  contextWindow: number
  maxTokens: number
  compat?: {
    allowEmptySignature?: boolean
    forceAdaptiveThinking?: boolean
  }
}

/**
 * Current Kimi Code model IDs.
 *
 * Keep this small catalog in Craft until the pinned Pi SDK includes Kimi K3.
 * The request protocol and endpoint remain the existing `kimi-coding`
 * Anthropic-compatible provider.
 */
export const KIMI_CODING_MODELS: KimiCodingCatalogModel[] = [
  {
    id: 'k3',
    name: 'Kimi K3',
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    },
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    compat: {
      allowEmptySignature: true,
      forceAdaptiveThinking: true,
    },
  },
  {
    id: 'kimi-for-coding',
    name: 'Kimi K2.7 Code',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 32_768,
    compat: {
      allowEmptySignature: true,
      forceAdaptiveThinking: true,
    },
  },
  {
    id: 'kimi-for-coding-highspeed',
    name: 'Kimi For Coding HighSpeed',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 32_768,
    compat: {
      forceAdaptiveThinking: true,
    },
  },
]
