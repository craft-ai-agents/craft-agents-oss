import { describe, expect, it } from 'bun:test'
import {
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
} from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  buildKimiCodingProviderModels,
  registerKimiCodingModels,
} from './kimi-coding-models.ts'

const LEGACY_MODEL = {
  id: 'kimi-k2-thinking',
  name: 'Kimi K2 Thinking',
  api: 'anthropic-messages',
  provider: 'kimi-coding',
  baseUrl: 'https://api.kimi.com/coding',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262_144,
  maxTokens: 32_768,
} as Model<Api>

describe('buildKimiCodingProviderModels', () => {
  it('adds K3 and current Kimi models while preserving legacy IDs', () => {
    const models = buildKimiCodingProviderModels([LEGACY_MODEL])
    const ids = models.map(model => model.id)

    expect(ids).toContain('kimi-k2-thinking')
    expect(ids).toContain('k3')
    expect(ids).toContain('kimi-for-coding')
    expect(ids).toContain('kimi-for-coding-highspeed')
  })

  it('uses the Kimi Anthropic endpoint and K3 capability metadata', () => {
    const k3 = buildKimiCodingProviderModels([]).find(model => model.id === 'k3')

    expect(k3?.api).toBe('anthropic-messages')
    expect(k3?.baseUrl).toBe('https://api.kimi.com/coding')
    expect(k3?.contextWindow).toBe(1_048_576)
    expect(k3?.maxTokens).toBe(131_072)
    expect(k3?.input).toEqual(['text', 'image'])
    expect(k3?.reasoning).toBe(true)
  })

  it('registers K3 in the pinned Pi runtime with Kimi API-key auth', async () => {
    const authStorage = PiAuthStorage.inMemory()
    authStorage.set('kimi-coding', { type: 'api_key', key: 'test-kimi-key' })
    const registry = PiModelRegistry.inMemory(authStorage)

    registerKimiCodingModels(registry, 'test-kimi-key')

    const k3 = registry.find('kimi-coding', 'k3')
    expect(k3?.api).toBe('anthropic-messages')
    expect(k3?.baseUrl).toBe('https://api.kimi.com/coding')

    const auth = await registry.getApiKeyAndHeaders(k3!)
    expect(auth).toMatchObject({
      ok: true,
      apiKey: 'test-kimi-key',
      headers: { 'User-Agent': 'KimiCLI/1.5' },
    })
  })
})
