import { describe, expect, test } from 'bun:test'
import type { LlmConnectionWithStatus } from '@config/llm-connections'
import { resolveCraftyModel, sessionOptionsFor, usableChoice, type CraftyDefaults } from '../model-choice'

function connection(slug: string, models: string[], extra: Partial<LlmConnectionWithStatus> = {}): LlmConnectionWithStatus {
  return {
    slug,
    name: slug,
    providerType: 'anthropic',
    authType: 'api_key',
    models: models.map(id => ({ id, name: id.toUpperCase() })),
    defaultModel: models[0],
    createdAt: 0,
    isAuthenticated: true,
    ...extra,
  } as LlmConnectionWithStatus
}

const work = connection('work', ['opus', 'sonnet'], { isDefault: true })
const personal = connection('personal', ['gpt', 'gpt-mini'])
const signedOut = connection('signed-out', ['haiku'], { isAuthenticated: false })
const connections = [work, personal, signedOut]
const defaults: CraftyDefaults = { connection: 'work', model: 'sonnet', thinkingLevel: 'medium' }

describe('usableChoice', () => {
  test('keeps a pick that still applies', () => {
    expect(usableChoice({ llmConnection: 'personal', model: 'gpt-mini', thinkingLevel: 'high' }, connections))
      .toEqual({ llmConnection: 'personal', model: 'gpt-mini', thinkingLevel: 'high' })
  })

  test('drops a model the connection no longer lists, keeps the connection', () => {
    expect(usableChoice({ llmConnection: 'personal', model: 'gone' }, connections))
      .toEqual({ llmConnection: 'personal', model: undefined, thinkingLevel: undefined })
  })

  test('a removed or signed-out connection takes its model with it', () => {
    expect(usableChoice({ llmConnection: 'removed', model: 'x', thinkingLevel: 'low' }, connections)).toEqual({ thinkingLevel: 'low' })
    expect(usableChoice({ llmConnection: 'signed-out', model: 'haiku' }, connections)).toEqual({ thinkingLevel: undefined })
  })

  test('ignores an unknown thinking level (an old or edited value)', () => {
    expect(usableChoice({ thinkingLevel: 'turbo' as never }, connections)).toEqual({ thinkingLevel: undefined })
  })
})

describe('resolveCraftyModel', () => {
  test('nothing picked: the workspace defaults, like a new session', () => {
    expect(resolveCraftyModel({ connections, defaults, choice: {}, session: null }))
      .toEqual({ connection: undefined, model: 'sonnet', thinkingLevel: 'medium' })
  })

  test('a picked connection uses its own default model, never the workspace one', () => {
    expect(resolveCraftyModel({ connections, defaults, choice: { llmConnection: 'personal' }, session: null }).model).toBe('gpt')
  })

  test('the pick wins over the defaults', () => {
    expect(resolveCraftyModel({ connections, defaults, choice: { llmConnection: 'personal', model: 'gpt-mini', thinkingLevel: 'high' }, session: null }))
      .toEqual({ connection: 'personal', model: 'gpt-mini', thinkingLevel: 'high' })
  })

  test('a tier hint as the workspace model shows the connection default', () => {
    expect(resolveCraftyModel({ connections, defaults: { ...defaults, model: 'fast' }, choice: {}, session: null }).model).toBe('opus')
  })

  test('once the session exists, it is what the session got', () => {
    const session = { llmConnection: 'work', model: 'opus', thinkingLevel: 'low' as const }
    expect(resolveCraftyModel({ connections, defaults, choice: { llmConnection: 'personal', model: 'gpt' }, session }))
      .toEqual({ connection: 'work', model: 'opus', thinkingLevel: 'low' })
  })

  test('a session without a model shows its connection default', () => {
    expect(resolveCraftyModel({ connections, defaults, choice: {}, session: { thinkingLevel: 'medium' } }).model).toBe('opus')
  })
})

describe('sessionOptionsFor', () => {
  test('nothing picked: no options, so the server applies the defaults', () => {
    const resolved = resolveCraftyModel({ connections, defaults, choice: {}, session: null })
    expect(sessionOptionsFor({}, resolved)).toEqual({})
  })

  test('a picked connection always goes with its model', () => {
    const choice = { llmConnection: 'personal' }
    const resolved = resolveCraftyModel({ connections, defaults, choice, session: null })
    expect(sessionOptionsFor(choice, resolved)).toEqual({ llmConnection: 'personal', model: 'gpt' })
  })

  test('a thinking level alone is passed on its own', () => {
    const choice = { thinkingLevel: 'high' as const }
    const resolved = resolveCraftyModel({ connections, defaults, choice, session: null })
    expect(sessionOptionsFor(choice, resolved)).toEqual({ thinkingLevel: 'high' })
  })
})
