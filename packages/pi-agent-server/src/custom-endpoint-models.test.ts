import { describe, expect, it } from 'bun:test'
import {
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
})
