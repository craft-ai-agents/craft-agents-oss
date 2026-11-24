import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '@craft-agent/shared/config/storage'
import type { LlmConnection, Workspace } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { loadSession } from '@craft-agent/shared/sessions'
import { buildRestartRequiredSignature } from './runtime-config'
import { createManagedSession, SessionManager } from './SessionManager'

const model = 'claude-sonnet-4-6'
const accountA: LlmConnection = { slug: 'account-a', name: 'Account A', providerType: 'anthropic', authType: 'oauth', models: [model], defaultModel: model, createdAt: 1 }
const accountB: LlmConnection = { ...accountA, slug: 'account-b', name: 'Account B', models: [model, 'claude-haiku-4-5'], defaultModel: 'claude-haiku-4-5' }
const accountC: LlmConnection = { ...accountA, slug: 'account-c', name: 'Account C' }
const apiKey: LlmConnection = { ...accountA, slug: 'api-key', authType: 'api_key' }
const incompatible: LlmConnection = { ...accountA, slug: 'other-model', models: ['claude-haiku-4-5'] }

function fixture(rootPath: string, options: Partial<ReturnType<typeof createManagedSession>> = {}) {
  const sm = new SessionManager()
  const workspace: Workspace = { id: 'ws-test', slug: 'test', name: 'Test', rootPath, createdAt: Date.now() }
  const originalTurn = { id: 'turn-1', role: 'user' as const, content: 'A prior message', timestamp: Date.now() }
  const managed = createManagedSession({ id: 'account-switch-test', llmConnection: accountA.slug, model, sdkSessionId: 'sdk-transcript', connectionLocked: true }, workspace, {
    messages: [originalTurn], messagesLoaded: true, ...options,
  })
  const manager = sm as unknown as {
    sessions: Map<string, typeof managed>
    reserveAdmission: (id: string) => { ready: Promise<void>; release: () => void }
  }
  manager.sessions.set(managed.id, managed)
  return { sm, manager, managed, originalTurn }
}

describe('switch Claude account in an existing session', () => {
  let rootPath: string
  let config: ReturnType<typeof spyOn>
  let credential: ReturnType<typeof spyOn>

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), 'craft-switch-account-'))
    config = spyOn(storage, 'getLlmConnection').mockImplementation((slug: string) =>
      [accountA, accountB, accountC, apiKey, incompatible].find(c => c.slug === slug) ?? null)
    credential = spyOn(getCredentialManager(), 'getLlmOAuth').mockImplementation(async (slug: string) =>
      slug === accountA.slug || slug === accountB.slug ? { accessToken: 'test-only-' + slug } : null)
  })
  afterEach(() => {
    config.mockRestore()
    credential.mockRestore()
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('persists the selected account, keeps the model and transcript, and rebuilds the old runtime', async () => {
    const { sm, managed, originalTurn } = fixture(rootPath)
    let disposed = false
    managed.agent = {
      isProcessing: () => false,
      dispose: () => { disposed = true },
    } as NonNullable<typeof managed.agent>
    managed.backendRuntimeSignature = 'initialized'
    managed.backendRestartSignature = buildRestartRequiredSignature({ connection: accountA, provider: 'anthropic', authType: 'oauth', resolvedModel: model })

    await sm.setSessionConnection(managed.id, accountB.slug, true)
    expect(credential).toHaveBeenCalledWith(accountB.slug)
    expect(loadSession(rootPath, managed.id)).toMatchObject({
      llmConnection: accountB.slug, sdkSessionId: 'sdk-transcript', model,
      messages: [expect.objectContaining({ id: originalTurn.id, content: originalTurn.content })],
    })

    // The same refresh runs at the start of getOrCreateAgent, before the next send.
    await sm.refreshConnectionRuntime(accountB.slug)
    expect(disposed).toBe(true)
    expect(managed.agent).toBeNull()
    expect(managed.sdkSessionId).toBe('sdk-transcript')

    await sm.setSessionConnection(managed.id, accountA.slug, true)
    expect(loadSession(rootPath, managed.id)?.llmConnection).toBe(accountA.slug)
  })

  it('pins the old default model before notifying the renderer about the new account', async () => {
    const { sm, managed } = fixture(rootPath, { model: undefined })
    const events: unknown[] = []
    sm.setEventSink((_channel, _target, event) => events.push(event))

    await sm.setSessionConnection(managed.id, accountB.slug, true)
    expect(loadSession(rootPath, managed.id)?.model).toBe(model)
    expect(events).toEqual([
      expect.objectContaining({ type: 'session_model_changed', model }),
      expect.objectContaining({ type: 'connection_changed', connectionSlug: accountB.slug }),
    ])
  })

  it('rejects implicit switches, billing-mode changes, unsupported models and missing credentials', async () => {
    const { sm, managed } = fixture(rootPath)
    await expect(sm.setSessionConnection(managed.id, accountB.slug)).rejects.toThrow('after session has started')
    await expect(sm.setSessionConnection(managed.id, apiKey.slug, true)).rejects.toThrow('current chat model')
    await expect(sm.setSessionConnection(managed.id, incompatible.slug, true)).rejects.toThrow('current chat model')
    await expect(sm.setSessionConnection(managed.id, accountC.slug, true)).rejects.toThrow('not signed in')
    expect(managed.llmConnection).toBe(accountA.slug)
  })

  it('waits for an earlier admission and rejects a switch during an active turn', async () => {
    const { sm, manager, managed } = fixture(rootPath)
    const send = manager.reserveAdmission(managed.id)
    const switching = sm.setSessionConnection(managed.id, accountB.slug, true)
    expect(credential).not.toHaveBeenCalled()
    await send.ready
    managed.isProcessing = true
    send.release()
    await expect(switching).rejects.toThrow('current chat work')
    expect(managed.llmConnection).toBe(accountA.slug)
  })

  it('holds later sends until the selected account is saved', async () => {
    const { sm, manager, managed } = fixture(rootPath)
    let resolveCredential!: (value: { accessToken: string }) => void
    const pendingCredential = new Promise<{ accessToken: string }>(resolve => { resolveCredential = resolve })
    credential.mockImplementationOnce(() => pendingCredential)

    const switching = sm.setSessionConnection(managed.id, accountB.slug, true)
    const nextSend = manager.reserveAdmission(managed.id)
    let nextAccount: string | undefined
    const observeNextSend = nextSend.ready.then(() => {
      nextAccount = managed.llmConnection
      nextSend.release()
    })
    await Promise.resolve()
    expect(nextAccount).toBeUndefined()
    resolveCredential({ accessToken: 'test-only-account-b' })
    await Promise.all([switching, observeNextSend])
    expect(nextAccount).toBe(accountB.slug)
    expect(loadSession(rootPath, managed.id)?.llmConnection).toBe(accountB.slug)
  })

  it('leaves the original cross-provider selection flow available in an empty chat', async () => {
    const { sm, managed } = fixture(rootPath, { messages: [], connectionLocked: false, sdkSessionId: undefined })
    await sm.setSessionConnection(managed.id, apiKey.slug)
    expect(loadSession(rootPath, managed.id)?.llmConnection).toBe(apiKey.slug)
    expect(credential).not.toHaveBeenCalled()
  })
})
