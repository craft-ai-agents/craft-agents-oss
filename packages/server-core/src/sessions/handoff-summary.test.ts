import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveSession } from '../../../shared/src/sessions/storage.ts'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// "Continue in a new session" (Coding mode switch): the summary of the earlier conversation is a
// model call that takes seconds, so the new session opens at once and gets the summary in the
// background; its first turn waits for it (bounded).
describe('handoff summary in the background', () => {
  let tmpRoot: string
  let sm: SessionManager
  const workspace = () => ({ id: 'ws-test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() })
  const sessions = () => (sm as unknown as { sessions: Map<string, ReturnType<typeof createManagedSession>> }).sessions

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-handoff-summary-'))
    sm = new SessionManager()
    sm.setEventSink(() => {})
    // Hermetic: the real pre-turn checks read the developer's decision-layer settings.
    ;(sm as any).startPreTurnDecisions = async () => ({ thinkingOverride: null, suggestionHint: null })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  /** A session whose fake agent records the summary it would read when its turn runs. */
  async function sessionWithAgent(id: string) {
    const managed = createManagedSession({ id, name: 'handoff test' }, workspace() as never, { messagesLoaded: true })
    sessions().set(id, managed)
    await saveSession({ id, workspaceRootPath: tmpRoot, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } } as any)
    const turns: Array<{ message: string; summary?: string }> = []
    ;(sm as any).getOrCreateAgent = async () => ({
      getModel: () => 'claude-sonnet-4-6',
      setAllSources: () => {},
      getSessionId: () => 'sdk-session',
      // BaseAgent.chat reads the summary through getTransferredSessionSummary while the turn runs
      chat: async function* (message: string) {
        turns.push({ message, summary: managed.transferredSessionSummaryApplied ? undefined : managed.transferredSessionSummary })
        yield { type: 'complete' }
      },
    })
    return { managed, turns }
  }

  it('continues in a new session at once and attaches the summary when it is ready', async () => {
    const source = createManagedSession({ id: 'source', name: 'source' }, workspace() as never, { messagesLoaded: true })
    sessions().set('source', source)
    const target = createManagedSession({ id: 'target', name: 'target' }, workspace() as never, { messagesLoaded: true })
    ;(sm as any).createSession = async () => { sessions().set('target', target); return { id: 'target' } }
    const summary = deferred<string | null>()
    ;(sm as any).generateSessionHandoffSummary = () => summary.promise

    expect(await sm.continueSessionInNewSession('source', true)).toEqual({ sessionId: 'target' })
    const pending = target.pendingHandoffSummary
    expect(pending).toBeDefined()
    expect(target.transferredSessionSummary).toBeUndefined()

    summary.resolve('The user is adding a recursive repo scan.')
    await pending
    expect(target.transferredSessionSummary).toBe('The user is adding a recursive repo scan.')
    expect(target.transferredSessionSummaryApplied).toBe(false)
    expect(target.pendingHandoffSummary).toBeUndefined()
  })

  it('starts the new session without a summary when generating one fails', async () => {
    const source = createManagedSession({ id: 'source', name: 'source' }, workspace() as never, { messagesLoaded: true })
    sessions().set('source', source)
    const target = createManagedSession({ id: 'target', name: 'target' }, workspace() as never, { messagesLoaded: true })
    ;(sm as any).createSession = async () => { sessions().set('target', target); return { id: 'target' } }
    ;(sm as any).generateSessionHandoffSummary = async () => { throw new Error('mini model unavailable') }

    await sm.continueSessionInNewSession('source', true)
    await target.pendingHandoffSummary
    expect(target.transferredSessionSummary).toBeUndefined()
    expect(target.pendingHandoffSummary).toBeUndefined()
  })

  it('makes the first turn wait for a summary that is still being generated', async () => {
    const { managed, turns } = await sessionWithAgent('continued')
    const summary = deferred<void>()
    managed.pendingHandoffSummary = summary.promise.then(() => { managed.transferredSessionSummary = 'Earlier: picked the scan roots.' })

    const sending = sm.sendMessage(managed.id, 'carry on')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(turns).toHaveLength(0)

    summary.resolve()
    await sending
    expect(turns).toEqual([{ message: 'carry on', summary: 'Earlier: picked the scan roots.' }])
  })

  it('starts the first turn without the summary after the wait limit', async () => {
    const { managed, turns } = await sessionWithAgent('slow-summary')
    ;(sm as any).handoffSummaryWaitMs = 20
    managed.pendingHandoffSummary = new Promise<void>(() => {})

    await sm.sendMessage(managed.id, 'carry on')
    expect(turns).toEqual([{ message: 'carry on', summary: undefined }])
  })
})

// The summary agent is a one-shot ClaudeAgent: without postInit its CLI started from process.env,
// which holds another session's credentials (another account, or a gateway), or none at all.
describe('handoff summary agent', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-handoff-agent-'))
    sm = new SessionManager()
    sm.setEventSink(() => {})
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it("summarizes only with the session connection's credentials", async () => {
    const workspace = { id: 'ws-test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession({ id: 'source', name: 'source' }, workspace as never, { messagesLoaded: true })
    managed.messages = [
      { id: 'm1', role: 'user', content: 'Fix the login bug', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'Fixed it in auth.ts', timestamp: 2 },
    ] as never
    const calls: string[] = []
    let authInjected = false
    ;(sm as any).createHandoffSummaryAgent = () => ({
      postInit: async () => {
        calls.push('postInit')
        return { authInjected, authWarning: 'Failed to get OAuth token for: claude-max' }
      },
      runMiniCompletion: async () => {
        calls.push('runMiniCompletion')
        return 'The user asked to fix the login bug; it is fixed in auth.ts.'
      },
      destroy: () => { calls.push('destroy') },
    })

    expect(await (sm as any).generateSessionHandoffSummary(managed)).toBeNull()
    expect(calls).toEqual(['postInit', 'destroy'])

    calls.length = 0
    authInjected = true
    expect(await (sm as any).generateSessionHandoffSummary(managed)).toBe('The user asked to fix the login bug; it is fixed in auth.ts.')
    expect(calls).toEqual(['postInit', 'runMiniCompletion', 'destroy'])
  })
})
