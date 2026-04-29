import { describe, expect, it, mock } from 'bun:test'
import { resolvePiAuthForConnection, resolvePiAuthProviderFromRuntime } from '../pi-agent.ts'

describe('resolvePiAuthProviderFromRuntime', () => {
  it('infers OpenAI provider for authenticated custom OpenAI endpoints', () => {
    expect(resolvePiAuthProviderFromRuntime({
      customEndpoint: { api: 'openai-completions' },
    }, 'api_key_with_endpoint')).toBe('openai')
  })

  it('does not infer provider for keyless custom endpoints', () => {
    expect(resolvePiAuthProviderFromRuntime({
      customEndpoint: { api: 'openai-completions' },
    }, 'none')).toBeNull()
  })
})

describe('resolvePiAuthForConnection', () => {
  it('reuses stored API key for legacy localhost custom endpoint configs missing piAuthProvider', async () => {
    const getLlmApiKey = mock(async (slug: string) => slug === 'pi-api-key' ? 'sk-888' : null)
    const getLlmOAuth = mock(async () => null)
    const getLlmIamCredentials = mock(async () => null)

    const auth = await resolvePiAuthForConnection({
      authType: 'api_key_with_endpoint',
      connectionSlug: 'pi-api-key',
      credentialManager: {
        getLlmApiKey,
        getLlmOAuth,
        getLlmIamCredentials,
      },
      runtime: {
        customEndpoint: { api: 'openai-completions' },
      },
    })

    expect(auth).toEqual({
      provider: 'openai',
      credential: { type: 'api_key', key: 'sk-888' },
    })
    expect(getLlmApiKey).toHaveBeenCalledWith('pi-api-key')
    expect(getLlmOAuth).not.toHaveBeenCalled()
    expect(getLlmIamCredentials).not.toHaveBeenCalled()
  })

  it('keeps keyless localhost custom endpoints unauthenticated', async () => {
    const getLlmApiKey = mock(async () => 'should-not-be-read')
    const getLlmOAuth = mock(async () => null)
    const getLlmIamCredentials = mock(async () => null)

    const auth = await resolvePiAuthForConnection({
      authType: 'none',
      connectionSlug: 'local-model',
      credentialManager: {
        getLlmApiKey,
        getLlmOAuth,
        getLlmIamCredentials,
      },
      runtime: {
        customEndpoint: { api: 'openai-completions' },
      },
    })

    expect(auth).toBeNull()
    expect(getLlmApiKey).not.toHaveBeenCalled()
  })
})
