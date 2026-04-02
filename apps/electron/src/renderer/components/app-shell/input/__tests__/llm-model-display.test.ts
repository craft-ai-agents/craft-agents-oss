import { describe, expect, it } from 'bun:test'

import { getCurrentModelDisplayName } from '../llm-model-display'

describe('getCurrentModelDisplayName', () => {
  it('formats provider-prefixed string models like the selector menu', () => {
    expect(getCurrentModelDisplayName(['openai/gpt-5'], 'openai/gpt-5')).toBe('gpt-5')
    expect(getCurrentModelDisplayName(['pi/qwen3-coder'], 'pi/qwen3-coder')).toBe('qwen3-coder')
  })

  it('prefers typed model definitions when available', () => {
    expect(getCurrentModelDisplayName([
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        shortName: 'GPT-4.1',
        description: 'Test model',
        provider: 'pi',
        contextWindow: 128000,
      },
    ], 'gpt-4.1')).toBe('GPT-4.1')
  })

  it('falls back to the connection default model when one is pinned', () => {
    expect(getCurrentModelDisplayName(['openai/gpt-5'], 'ignored-model', 'openai/gpt-5')).toBe('gpt-5')
  })
})
