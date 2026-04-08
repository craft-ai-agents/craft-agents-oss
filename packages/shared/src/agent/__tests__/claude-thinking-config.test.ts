import { describe, expect, it } from 'bun:test'
import { resolveClaudeThinkingOptions } from '../claude-agent.ts'
import { getThinkingTokens } from '../thinking-levels.ts'

describe('resolveClaudeThinkingOptions', () => {
  it('uses adaptive thinking for true Anthropic backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'medium',
      model: 'claude-opus-4-6',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'adaptive' },
      effort: 'medium',
    })
  })

  it('falls back to token budgets for anthropic_compat endpoints', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'claude-opus-4-6',
      providerType: 'anthropic_compat',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: getThinkingTokens('high', 'claude-opus-4-6'),
    })
  })

  it('uses token budgets for non-Claude anthropic_compat models when the connection marks them as thinking-capable', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'glm-5.1',
      providerType: 'anthropic_compat',
      minimizeThinking: false,
      supportsThinking: true,
    })

    expect(result).toEqual({
      maxThinkingTokens: getThinkingTokens('high', 'glm-5.1'),
    })
  })

  it('uses token budgets for Haiku on true Anthropic backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 6_000,
    })
  })

  it('uses correct max budget for Haiku', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'max',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 8_000,
    })
  })

  it('disables thinking for Haiku when level is off', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'off',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 0,
    })
  })

  it('respects explicit supportsThinking=false for anthropic_compat models', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'glm-5v-turbo',
      providerType: 'anthropic_compat',
      minimizeThinking: false,
      supportsThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 0,
    })
  })

  it('disables thinking entirely when level is off on adaptive backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'off',
      model: 'claude-sonnet-4-6',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'disabled' },
    })
  })
})
