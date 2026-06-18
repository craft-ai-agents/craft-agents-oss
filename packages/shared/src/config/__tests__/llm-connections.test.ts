import { describe, it, expect } from 'bun:test'
import '../../../tests/setup/register-pi-model-resolver.ts'
import {
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
  isCompatProvider,
  isAnthropicProvider,
  isPiProvider,
  toBedrockNativeId,
  fromBedrockNativeId,
  normalizeBedrockModelId,
  deriveBedrockRegionPrefix,
} from '../llm-connections'
import { ANTHROPIC_MODELS, getModelDisplayName, getModelContextWindow, getModelShortName, isClaudeModel } from '../models'

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

  it('pi with piAuthProvider returns filtered models without deprecated Opus 4.6', () => {
    const models = getDefaultModelsForConnection('pi', 'anthropic')
    expect(models.length).toBeGreaterThan(0)
    const ids = models.map(m => typeof m === 'string' ? m : m.id)
    expect(ids).not.toContain('pi/claude-opus-4-6')
    // All should have pi/ prefix in their id
    for (const id of ids) {
      expect(id.startsWith('pi/')).toBe(true)
    }
  })

  it('pi without piAuthProvider returns all Pi models', () => {
    const models = getDefaultModelsForConnection('pi')
    expect(models.length).toBeGreaterThan(0)
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

  it('Pi deepseek default is in its own model list', () => {
    const defaultModel = getDefaultModelForConnection('pi', 'deepseek')
    const models = getDefaultModelsForConnection('pi', 'deepseek')
    const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
    expect(modelIds).toContain(defaultModel)
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

// ============================================================
// Bedrock model ID mapping
// ============================================================

describe('toBedrockNativeId', () => {
  it('maps bare Anthropic IDs to US inference profile IDs', () => {
    expect(toBedrockNativeId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
    expect(toBedrockNativeId('claude-haiku-4-5-20251001')).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0')
  })

  it('keeps Opus 4.7 mapped and selectable', () => {
    expect(toBedrockNativeId('claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7')
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  it('normalizes deprecated Opus IDs to Opus 4.8 before mapping', () => {
    expect(toBedrockNativeId('claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('anthropic.claude-opus-4-6-v1')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('eu.anthropic.claude-opus-4-6-v1')).toBe('eu.anthropic.claude-opus-4-8')
  })

  it('maps base Bedrock IDs to US inference profile IDs', () => {
    expect(toBedrockNativeId('anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('anthropic.claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
  })

  it('passes through already US-prefixed IDs', () => {
    expect(toBedrockNativeId('us.anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('passes through unknown IDs', () => {
    expect(toBedrockNativeId('some-custom-model')).toBe('some-custom-model')
    expect(toBedrockNativeId('gpt-5')).toBe('gpt-5')
  })

  it('maps to EU inference profiles when regionPrefix is eu', () => {
    expect(toBedrockNativeId('claude-opus-4-8', 'eu')).toBe('eu.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-sonnet-4-6', 'eu')).toBe('eu.anthropic.claude-sonnet-4-6')
  })

  it('defaults to US when regionPrefix is omitted or us', () => {
    expect(toBedrockNativeId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-opus-4-8', 'us')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('passes through unknown IDs regardless of regionPrefix', () => {
    expect(toBedrockNativeId('some-custom-model', 'eu')).toBe('some-custom-model')
  })
})

describe('deriveBedrockRegionPrefix', () => {
  it('returns us for US regions', () => {
    expect(deriveBedrockRegionPrefix('us-east-1')).toBe('us')
    expect(deriveBedrockRegionPrefix('us-west-2')).toBe('us')
  })

  it('returns eu for EU regions', () => {
    expect(deriveBedrockRegionPrefix('eu-west-1')).toBe('eu')
    expect(deriveBedrockRegionPrefix('eu-central-1')).toBe('eu')
  })

  it('returns us for other regions (fallback)', () => {
    expect(deriveBedrockRegionPrefix('ap-southeast-1')).toBe('us')
    expect(deriveBedrockRegionPrefix('me-south-1')).toBe('us')
  })

  it('returns us when undefined', () => {
    expect(deriveBedrockRegionPrefix(undefined)).toBe('us')
  })
})

describe('Bedrock preferred defaults ordering', () => {
  it('sorts preferred models first for amazon-bedrock', () => {
    const models = getDefaultModelsForConnection('pi', 'amazon-bedrock')
    if (models.length === 0) return // Pi resolver not registered in test env
    const firstId = typeof models[0] === 'string' ? models[0] : (models[0] as any).id
    // First model should be a preferred model (claude-opus or claude-sonnet), not a deprecated one
    expect(firstId).toMatch(/claude-(opus|sonnet)-4/)
  })
})

describe('fromBedrockNativeId', () => {
  it('maps US inference profile IDs back to bare Anthropic', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(fromBedrockNativeId('us.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(fromBedrockNativeId('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('claude-haiku-4-5-20251001')
  })

  it('maps EU/Global inference profile IDs back to bare', () => {
    expect(fromBedrockNativeId('eu.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('maps base Bedrock IDs back to bare', () => {
    expect(fromBedrockNativeId('anthropic.claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('passes through bare IDs', () => {
    expect(fromBedrockNativeId('claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('normalizes deprecated Opus native IDs back to Opus 4.8', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-6-v1')).toBe('claude-opus-4-8')
  })
})

describe('normalizeBedrockModelId', () => {
  it('strips pi/ prefix and maps to US inference profile', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
    expect(normalizeBedrockModelId('pi/claude-sonnet-4-6')).toBe('us.anthropic.claude-sonnet-4-6')
  })

  it('maps bare IDs to US inference profile', () => {
    expect(normalizeBedrockModelId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('normalizes deprecated Opus IDs to Opus 4.8 native IDs', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-8')
    expect(normalizeBedrockModelId('claude-opus-4-6', 'eu')).toBe('eu.anthropic.claude-opus-4-8')
  })

  it('maps base Bedrock IDs to US inference profile', () => {
    expect(normalizeBedrockModelId('anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('is idempotent for already US-prefixed IDs', () => {
    expect(normalizeBedrockModelId('us.anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8')
  })

  it('handles empty/undefined', () => {
    expect(normalizeBedrockModelId(undefined)).toBe('')
    expect(normalizeBedrockModelId('')).toBe('')
  })

  it('respects regionPrefix for EU', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-8', 'eu')).toBe('eu.anthropic.claude-opus-4-8')
    expect(normalizeBedrockModelId('claude-sonnet-4-6', 'eu')).toBe('eu.anthropic.claude-sonnet-4-6')
  })
})

// ============================================================
// Bedrock-aware display and lookup
// ============================================================

describe('Bedrock-native model display', () => {
  it('getModelDisplayName resolves US inference profile IDs', () => {
    expect(getModelDisplayName('us.anthropic.claude-opus-4-8')).toBe('Opus 4.8')
    expect(getModelDisplayName('us.anthropic.claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(getModelDisplayName('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5')
  })

  it('getModelDisplayName resolves EU/base Bedrock IDs', () => {
    expect(getModelDisplayName('eu.anthropic.claude-opus-4-8')).toBe('Opus 4.8')
    expect(getModelDisplayName('anthropic.claude-opus-4-8')).toBe('Opus 4.8')
  })

  it('getModelShortName resolves Bedrock IDs', () => {
    expect(getModelShortName('us.anthropic.claude-opus-4-8')).toBe('Opus')
    expect(getModelShortName('us.anthropic.claude-sonnet-4-6')).toBe('Sonnet')
  })

  it('getModelContextWindow resolves Bedrock IDs', () => {
    expect(getModelContextWindow('us.anthropic.claude-opus-4-8')).toBe(1_000_000)
    expect(getModelContextWindow('us.anthropic.claude-sonnet-4-6')).toBe(200_000)
  })

  it('isClaudeModel recognizes Bedrock IDs', () => {
    expect(isClaudeModel('us.anthropic.claude-opus-4-8')).toBe(true)
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true)
    expect(isClaudeModel('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true)
  })
})

// ============================================================
// Claude Fable 5 registration (Claude Agent SDK path)
// ============================================================

describe('Claude Fable 5', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const fable = ANTHROPIC_MODELS.find(m => m.id === 'claude-fable-5')
    expect(fable).toBeDefined()
    expect(fable!.provider).toBe('anthropic')
    expect(fable!.name).toBe('Fable 5')
    expect(fable!.shortName).toBe('Fable')
    expect(fable!.contextWindow).toBe(1_000_000)
    expect(fable!.descriptionKey).toBe('model.fableDesc')
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-fable-5')).toBe('Fable 5')
    expect(getModelShortName('claude-fable-5')).toBe('Fable')
    expect(getModelContextWindow('claude-fable-5')).toBe(1_000_000)
    expect(isClaudeModel('claude-fable-5')).toBe(true)
  })

  it('does NOT become the Anthropic default (Opus 4.8 stays default)', () => {
    expect(getDefaultModelForConnection('anthropic')).toBe('claude-opus-4-8')
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-fable-5')).toBe('us.anthropic.claude-fable-5')
    expect(toBedrockNativeId('claude-fable-5', 'eu')).toBe('eu.anthropic.claude-fable-5')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('global.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(fromBedrockNativeId('anthropic.claude-fable-5')).toBe('claude-fable-5')
    // Bedrock-native id resolves to display metadata too
    expect(getModelDisplayName('us.anthropic.claude-fable-5')).toBe('Fable 5')
  })
})
