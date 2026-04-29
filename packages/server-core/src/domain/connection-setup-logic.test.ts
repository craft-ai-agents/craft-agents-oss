import { describe, expect, it } from 'bun:test'
import {
  validateSetupTestInput,
  isLoopbackBaseUrl,
  resolveCompatPiAuthProvider,
  setupTestRequiresApiKey,
} from './connection-setup-logic'

describe('validateSetupTestInput', () => {
  it('rejects pi custom endpoint tests without piAuthProvider', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('requires selecting a provider preset')
    }
  })

  it('allows pi custom endpoint tests with piAuthProvider', () => {
    expect(validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
      piAuthProvider: 'openai',
    })).toEqual({ valid: true })
  })
})

describe('setup test API key requirements', () => {
  it('detects loopback base URLs', () => {
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('requires API key for non-loopback setup tests', () => {
    expect(setupTestRequiresApiKey('https://api.anthropic.com')).toBe(true)
    expect(setupTestRequiresApiKey('https://example.com/v1')).toBe(true)
  })

  it('allows keyless setup tests for loopback endpoints', () => {
    expect(setupTestRequiresApiKey('http://localhost:11434/v1')).toBe(false)
    expect(setupTestRequiresApiKey('http://127.0.0.1:11434/v1')).toBe(false)
  })
})

describe('resolveCompatPiAuthProvider', () => {
  it('keeps provider hint for authenticated local OpenAI-compatible endpoints', () => {
    expect(resolveCompatPiAuthProvider({
      authType: 'api_key_with_endpoint',
      customEndpointApi: 'openai-completions',
    })).toBe('openai')
  })

  it('keeps provider hint for authenticated local Anthropic-compatible endpoints', () => {
    expect(resolveCompatPiAuthProvider({
      authType: 'api_key_with_endpoint',
      customEndpointApi: 'anthropic-messages',
    })).toBe('anthropic')
  })

  it('leaves keyless local endpoints generic', () => {
    expect(resolveCompatPiAuthProvider({
      authType: 'none',
      customEndpointApi: 'openai-completions',
    })).toBeUndefined()
  })
})
