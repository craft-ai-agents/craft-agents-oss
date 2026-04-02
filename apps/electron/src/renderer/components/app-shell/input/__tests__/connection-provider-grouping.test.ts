import { describe, expect, it } from 'bun:test'

import { getConnectionProviderGroupName, groupConnectionsByProvider } from '../llm-provider-groups'

type TestConnection = {
  providerType?: string
  type?: string
  baseUrl?: string
}

describe('FreeFormInput connection provider grouping', () => {
  it('maps known providers to stable group labels', () => {
    expect(getConnectionProviderGroupName({ providerType: 'anthropic' })).toBe('Anthropic')
    expect(getConnectionProviderGroupName({ providerType: 'bedrock' })).toBe('Anthropic')
    expect(getConnectionProviderGroupName({ providerType: 'pi' })).toBe('Craft Agents Backend')
    expect(getConnectionProviderGroupName({ providerType: 'openai' })).toBe('OpenAI')
    expect(getConnectionProviderGroupName({ providerType: 'openai_compat' })).toBe('OpenAI')
  })

  it('uses legacy type when providerType is missing', () => {
    expect(getConnectionProviderGroupName({ type: 'openai' } as TestConnection)).toBe('OpenAI')
  })

  it('detects provider from compatible base URL when needed', () => {
    expect(getConnectionProviderGroupName({
      providerType: 'custom',
      baseUrl: 'https://openrouter.ai/api/v1',
    })).toBe('OpenRouter')

    expect(getConnectionProviderGroupName({
      providerType: 'custom',
      baseUrl: 'http://localhost:11434/v1',
    })).toBe('Custom')
  })

  it('keeps unknown provider names as title-cased labels', () => {
    expect(getConnectionProviderGroupName({ providerType: 'super_llm_service' })).toBe('Super Llm Service')
  })

  it('groups connections by provider label while preserving connection order', () => {
    const connections: TestConnection[] = [
      { providerType: 'pi', },
      { providerType: 'openai', },
      { type: 'openai' } as TestConnection,
      {
        providerType: 'custom',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      {
        providerType: 'minimax',
        baseUrl: 'https://api.minimax.io/v1',
      },
    ]

    const groups = groupConnectionsByProvider(connections)

    expect(groups).toHaveLength(4)
    expect(groups[0]?.[0]).toBe('Craft Agents Backend')
    expect(groups[1]?.[0]).toBe('OpenAI')
    expect(groups[2]?.[0]).toBe('OpenRouter')
    expect(groups[3]?.[0]).toBe('Minimax')

    expect(groups[1]?.[1]).toHaveLength(2)
    expect(groups[1]?.[1]?.[0]).toMatchObject({ providerType: 'openai' })
    expect(groups[1]?.[1]?.[1]).toMatchObject({ type: 'openai' })
  })
})
