import { describe, it, expect } from 'bun:test'
import {
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
  isCompatProvider,
  isAnthropicProvider,
  isPiProvider,
} from '../llm-connections'
import { ANTHROPIC_MODELS } from '../models'

// ============================================================
// getDefaultModelsForConnection
// ============================================================

describe('getDefaultModelsForConnection', () => {
  it('anthropic returns ANTHROPIC_MODELS (ModelDefinition[])', () => {
    const models = getDefaultModelsForConnection('anthropic')
    expect(models).toEqual(ANTHROPIC_MODELS)
    expect(models.length).toBeGreaterThan(0)
    // Verify they are ModelDefinition objects, not strings
    const first = models[0]!
    expect(typeof first).toBe('object')
    expect(typeof (first as any).id).toBe('string')
  })

  it('bedrock returns same models as anthropic', () => {
    expect(getDefaultModelsForConnection('bedrock')).toEqual(ANTHROPIC_MODELS)
  })

  it('vertex returns same models as anthropic', () => {
    expect(getDefaultModelsForConnection('vertex')).toEqual(ANTHROPIC_MODELS)
  })

  it('pi with piAuthProvider returns filtered models', () => {
    const models = getDefaultModelsForConnection('pi', 'anthropic')
    expect(models.length).toBeGreaterThan(0)
    // All should have pi/ prefix in their id
    for (const m of models) {
      const id = typeof m === 'string' ? m : m.id
      expect(id.startsWith('pi/')).toBe(true)
    }
  })

  it('pi without piAuthProvider returns all Pi models', () => {
    const models = getDefaultModelsForConnection('pi')
    expect(models.length).toBeGreaterThan(0)
  })

  it('anthropic_compat returns empty list (dynamic provider)', () => {
    const models = getDefaultModelsForConnection('anthropic_compat')
    expect(models).toEqual([])
  })
})

// ============================================================
// getDefaultModelForConnection
// ============================================================

describe('getDefaultModelForConnection', () => {
  it('returns first model ID for anthropic', () => {
    const modelId = getDefaultModelForConnection('anthropic')
    expect(typeof modelId).toBe('string')
    expect(modelId.length).toBeGreaterThan(0)
    // Should match the first ANTHROPIC_MODELS entry
    expect(modelId).toBe(ANTHROPIC_MODELS[0]!.id)
  })

  // Regression: Pi 'anthropic' default must be present in its own model list
  it('regression: Pi anthropic default is in its own model list', () => {
    const defaultModel = getDefaultModelForConnection('pi', 'anthropic')
    const models = getDefaultModelsForConnection('pi', 'anthropic')
    const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
    expect(modelIds).toContain(defaultModel)
  })

  it('Pi openai default is in its own model list', () => {
    const defaultModel = getDefaultModelForConnection('pi', 'openai')
    const models = getDefaultModelsForConnection('pi', 'openai')
    const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
    expect(modelIds).toContain(defaultModel)
  })

  it('returns empty string for anthropic_compat (dynamic provider)', () => {
    const defaultModel = getDefaultModelForConnection('anthropic_compat')
    expect(defaultModel).toBe('')
  })

  it('returns empty string for pi_compat (dynamic provider)', () => {
    const defaultModel = getDefaultModelForConnection('pi_compat')
    expect(defaultModel).toBe('')
  })
})

// ============================================================
// Provider type guards
// ============================================================

describe('isCompatProvider', () => {
  it('returns true for anthropic_compat', () => {
    expect(isCompatProvider('anthropic_compat')).toBe(true)
  })

  it('returns true for pi_compat', () => {
    expect(isCompatProvider('pi_compat')).toBe(true)
  })

  it('returns false for anthropic', () => {
    expect(isCompatProvider('anthropic')).toBe(false)
  })

  it('returns false for pi', () => {
    expect(isCompatProvider('pi')).toBe(false)
  })
})

describe('isAnthropicProvider', () => {
  it('returns true for anthropic', () => {
    expect(isAnthropicProvider('anthropic')).toBe(true)
  })

  it('returns true for anthropic_compat', () => {
    expect(isAnthropicProvider('anthropic_compat')).toBe(true)
  })

  it('returns true for bedrock', () => {
    expect(isAnthropicProvider('bedrock')).toBe(true)
  })

  it('returns true for vertex', () => {
    expect(isAnthropicProvider('vertex')).toBe(true)
  })

  it('returns false for pi', () => {
    expect(isAnthropicProvider('pi')).toBe(false)
  })
})

describe('isPiProvider', () => {
  it('returns true for pi', () => {
    expect(isPiProvider('pi')).toBe(true)
  })

  it('returns true for pi_compat', () => {
    expect(isPiProvider('pi_compat')).toBe(true)
  })

  it('returns false for anthropic', () => {
    expect(isPiProvider('anthropic')).toBe(false)
  })
})
