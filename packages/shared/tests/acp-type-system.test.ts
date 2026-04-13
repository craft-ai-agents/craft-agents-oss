/**
 * Task 1: ACP Type System Registration
 *
 * Verifies that 'acp' is wired into all required type-level registries:
 * - llm-connections: LlmProviderType, isValidProviderAuthCombination, getModelsForProviderType, getDefaultModelsForConnection
 * - factory: providerTypeToAgentProvider, BACKEND_CAPABILITIES, getDefaultAuthType
 * - driver-types: getDefaultProviderType
 */
import { describe, it, expect } from 'bun:test'
import '../tests/setup/register-pi-model-resolver.ts'
import {
  isValidProviderAuthCombination,
  getModelsForProviderType,
  getDefaultModelsForConnection,
} from '../src/config/llm-connections'
import {
  providerTypeToAgentProvider,
  BACKEND_CAPABILITIES,
  getDefaultAuthType,
} from '../src/agent/backend/factory'
import { getDefaultProviderType } from '../src/agent/backend/internal/driver-types'

// ============================================================
// isValidProviderAuthCombination
// ============================================================

describe('isValidProviderAuthCombination — acp', () => {
  it('accepts none (local agent, no auth)', () => {
    expect(isValidProviderAuthCombination('acp', 'none')).toBe(true)
  })

  it('accepts api_key (optional bearer for authenticated ACP servers)', () => {
    expect(isValidProviderAuthCombination('acp', 'api_key')).toBe(true)
  })

  it('rejects oauth (not supported for ACP)', () => {
    expect(isValidProviderAuthCombination('acp', 'oauth')).toBe(false)
  })

  it('rejects pi_compat-specific auth (api_key_with_endpoint)', () => {
    expect(isValidProviderAuthCombination('acp', 'api_key_with_endpoint')).toBe(false)
  })
})

// ============================================================
// getModelsForProviderType
// ============================================================

describe('getModelsForProviderType — acp', () => {
  it('returns empty array (ACP agents expose no model list)', () => {
    expect(getModelsForProviderType('acp')).toEqual([])
  })
})

// ============================================================
// getDefaultModelsForConnection
// ============================================================

describe('getDefaultModelsForConnection — acp', () => {
  it('returns empty array', () => {
    expect(getDefaultModelsForConnection('acp')).toEqual([])
  })
})

// ============================================================
// factory: providerTypeToAgentProvider
// ============================================================

describe('providerTypeToAgentProvider — acp', () => {
  it("maps 'acp' → 'acp'", () => {
    expect(providerTypeToAgentProvider('acp')).toBe('acp')
  })
})

// ============================================================
// factory: BACKEND_CAPABILITIES
// ============================================================

describe('BACKEND_CAPABILITIES — acp', () => {
  it('has acp entry with needsHttpPoolServer = false', () => {
    expect(BACKEND_CAPABILITIES['acp']).toBeDefined()
    expect(BACKEND_CAPABILITIES['acp'].needsHttpPoolServer).toBe(false)
  })
})

// ============================================================
// factory: getDefaultAuthType
// ============================================================

describe('getDefaultAuthType — acp', () => {
  it('returns undefined (no default auth; connection config drives it)', () => {
    expect(getDefaultAuthType('acp')).toBeUndefined()
  })
})

// ============================================================
// driver-types: getDefaultProviderType
// ============================================================

describe('getDefaultProviderType — acp', () => {
  it("returns 'acp'", () => {
    expect(getDefaultProviderType('acp')).toBe('acp')
  })
})

// ============================================================
// Regression: existing providers still work
// ============================================================

describe('Regression — existing providers unchanged', () => {
  it('anthropic auth combinations still valid', () => {
    expect(isValidProviderAuthCombination('anthropic', 'api_key')).toBe(true)
    expect(isValidProviderAuthCombination('anthropic', 'oauth')).toBe(true)
    expect(isValidProviderAuthCombination('anthropic', 'none')).toBe(false)
  })

  it('pi auth combinations still valid', () => {
    expect(isValidProviderAuthCombination('pi', 'api_key')).toBe(true)
    expect(isValidProviderAuthCombination('pi', 'none')).toBe(true)
    expect(isValidProviderAuthCombination('pi', 'oauth')).toBe(true)
  })

  it('providerTypeToAgentProvider anthropic/pi unchanged', () => {
    expect(providerTypeToAgentProvider('anthropic')).toBe('anthropic')
    expect(providerTypeToAgentProvider('pi')).toBe('pi')
    expect(providerTypeToAgentProvider('pi_compat')).toBe('pi')
  })
})
