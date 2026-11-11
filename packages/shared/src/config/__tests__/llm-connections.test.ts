import { describe, it, expect } from 'bun:test'
import '../../../tests/setup/register-pi-model-resolver.ts'
import {
  getDefaultModelsForConnection,
  getDefaultModelForConnection,
  PI_PREFERRED_DEFAULTS,
  isCompatProvider,
  isAnthropicProvider,
  isPiProvider,
  toBedrockNativeId,
  fromBedrockNativeId,
  normalizeBedrockModelId,
  deriveBedrockRegionPrefix,
  getMiniModel,
} from '../llm-connections'
import { ANTHROPIC_MODELS, getModelDisplayName, getModelContextWindow, getModelShortName, isClaudeModel, normalizeDeprecatedModelId } from '../models'

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

  it('pi with piAuthProvider returns filtered models including Opus 4.6', () => {
    const models = getDefaultModelsForConnection('pi', 'anthropic')
    expect(models.length).toBeGreaterThan(0)
    const ids = models.map(m => typeof m === 'string' ? m : m.id)
    expect(ids).toContain('pi/claude-opus-4-6')
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

  it('Pi anthropic defaults to Opus 5.5 with Opus 5 and Opus 4.8 ranked directly below it', () => {
    const ids = getDefaultModelsForConnection('pi', 'anthropic').map(m => typeof m === 'string' ? m : m.id)
    expect(ids[0]).toBe('pi/claude-opus-5-5')
    expect(ids[1]).toBe('pi/claude-opus-5')
    expect(ids[2]).toBe('pi/claude-opus-4-8')
    expect(getDefaultModelForConnection('pi', 'anthropic')).toBe('pi/claude-opus-5-5')
  })

  // Regression: the Pi catalogs still list the retired Opus 4.5 snapshot. Its
  // deprecated ID normalizes to claude-opus-4-8 and used to inherit that rank,
  // so the stable sort made it the default for anthropic and amazon-bedrock.
  it('never ranks a deprecated catalog entry as the Pi default', () => {
    for (const provider of ['anthropic', 'amazon-bedrock'] as const) {
      const ids = getDefaultModelsForConnection('pi', provider).map(m => typeof m === 'string' ? m : m.id)
      const defaultModel = getDefaultModelForConnection('pi', provider)
      expect(defaultModel).toBe(ids[0]!)
      expect(normalizeDeprecatedModelId(defaultModel)).toBe(defaultModel)
      expect(defaultModel).toMatch(/claude-opus-5-5$/)
      // Deprecated entries stay listed, but only after every preferred model
      // (matched directly or via the Bedrock reverse mapping).
      const preferred = PI_PREFERRED_DEFAULTS[provider]!
      const isPreferred = (id: string) => {
        const bare = id.slice('pi/'.length)
        if (normalizeDeprecatedModelId(bare) !== bare) return false
        return [bare, fromBedrockNativeId(bare)].some(candidate =>
          preferred.some(p => candidate === p || candidate.startsWith(`${p}-`)))
      }
      const firstDeprecatedIndex = ids.findIndex(id => normalizeDeprecatedModelId(id) !== id)
      const lastPreferredIndex = ids.findLastIndex(isPreferred)
      expect(firstDeprecatedIndex).toBeGreaterThan(-1)
      expect(firstDeprecatedIndex).toBeGreaterThan(lastPreferredIndex)
    }
  })

  it('Pi openai default is in its own model list', () => {
    const defaultModel = getDefaultModelForConnection('pi', 'openai')
    const models = getDefaultModelsForConnection('pi', 'openai')
    const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
    expect(modelIds).toContain(defaultModel)
  })

  it('Pi openai and openai-codex default to GPT-6 Astra with GPT-6.1 Sol ranked next', () => {
    for (const provider of ['openai', 'openai-codex'] as const) {
      const ids = getDefaultModelsForConnection('pi', provider).map(m => typeof m === 'string' ? m : m.id)
      expect(ids[0]).toBe('pi/gpt-6-astra')
      expect(ids[1]).toBe('pi/gpt-6.1-sol')
      expect(ids[2]).toBe('pi/gpt-5.6-sol')
      expect(getDefaultModelForConnection('pi', provider)).toBe('pi/gpt-6-astra')
    }
  })

  it('Pi deepseek default is in its own model list', () => {
    const defaultModel = getDefaultModelForConnection('pi', 'deepseek')
    const models = getDefaultModelsForConnection('pi', 'deepseek')
    const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
    expect(modelIds).toContain(defaultModel)
  })

  it('Pi moonshotai defaults to Kimi K3 from its own model list', () => {
    for (const provider of ['moonshotai', 'moonshotai-cn'] as const) {
      const defaultModel = getDefaultModelForConnection('pi', provider)
      expect(defaultModel).toBe('pi/kimi-k3')
      const models = getDefaultModelsForConnection('pi', provider)
      const modelIds = models.map(m => typeof m === 'string' ? m : m.id)
      expect(modelIds).toContain(defaultModel)
    }
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

  it('maps Sonnet 5 forward and reverse across regions and base IDs', () => {
    expect(toBedrockNativeId('claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5')
    expect(toBedrockNativeId('claude-sonnet-5', 'eu')).toBe('eu.anthropic.claude-sonnet-5')
    expect(toBedrockNativeId('anthropic.claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5')
    expect(fromBedrockNativeId('us.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(fromBedrockNativeId('global.anthropic.claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  it('normalizes deprecated Opus IDs to Opus 4.8 before mapping, keeping Opus 4.6', () => {
    expect(toBedrockNativeId('claude-opus-4-5-20251101')).toBe('us.anthropic.claude-opus-4-8')
    expect(toBedrockNativeId('claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(toBedrockNativeId('anthropic.claude-opus-4-6-v1')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(toBedrockNativeId('eu.anthropic.claude-opus-4-6-v1')).toBe('eu.anthropic.claude-opus-4-6-v1')
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
    expect(firstId).toMatch(/claude-(opus|sonnet)-[45]/)
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

  it('maps Opus 4.6 native IDs back to the bare ID', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-4-6-v1')).toBe('claude-opus-4-6')
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

  it('maps Opus 4.6 IDs to their own native IDs', () => {
    expect(normalizeBedrockModelId('pi/claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1')
    expect(normalizeBedrockModelId('claude-opus-4-6', 'eu')).toBe('eu.anthropic.claude-opus-4-6-v1')
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

  it('does NOT become the Anthropic default (Opus 5.5 is the default)', () => {
    expect(getDefaultModelForConnection('anthropic')).toBe('claude-opus-5-5')
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

// ============================================================
// Claude Fable 5.1 registration (Claude Agent SDK path)
// ============================================================

describe('Claude Fable 5.1', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const fable = ANTHROPIC_MODELS.find(m => m.id === 'claude-fable-5-1')
    expect(fable).toBeDefined()
    expect(fable!.provider).toBe('anthropic')
    expect(fable!.name).toBe('Fable 5.1')
    expect(fable!.shortName).toBe('Fable')
    expect(fable!.contextWindow).toBe(1_000_000)
    expect(fable!.descriptionKey).toBe('model.fableDesc')
  })

  it('is listed before Fable 5 so the newest Fable wins shortName resolution', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id)
    expect(ids.indexOf('claude-fable-5-1')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('claude-fable-5-1')).toBeLessThan(ids.indexOf('claude-fable-5'))
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(getModelShortName('claude-fable-5-1')).toBe('Fable')
    expect(getModelContextWindow('claude-fable-5-1')).toBe(1_000_000)
    expect(isClaudeModel('claude-fable-5-1')).toBe(true)
  })

  it('does NOT become the Anthropic default (Opus 5.5 is the default)', () => {
    expect(getDefaultModelForConnection('anthropic')).toBe('claude-opus-5-5')
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-fable-5-1')).toBe('us.anthropic.claude-fable-5-1')
    expect(toBedrockNativeId('claude-fable-5-1', 'eu')).toBe('eu.anthropic.claude-fable-5-1')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('eu.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('global.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    expect(fromBedrockNativeId('anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
    // Bedrock-native id resolves to display metadata too
    expect(getModelDisplayName('us.anthropic.claude-fable-5-1')).toBe('Fable 5.1')
  })

  it('the 5.1 and 5.0 ids never cross-map through the Bedrock tables', () => {
    // Exact-key maps must not let the 'claude-fable-5' prefix swallow 5.1.
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5')).toBe('claude-fable-5')
    expect(toBedrockNativeId('claude-fable-5')).toBe('us.anthropic.claude-fable-5')
  })
})

// ============================================================
// Claude Fable 5.2 registration (Claude Agent SDK path)
// ============================================================

describe('Claude Fable 5.2', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const fable = ANTHROPIC_MODELS.find(m => m.id === 'claude-fable-5-2')
    expect(fable).toBeDefined()
    expect(fable!.provider).toBe('anthropic')
    expect(fable!.name).toBe('Fable 5.2')
    expect(fable!.shortName).toBe('Fable')
    expect(fable!.contextWindow).toBe(1_000_000)
    expect(fable!.descriptionKey).toBe('model.fableDesc')
    expect(getModelDisplayName('claude-fable-5-2')).toBe('Fable 5.2')
    expect(getModelContextWindow('claude-fable-5-2')).toBe(1_000_000)
  })

  it('is listed before Fable 5.1 so the newest Fable wins shortName resolution', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id)
    expect(ids.indexOf('claude-fable-5-2')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('claude-fable-5-2')).toBeLessThan(ids.indexOf('claude-fable-5-1'))
  })

  it('does NOT become the Anthropic default (Opus 5.5 is the default)', () => {
    expect(getDefaultModelForConnection('anthropic')).toBe('claude-opus-5-5')
  })

  it('round-trips through the Bedrock inference-profile mapping without crossing 5.1', () => {
    expect(toBedrockNativeId('claude-fable-5-2')).toBe('us.anthropic.claude-fable-5-2')
    expect(toBedrockNativeId('claude-fable-5-2', 'eu')).toBe('eu.anthropic.claude-fable-5-2')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5-2')).toBe('claude-fable-5-2')
    expect(fromBedrockNativeId('eu.anthropic.claude-fable-5-2')).toBe('claude-fable-5-2')
    expect(fromBedrockNativeId('global.anthropic.claude-fable-5-2')).toBe('claude-fable-5-2')
    expect(fromBedrockNativeId('anthropic.claude-fable-5-2')).toBe('claude-fable-5-2')
    expect(getModelDisplayName('us.anthropic.claude-fable-5-2')).toBe('Fable 5.2')
    expect(fromBedrockNativeId('us.anthropic.claude-fable-5-1')).toBe('claude-fable-5-1')
  })
})

// ============================================================
// Claude Opus 5.5 (new default) and Opus 5 registration
// ============================================================

describe('Claude Opus 5.5', () => {
  it('is registered as an Anthropic model with the expected metadata', () => {
    const opus = ANTHROPIC_MODELS.find(m => m.id === 'claude-opus-5-5')
    expect(opus).toBeDefined()
    expect(opus!.provider).toBe('anthropic')
    expect(opus!.name).toBe('Opus 5.5')
    expect(opus!.shortName).toBe('Opus')
    expect(opus!.contextWindow).toBe(1_000_000)
    expect(opus!.descriptionKey).toBe('model.opusDesc')
    expect(opus!.thinkingAlwaysOn).toBe(true)
  })

  it('is the default for new direct Anthropic connections, listed ahead of Opus 5 and 4.8', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id)
    expect(ids[0]).toBe('claude-opus-5-5')
    expect(ids.indexOf('claude-opus-5-5')).toBeLessThan(ids.indexOf('claude-opus-5'))
    expect(ids.indexOf('claude-opus-5')).toBeLessThan(ids.indexOf('claude-opus-4-8'))
    expect(getDefaultModelForConnection('anthropic')).toBe('claude-opus-5-5')
  })

  it('is the default for new Pi-backed Anthropic and Bedrock connections', () => {
    expect(getDefaultModelForConnection('pi', 'anthropic')).toBe('pi/claude-opus-5-5')
    // Bedrock lists one inference profile per region; they share a rank, so the
    // catalog's own (alphabetical) order decides which region surfaces first.
    // The connection's region prefix is applied later by normalizeBedrockModelId.
    const bedrockDefault = getDefaultModelForConnection('pi', 'amazon-bedrock')
    expect(bedrockDefault).toMatch(/^pi\/(us|eu|global)\.anthropic\.claude-opus-5-5$/)
    expect(fromBedrockNativeId(bedrockDefault.slice('pi/'.length))).toBe('claude-opus-5-5')
  })

  it('resolves display/short name, context window, and Claude detection', () => {
    expect(getModelDisplayName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(getModelShortName('claude-opus-5-5')).toBe('Opus')
    expect(getModelContextWindow('claude-opus-5-5')).toBe(1_000_000)
    expect(isClaudeModel('claude-opus-5-5')).toBe(true)
  })

  it('round-trips through the Bedrock inference-profile mapping', () => {
    expect(toBedrockNativeId('claude-opus-5-5')).toBe('us.anthropic.claude-opus-5-5')
    expect(toBedrockNativeId('claude-opus-5-5', 'eu')).toBe('eu.anthropic.claude-opus-5-5')
    expect(toBedrockNativeId('anthropic.claude-opus-5-5')).toBe('us.anthropic.claude-opus-5-5')
    expect(fromBedrockNativeId('us.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('eu.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(fromBedrockNativeId('anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeBedrockModelId('pi/claude-opus-5-5', 'eu')).toBe('eu.anthropic.claude-opus-5-5')
    expect(getModelDisplayName('us.anthropic.claude-opus-5-5')).toBe('Opus 5.5')
  })

  it('the 5.5 and 5.0 ids never cross-map through the Bedrock tables', () => {
    expect(fromBedrockNativeId('us.anthropic.claude-opus-5')).toBe('claude-opus-5')
    expect(toBedrockNativeId('claude-opus-5')).toBe('us.anthropic.claude-opus-5')
    expect(toBedrockNativeId('claude-opus-5', 'eu')).toBe('eu.anthropic.claude-opus-5')
    expect(fromBedrockNativeId('global.anthropic.claude-opus-5')).toBe('claude-opus-5')
  })
})

describe('Claude Opus 5', () => {
  it('is registered as the previous Opus generation with 1M context and disable-able thinking', () => {
    const opus = ANTHROPIC_MODELS.find(m => m.id === 'claude-opus-5')
    expect(opus).toBeDefined()
    expect(opus!.name).toBe('Opus 5')
    expect(opus!.shortName).toBe('Opus')
    expect(opus!.contextWindow).toBe(1_000_000)
    expect(opus!.thinkingAlwaysOn).toBeUndefined()
    expect(getModelDisplayName('eu.anthropic.claude-opus-5')).toBe('Opus 5')
  })

  it('keeps Opus 4.8 registered and selectable (no forced migration to 5.5)', () => {
    expect(ANTHROPIC_MODELS.some(m => m.id === 'claude-opus-4-8')).toBe(true)
    expect(normalizeDeprecatedModelId('claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(normalizeDeprecatedModelId('claude-opus-5')).toBe('claude-opus-5')
  })
})

// ============================================================
// getMiniModel — utility model for titles, summaries, call_llm
// ============================================================

describe('getMiniModel', () => {
  it('picks GPT-6 Luna for a ChatGPT account, not the last catalog entry', () => {
    // A real ChatGPT Plus model list after the Pi 1.1.0 refresh: no "mini"/"flash" name,
    // and gpt-6.1-sol ($2/$10) is last. gpt-6-luna is $0.10/$0.50.
    const models = ['pi/gpt-5.3-codex-spark', 'pi/gpt-5.5', 'pi/gpt-5.6-luna', 'pi/gpt-5.6-sol', 'pi/gpt-5.6-terra',
      'pi/gpt-6-astra', 'pi/gpt-6-luna', 'pi/gpt-6-sol', 'pi/gpt-6.1-sol']
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'openai-codex', models })).toBe('pi/gpt-6-luna')
    // Older lists without gpt-6-luna fall back to the next preferred entry.
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'openai-codex', models: models.filter(m => m !== 'pi/gpt-6-luna') }))
      .toBe('pi/gpt-5.6-luna')
  })

  it('prefers Luna over the "mini" keyword match for OpenAI API keys', () => {
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'openai', models: ['pi/gpt-6-astra', 'pi/gpt-5.4-mini', 'pi/gpt-6-luna'] }))
      .toBe('pi/gpt-6-luna')
  })

  it('matches Bedrock inference profiles and Pi Anthropic connections by bare id', () => {
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'amazon-bedrock',
      models: ['pi/us.anthropic.claude-opus-5-5', 'pi/us.anthropic.claude-haiku-4-5-20251001-v1:0', 'pi/us.anthropic.claude-haiku-5-5'] }))
      .toBe('pi/us.anthropic.claude-haiku-5-5')
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'anthropic', models: ['pi/claude-opus-5-5', 'pi/claude-haiku-5-5', 'pi/claude-sonnet-5'] }))
      .toBe('pi/claude-haiku-5-5')
  })

  it('uses Kimi K2.6 for Moonshot', () => {
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'moonshotai', models: ['pi/kimi-k3', 'pi/kimi-k2.6'] })).toBe('pi/kimi-k2.6')
  })

  it('keeps the keyword search (whole tokens: "gemini" is not "mini") for other providers and Anthropic connections', () => {
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'google', models: ['pi/gemini-2.5-pro', 'pi/gemini-2.5-flash'] })).toBe('pi/gemini-2.5-flash')
    expect(getMiniModel({ providerType: 'anthropic', models: ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5-20251001'] })).toBe('claude-haiku-5-5')
  })

  it('defaults Cloudflare AI Gateway to Opus 5.5 with Haiku 4.5 as the utility model', () => {
    expect(getDefaultModelForConnection('pi', 'cloudflare-ai-gateway')).toBe('pi/claude-opus-5-5')
    const models = getDefaultModelsForConnection('pi', 'cloudflare-ai-gateway').map(m => typeof m === 'string' ? m : m.id)
    expect(getMiniModel({ providerType: 'pi', piAuthProvider: 'cloudflare-ai-gateway', models })).toBe('pi/claude-haiku-4-5')
  })
})
