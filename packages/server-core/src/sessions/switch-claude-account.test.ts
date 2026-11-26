import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '@craft-agent/shared/config/storage'
import type { LlmConnection, Workspace } from '@craft-agent/shared/config'
import { loadSession } from '@craft-agent/shared/sessions'
import { createManagedSession, SessionManager } from './SessionManager'

type ManagedSession = ReturnType<typeof createManagedSession>

const model = 'claude-opus-5-5'
const otherModel = 'claude-sonnet-5-5'
// One login in two organizations (a personal and a work plan): the case the switch is for.
const accountA: LlmConnection = {
  slug: 'account-a', name: 'Account A', providerType: 'anthropic', authType: 'oauth',
  models: [model, otherModel], defaultModel: model, createdAt: 1,
  oauthAccountUuid: 'login-1', oauthOrganizationUuid: 'org-personal',
}
const accountB: LlmConnection = { ...accountA, slug: 'account-b', name: 'Account B', defaultModel: otherModel, oauthOrganizationUuid: 'org-work' }
const sameOrg: LlmConnection = { ...accountA, slug: 'same-org', name: 'Same org' }
const apiKey: LlmConnection = { ...accountA, slug: 'api-key', name: 'API key', authType: 'api_key', oauthAccountUuid: undefined, oauthOrganizationUuid: undefined }
const endpoint: LlmConnection = { ...accountB, slug: 'endpoint', name: 'Endpoint', baseUrl: 'https://llm.example.com' }
const withoutModel: LlmConnection = { ...accountB, slug: 'without-model', name: 'Without model', models: [otherModel] }
const connections = [accountA, accountB, sameOrg, apiKey, endpoint, withoutModel]

type TokenResult = { accessToken: string | null; transientRefreshError?: string }
type SentEvent = { type: string } & Record<string, unknown>
type Internals = {
  sessions: Map<string, ManagedSession>
  reserveAdmission: (id: string) => { ready: Promise<void>; release: () => void }
  sendEvent: (event: SentEvent, workspaceId?: string) => void
  getClaudeAccountToken: (slug: string) => Promise<TokenResult>
}

/** Like ClaudeAgent with keep-alive: the persistent query stays open between turns, so it reports processing while idle. */
function keepAliveAgent() {
  const agent = { disposed: 0, isProcessing: () => true, dispose: () => { agent.disposed++ } }
  return agent
}

function fixture(rootPath: string, overrides: Partial<ManagedSession> = {}) {
  const sm = new SessionManager()
  const internals = sm as unknown as Internals
  const workspace: Workspace = { id: 'ws-test', slug: 'test', name: 'Test', rootPath, createdAt: Date.now() }
  const turn = { id: 'turn-1', role: 'user' as const, content: 'A prior message', timestamp: Date.now() }
  const managed = createManagedSession(
    { id: 'account-switch-test', llmConnection: accountA.slug, model, sdkSessionId: 'sdk-transcript', connectionLocked: true },
    workspace,
    { messages: [turn], messagesLoaded: true, ...overrides },
  )
  internals.sessions.set(managed.id, managed)

  const events: SentEvent[] = []
  internals.sendEvent = event => { events.push(event) }
  const tokens = new Map<string, TokenResult>(connections.map(c => [c.slug, { accessToken: `test-token-${c.slug}` }]))
  internals.getClaudeAccountToken = async slug => tokens.get(slug) ?? { accessToken: null }

  const agent = keepAliveAgent()
  managed.agent = agent as unknown as ManagedSession['agent']
  return { sm, internals, managed, turn, events, tokens, agent }
}

describe('switch the Claude account of a started chat', () => {
  let rootPath: string
  let config: ReturnType<typeof spyOn>

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), 'craft-switch-account-'))
    config = spyOn(storage, 'getLlmConnection').mockImplementation((slug: string) =>
      connections.find(c => c.slug === slug) ?? null)
  })
  afterEach(() => {
    config.mockRestore()
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('moves the chat to the other account and restarts its keep-alive agent', async () => {
    const { sm, managed, turn, events, agent } = fixture(rootPath)

    await sm.setSessionConnection(managed.id, accountB.slug, true)

    // The old CLI holds account A's credentials and never reports idle: the switch must end it.
    expect(agent.disposed).toBe(1)
    expect(managed.agent).toBeNull()
    expect(managed.llmConnection).toBe(accountB.slug)
    expect(managed.sdkSessionId).toBe('sdk-transcript')
    expect(loadSession(rootPath, managed.id)).toMatchObject({
      llmConnection: accountB.slug, model, sdkSessionId: 'sdk-transcript',
      messages: [expect.objectContaining({ id: turn.id, content: turn.content })],
    })
    expect(events.map(e => e.type)).toEqual(['connection_changed'])
    expect(events[0]).toMatchObject({ sessionId: managed.id, connectionSlug: accountB.slug })

    await sm.setSessionConnection(managed.id, accountA.slug, true)
    expect(loadSession(rootPath, managed.id)?.llmConnection).toBe(accountA.slug)
  })

  it('keeps the model the chat runs on, not the new account\'s default, and announces it', async () => {
    const { sm, managed, events } = fixture(rootPath, { model: undefined })

    await sm.setSessionConnection(managed.id, accountB.slug, true)

    expect(managed.model).toBe(model)
    expect(loadSession(rootPath, managed.id)?.model).toBe(model)
    expect(events.find(e => e.type === 'session_model_changed')).toMatchObject({ sessionId: managed.id, model })
  })

  it('checks the new account\'s own sign-in before switching', async () => {
    const { sm, managed, tokens, agent } = fixture(rootPath)

    tokens.set(accountB.slug, { accessToken: null })
    await expect(sm.setSessionConnection(managed.id, accountB.slug, true)).rejects.toThrow('Account B is not signed in')

    tokens.set(accountB.slug, { accessToken: null, transientRefreshError: 'network timeout' })
    await expect(sm.setSessionConnection(managed.id, accountB.slug, true)).rejects.toThrow('network timeout')

    expect(managed.llmConnection).toBe(accountA.slug)
    expect(agent.disposed).toBe(0)
  })

  it('refuses connections that would change more than the credentials', async () => {
    const { sm, managed, agent } = fixture(rootPath)

    for (const target of [apiKey, endpoint, withoutModel, sameOrg]) {
      await expect(sm.setSessionConnection(managed.id, target.slug, true)).rejects.toThrow(`${target.name} can't continue this chat`)
    }
    expect(managed.llmConnection).toBe(accountA.slug)
    expect(agent.disposed).toBe(0)
  })

  it('refuses while the chat has work in flight', async () => {
    const running = fixture(rootPath, { isProcessing: true })
    await expect(running.sm.setSessionConnection(running.managed.id, accountB.slug, true)).rejects.toThrow('Wait for the chat to finish')

    const queued = fixture(rootPath, { messageQueue: [{ message: 'next' }] as unknown as ManagedSession['messageQueue'] })
    await expect(queued.sm.setSessionConnection(queued.managed.id, accountB.slug, true)).rejects.toThrow('queued messages')

    const background = fixture(rootPath)
    background.managed.backgroundTaskRegistry.set('task-1', { status: 'running' } as never)
    await expect(background.sm.setSessionConnection(background.managed.id, accountB.slug, true)).rejects.toThrow('background tasks')

    for (const { managed, agent } of [running, queued, background]) {
      expect(managed.llmConnection).toBe(accountA.slug)
      expect(agent.disposed).toBe(0)
    }
  })

  it('waits for an earlier admission and refuses when that turn is running', async () => {
    const { sm, internals, managed, agent } = fixture(rootPath)
    const send = internals.reserveAdmission(managed.id)
    const switching = sm.setSessionConnection(managed.id, accountB.slug, true)

    await send.ready
    managed.isProcessing = true
    send.release()

    await expect(switching).rejects.toThrow('Wait for the chat to finish')
    expect(managed.llmConnection).toBe(accountA.slug)
    expect(agent.disposed).toBe(0)
  })
})

describe('choose the connection of a chat that has not started', () => {
  let rootPath: string
  let config: ReturnType<typeof spyOn>

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), 'craft-set-connection-'))
    config = spyOn(storage, 'getLlmConnection').mockImplementation((slug: string) =>
      connections.find(c => c.slug === slug) ?? null)
  })
  afterEach(() => {
    config.mockRestore()
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('accepts any connection before the first message', async () => {
    const { sm, managed, events } = fixture(rootPath, { messages: [], sdkSessionId: undefined, connectionLocked: false })

    await sm.setSessionConnection(managed.id, apiKey.slug)

    expect(loadSession(rootPath, managed.id)?.llmConnection).toBe(apiKey.slug)
    expect(events.map(e => e.type)).toEqual(['connection_changed'])
  })

  it('refuses a change without switchAccount once the chat has started', async () => {
    const started = fixture(rootPath)
    await expect(started.sm.setSessionConnection(started.managed.id, accountB.slug)).rejects.toThrow('after session has started')

    // Started (it has an SDK transcript) although no messages are in memory.
    const unloaded = fixture(rootPath, { messages: [] })
    await expect(unloaded.sm.setSessionConnection(unloaded.managed.id, apiKey.slug)).rejects.toThrow('after session has started')

    expect(started.managed.llmConnection).toBe(accountA.slug)
    expect(unloaded.managed.llmConnection).toBe(accountA.slug)
  })
})
