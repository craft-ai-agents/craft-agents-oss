import { describe, expect, it } from 'bun:test'
import { modelSupportsImages, type LlmConnection } from '../llm-connections.ts'

const BASE_COMPAT: LlmConnection = {
  slug: 'custom',
  name: 'Custom',
  providerType: 'pi_compat',
  authType: 'api_key_with_endpoint',
  baseUrl: 'http://localhost:8080',
  customEndpoint: { api: 'openai-completions' },
  createdAt: 1,
}

describe('modelSupportsImages — pi_compat precedence', () => {
  it('returns true when per-model supportsImages: true (override wins over connection default)', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: false },
      models: [{ id: 'vision', supportsImages: true } as never],
    }
    expect(modelSupportsImages(conn, 'vision')).toBe(true)
  })

  it('returns false when per-model supportsImages: false (override wins over connection default true)', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: [{ id: 'text-only', supportsImages: false } as never],
    }
    expect(modelSupportsImages(conn, 'text-only')).toBe(false)
  })

  it('falls back to connection-level supportsImages when no per-model override', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: ['plain'],
    }
    expect(modelSupportsImages(conn, 'plain')).toBe(true)
  })

  it('returns false when neither per-model override nor connection default is set', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['plain'] }
    expect(modelSupportsImages(conn, 'plain')).toBe(false)
  })

  it('returns false when the model is not in models[] (matches Pi default)', () => {
    const conn: LlmConnection = { ...BASE_COMPAT, models: ['plain'] }
    expect(modelSupportsImages(conn, 'unknown')).toBe(false)
  })

  it('returns connection default when the model is missing but connection default is true', () => {
    const conn: LlmConnection = {
      ...BASE_COMPAT,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: ['plain'],
    }
    expect(modelSupportsImages(conn, 'unknown')).toBe(true)
  })
})

describe('modelSupportsImages — non-pi_compat fallthrough', () => {
  it('returns true for anthropic regardless of override (renderer does not gate built-in catalogs)', () => {
    const conn: LlmConnection = {
      slug: 'a', name: 'a', providerType: 'anthropic', authType: 'api_key',
      models: [{ id: 'claude-haiku', supportsImages: false } as never],
      createdAt: 1,
    }
    expect(modelSupportsImages(conn, 'claude-haiku')).toBe(true)
  })

  it('returns true for pi regardless of override', () => {
    const conn: LlmConnection = {
      slug: 'p', name: 'p', providerType: 'pi', authType: 'api_key',
      models: [{ id: 'gpt-x', supportsImages: false } as never],
      createdAt: 1,
    }
    expect(modelSupportsImages(conn, 'gpt-x')).toBe(true)
  })
})
