import { describe, it, expect } from 'bun:test'
import {
  resolveSlugForMethod,
  apiSetupMethodToConnectionSetup,
  BASE_SLUG_FOR_METHOD,
} from '../useOnboarding'
import type { ApiSetupMethod } from '@/components/onboarding'

// ============================================================
// resolveSlugForMethod
// ============================================================

describe('resolveSlugForMethod', () => {
  it('returns the base slug when it is available', () => {
    const slug = resolveSlugForMethod('anthropic_api_key', null, new Set())
    expect(slug).toBe('anthropic-api')
  })

  it('reuses editingSlug when editing an existing connection', () => {
    const slug = resolveSlugForMethod('anthropic_api_key', 'my-custom-slug', new Set(['anthropic-api']))
    expect(slug).toBe('my-custom-slug')
  })

  it('appends -2 when base slug is taken', () => {
    const slug = resolveSlugForMethod('anthropic_api_key', null, new Set(['anthropic-api']))
    expect(slug).toBe('anthropic-api-2')
  })

  it('appends -3 when both base and -2 are taken', () => {
    const slug = resolveSlugForMethod('anthropic_api_key', null, new Set(['anthropic-api', 'anthropic-api-2']))
    expect(slug).toBe('anthropic-api-3')
  })

  it('works for all setup methods', () => {
    const methods: ApiSetupMethod[] = [
      'anthropic_api_key', 'pi_api_key',
    ]
    for (const method of methods) {
      const slug = resolveSlugForMethod(method, null, new Set())
      expect(slug).toBe(BASE_SLUG_FOR_METHOD[method])
    }
  })
})

// ============================================================
// apiSetupMethodToConnectionSetup
// ============================================================

describe('apiSetupMethodToConnectionSetup', () => {
  it('anthropic_api_key includes credential, baseUrl, defaultModel, models', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'anthropic_api_key',
      { credential: 'sk-ant-test', baseUrl: 'https://custom.api', connectionDefaultModel: 'claude-sonnet-4-6', models: ['model-a'] },
      null,
      new Set(),
    )
    expect(setup.slug).toBe('anthropic-api')
    expect(setup.credential).toBe('sk-ant-test')
    expect(setup.baseUrl).toBe('https://custom.api')
    expect(setup.defaultModel).toBe('claude-sonnet-4-6')
    expect(setup.models).toEqual(['model-a'])
  })

  it('pi_api_key includes piAuthProvider and modelSelectionMode', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        credential: 'sk-pi',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
      },
      null,
      new Set(),
    )
    expect(setup.slug).toBe('pi-api-key')
    expect(setup.credential).toBe('sk-pi')
    expect(setup.piAuthProvider).toBe('anthropic')
    expect(setup.modelSelectionMode).toBe('userDefined3Tier')
  })

  it('uses editingSlug when editing', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'anthropic_api_key',
      { credential: 'sk-ant' },
      'existing-connection',
      new Set(['anthropic-api']),
    )
    expect(setup.slug).toBe('existing-connection')
  })

  it('generates unique slug when base is taken', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {},
      null,
      new Set(['pi-api-key']),
    )
    expect(setup.slug).toBe('pi-api-key-2')
  })
})
