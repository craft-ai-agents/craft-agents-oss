import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS,
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
} from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model IDs', () => {
    expect(stripPiPrefix('pi/my-model')).toBe('my-model')
    expect(normalizeCustomEndpointModelEntry('pi/my-model')).toEqual({ id: 'my-model' })
  })

  it('preserves per-model image support when enabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves explicit per-model image support when disabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/text-only-model',
      supportsImages: false,
    })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })
  })
})

describe('buildCustomEndpointModelDef', () => {
  it('defaults custom endpoint models to text-only input', () => {
    const model = buildCustomEndpointModelDef('my-model')
    expect(model.input).toEqual(['text'])
  })

  it('enables image input when the connection explicitly opts in', () => {
    const model = buildCustomEndpointModelDef('vision-model', { supportsImages: true })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets per-model overrides disable image input even when the connection default is enabled', () => {
    const model = buildCustomEndpointModelDef('text-only-model', { supportsImages: true }, { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })

  it('lets per-model overrides enable image input and custom context window', () => {
    const model = buildCustomEndpointModelDef('vision-model', undefined, { supportsImages: true, contextWindow: 262_144 })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(262_144)
  })

  // Regression: craft-agents-oss#1100 — Pi caps compaction summaries at model.maxTokens,
  // so a fixed 8192 made long-session compaction fail on custom endpoints.
  it('caps output at the conservative default when the connection sets no maxTokens', () => {
    expect(buildCustomEndpointModelDef('my-model').maxTokens).toBe(DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS)
  })

  it('honors the connection-level maxTokens override', () => {
    expect(buildCustomEndpointModelDef('my-model', { maxTokens: 32_768 }).maxTokens).toBe(32_768)
  })

  it('ignores maxTokens values that are not positive integers', () => {
    for (const maxTokens of [0, -1, 1.5, Number.NaN, '32768' as unknown as number]) {
      expect(buildCustomEndpointModelDef('my-model', { maxTokens }).maxTokens).toBe(DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS)
    }
  })

  // Regression: craft-agents-oss#1022 — strict OpenAI-compatible gateways 400 on the
  // `store` param. supportsStore:false makes the pi-ai driver omit it entirely.
  it('disables the store param for openai-completions endpoints', () => {
    const model = buildCustomEndpointModelDef('gpt-model', undefined, undefined, 'openai-completions')
    expect((model as { compat?: { supportsStore?: boolean } }).compat).toEqual({ supportsStore: false })
  })

  it('does not set store compat for anthropic-messages endpoints', () => {
    const model = buildCustomEndpointModelDef('claude-model', undefined, undefined, 'anthropic-messages')
    expect((model as { compat?: unknown }).compat).toBeUndefined()
  })

  it('does not set store compat when the api is unspecified', () => {
    const model = buildCustomEndpointModelDef('some-model')
    expect((model as { compat?: unknown }).compat).toBeUndefined()
  })
})
