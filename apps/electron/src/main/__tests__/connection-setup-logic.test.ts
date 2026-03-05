import { describe, it, expect } from 'bun:test'
import {
  parseTestConnectionError,
  createBuiltInConnection,
  validateModelList,
  validateSetupTestInput,
  BUILT_IN_CONNECTION_TEMPLATES,
} from '@craft-agent/server-core/domain'
import type { ModelDefinition } from '@craft-agent/shared/config/models'

// ============================================================
// validateModelList
// ============================================================

describe('validateModelList', () => {
  it('accepts a string list with a matching default', () => {
    const result = validateModelList(['model-a', 'model-b', 'model-c'], 'model-b')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts ModelDefinition[] with a matching default', () => {
    const models: ModelDefinition[] = [
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', shortName: 'Sonnet', description: '', provider: 'anthropic', contextWindow: 200000 },
      { id: 'claude-haiku-4-5', name: 'Haiku 4.5', shortName: 'Haiku', description: '', provider: 'anthropic', contextWindow: 200000 },
    ]
    const result = validateModelList(models, 'claude-haiku-4-5')
    expect(result.valid).toBe(true)
  })

  // Regression: Pi ModelDefinition[] with valid default was falsely rejected
  // because the old code used Array.includes() to compare strings against objects
  it('regression: Pi ModelDefinition[] with valid default is accepted', () => {
    const piModels: ModelDefinition[] = [
      { id: 'pi/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', shortName: 'Sonnet', description: '', provider: 'pi', contextWindow: 200000 },
      { id: 'pi/claude-haiku-4-5', name: 'Claude Haiku 4.5', shortName: 'Haiku', description: '', provider: 'pi', contextWindow: 200000 },
    ]
    const result = validateModelList(piModels, 'pi/claude-sonnet-4-6')
    expect(result.valid).toBe(true)
  })

  it('rejects when default model is not in the list', () => {
    const result = validateModelList(['model-a', 'model-b'], 'model-c')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('model-c')
    expect(result.error).toContain('not in the provided model list')
  })

  it('auto-selects first model when default is undefined', () => {
    const result = validateModelList(['first-model', 'second-model'], undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('first-model')
  })

  it('auto-selects first ModelDefinition.id when default is undefined', () => {
    const models: ModelDefinition[] = [
      { id: 'def-first', name: 'First', shortName: 'F', description: '', provider: 'anthropic', contextWindow: 200000 },
    ]
    const result = validateModelList(models, undefined)
    expect(result.valid).toBe(true)
    expect(result.resolvedDefaultModel).toBe('def-first')
  })

  it('returns valid for empty model list', () => {
    const result = validateModelList([], 'anything')
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// createBuiltInConnection
// ============================================================

describe('createBuiltInConnection', () => {
  it('creates anthropic-api with correct defaults', () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.slug).toBe('anthropic-api')
    expect(conn.providerType).toBe('anthropic')
    expect(conn.authType).toBe('api_key')
    expect(conn.name).toBe('Anthropic (API Key)')
  })

  it('creates anthropic-api with baseUrl as compat provider', () => {
    const conn = createBuiltInConnection('anthropic-api', 'https://custom.endpoint.com')
    expect(conn.providerType).toBe('anthropic_compat')
    expect(conn.authType).toBe('api_key_with_endpoint')
    expect(conn.name).toBe('Custom Anthropic-Compatible')
  })

  it('creates claude-max with oauth', () => {
    const conn = createBuiltInConnection('claude-max')
    expect(conn.providerType).toBe('anthropic')
    expect(conn.authType).toBe('oauth')
  })

  it('creates pi-api-key with pi provider', () => {
    const conn = createBuiltInConnection('pi-api-key')
    expect(conn.providerType).toBe('pi')
    expect(conn.authType).toBe('api_key')
    expect(conn.modelSelectionMode).toBe('automaticallySyncedFromProvider')
  })

  it('handles numeric suffix slugs (anthropic-api-2) by deriving from base template', () => {
    const conn = createBuiltInConnection('anthropic-api-2')
    expect(conn.slug).toBe('anthropic-api-2')
    expect(conn.providerType).toBe('anthropic')
    expect(conn.name).toBe('Anthropic (API Key) 2')
  })

  it('handles numeric suffix slugs (pi-api-key-3)', () => {
    const conn = createBuiltInConnection('pi-api-key-3')
    expect(conn.slug).toBe('pi-api-key-3')
    expect(conn.name).toContain('3')
  })

  it('throws for unknown slug', () => {
    expect(() => createBuiltInConnection('unknown-provider')).toThrow('Unknown built-in connection slug')
  })

  it('always sets createdAt', () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.createdAt).toBeGreaterThan(0)
  })

  it('sets piAuthProvider for chatgpt-plus', () => {
    const conn = createBuiltInConnection('chatgpt-plus')
    expect(conn.piAuthProvider).toBe('openai-codex')
  })

  it('sets piAuthProvider for github-copilot', () => {
    const conn = createBuiltInConnection('github-copilot')
    expect(conn.piAuthProvider).toBe('github-copilot')
  })
})

// ============================================================
// validateSetupTestInput
// ============================================================

describe('validateSetupTestInput', () => {
  it('rejects pi custom endpoint without provider preset', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('requires selecting a provider preset')
    }
  })

  it('accepts pi custom endpoint when provider preset is set', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://openrouter.ai/api/v1',
      piAuthProvider: 'openrouter',
    })
    expect(result.valid).toBe(true)
  })

  it('accepts anthropic custom endpoint without piAuthProvider', () => {
    const result = validateSetupTestInput({
      provider: 'anthropic',
      baseUrl: 'https://custom.endpoint.com',
    })
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// parseTestConnectionError
// ============================================================

describe('parseTestConnectionError', () => {
  it('maps ECONNREFUSED to friendly message', () => {
    const result = parseTestConnectionError('connect ECONNREFUSED 127.0.0.1:8080')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps ENOTFOUND to friendly message', () => {
    const result = parseTestConnectionError('getaddrinfo ENOTFOUND api.example.com')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps fetch failed to friendly message', () => {
    const result = parseTestConnectionError('TypeError: fetch failed')
    expect(result).toContain('Cannot connect to API server')
  })

  it('maps 401 to invalid API key', () => {
    const result = parseTestConnectionError('Request failed with status 401')
    expect(result).toBe('Invalid API key')
  })

  it('maps unauthorized to invalid API key', () => {
    const result = parseTestConnectionError('Unauthorized access')
    expect(result).toBe('Invalid API key')
  })

  it('maps 404+model to model message', () => {
    const result = parseTestConnectionError('404: model not found')
    expect(result).toContain('Model not found')
  })

  it('maps 404 without model to endpoint message', () => {
    const result = parseTestConnectionError('404 Not Found')
    expect(result).toContain('API endpoint not found')
  })

  it('maps 429 to rate limit', () => {
    const result = parseTestConnectionError('429 Too Many Requests')
    expect(result).toContain('Rate limit')
  })

  it('maps 403 to permission error', () => {
    const result = parseTestConnectionError('403 Forbidden')
    expect(result).toContain('does not have permission')
  })

  it('maps provider mismatch API key errors to actionable guidance', () => {
    const result = parseTestConnectionError('No API key found for huggingface. Use /login or set an API key environment variable.')
    expect(result).toContain('Provider mismatch during setup')
  })

  it('passes through unknown errors truncated to 300 chars', () => {
    const longMsg = 'x'.repeat(500)
    const result = parseTestConnectionError(longMsg)
    expect(result.length).toBe(300)
  })

  it('passes through short unknown errors as-is', () => {
    const result = parseTestConnectionError('Something went wrong')
    expect(result).toBe('Something went wrong')
  })
})
