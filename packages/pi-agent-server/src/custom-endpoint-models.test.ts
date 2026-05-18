import { describe, expect, it } from 'bun:test'
import { buildCustomEndpointModelDef, normalizeCustomEndpointModelEntry } from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model ids', () => {
    expect(normalizeCustomEndpointModelEntry('pi/local-model')).toEqual({ id: 'local-model' })
  })

  it('preserves image support when enabled per model', () => {
    expect(normalizeCustomEndpointModelEntry({ id: 'vision-model', supportsImages: true })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves image support when disabled per model', () => {
    expect(normalizeCustomEndpointModelEntry({ id: 'text-only-model', supportsImages: false })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support overrides together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/custom-model',
      contextWindow: 262_144,
      supportsImages: false,
    })).toEqual({
      id: 'custom-model',
      contextWindow: 262_144,
      supportsImages: false,
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
})
