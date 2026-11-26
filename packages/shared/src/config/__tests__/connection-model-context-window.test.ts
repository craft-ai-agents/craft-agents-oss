import { describe, expect, it } from 'bun:test'
import { getConnectionModelContextWindow, getModelContextWindow, type ModelDefinition } from '../models.ts'

const cachedRow = (id: string, contextWindow: number) =>
  ({ id, name: id, shortName: id, description: '', provider: 'anthropic', contextWindow }) as ModelDefinition

describe('getConnectionModelContextWindow', () => {
  it('uses the connection model list for a model the registry does not know', () => {
    const models = ['claude-unlisted-string', cachedRow('claude-unlisted-1m', 1_000_000)]
    expect(getModelContextWindow('claude-unlisted-1m')).toBeUndefined()
    expect(getConnectionModelContextWindow('claude-unlisted-1m', models)).toBe(1_000_000)
    expect(getConnectionModelContextWindow('claude-unlisted-string', models)).toBeUndefined()
    expect(getConnectionModelContextWindow('claude-unlisted-1m')).toBeUndefined()
  })

  it('keeps registry metadata ahead of the cached row', () => {
    const registered = getModelContextWindow('claude-haiku-4-5-20251001')
    expect(registered).toBeDefined()
    expect(
      getConnectionModelContextWindow('claude-haiku-4-5-20251001', [cachedRow('claude-haiku-4-5-20251001', 1)]),
    ).toBe(registered)
  })
})
