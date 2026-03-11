import { describe, expect, it } from 'bun:test'
import {
  validateSetupTestInput,
  isLoopbackBaseUrl,
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
