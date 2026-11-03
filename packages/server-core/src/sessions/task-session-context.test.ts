import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveSession } from '../../../shared/src/sessions/storage.ts'
import { saveTaskSpec, taskYamlPath, type TaskSpec } from '../../../shared/src/tasks/index.ts'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// A task's own session has no messages until a run's verification, and a task create_task made
// lives only in task.yaml: its agent gets the spec as `ChatOptions.sessionContext` (once, and again
// after the spec changes), and get_session_info reports it to other sessions.
describe('task session context', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-task-context-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function saveSpec(goal: string) {
    const spec: TaskSpec = {
      id: 'gitignore-it',
      title: 'Gitignore the workspace',
      goal,
      acceptance_criteria: 'git status shows no build output.',
      runner: 'conduct',
      nodes: [{ id: 'main', title: 'Gitignore the workspace', prompt: goal, kind: 'session' }],
    }
    saveTaskSpec(tmpRoot, spec)
  }

  async function sessionWithAgent(id: string, fields: { taskSlug?: string; parentSessionId?: string; taskNodeId?: string } = {}) {
    const workspace = { id: 'ws-test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: 'Gitignore the workspace', ...fields }, workspace as never, { messagesLoaded: true })
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    await saveSession({ id, workspaceRootPath: tmpRoot, createdAt: 1, lastUsedAt: 1, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 } } as any)
    const calls: Array<{ message: string; options?: { sessionContext?: string } }> = []
    const agent = {
      getModel: () => 'claude-sonnet-4-6',
      setAllSources: () => {},
      getSessionId: () => 'sdk-session',
      chat: async function* (message: string, _attachments?: unknown, options?: { sessionContext?: string }) {
        calls.push({ message, options })
        yield { type: 'complete' }
      },
    }
    ;(sm as any).getOrCreateAgent = async () => agent
    // Hermetic: the real pre-turn checks read the developer's decision-layer settings.
    ;(sm as any).startPreTurnDecisions = async () => ({ thinkingOverride: null, suggestionHint: null })
    sm.setEventSink(() => {})
    return { managed, calls }
  }

  it("sends the task's spec with its session's first turn, outside the stored message", async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const { managed, calls } = await sessionWithAgent('orchestrator', { taskSlug: 'gitignore-it' })

    await sm.sendMessage(managed.id, 'do the task')
    expect(calls[0]!.message).toBe('do the task')
    const context = calls[0]!.options?.sessionContext ?? ''
    expect(context).toContain('Goal:\nAdd a .gitignore that covers build output.')
    expect(context).toContain('Acceptance criteria:\ngit status shows no build output.')
    expect(context).toContain(taskYamlPath(tmpRoot, 'gitignore-it'))
    expect(managed.messages.find(m => m.role === 'user')?.content).toBe('do the task')

    await sm.sendMessage(managed.id, 'thanks')
    expect(calls[1]!.options).toBeUndefined()
  })

  it('sends it again after the spec changes', async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const { managed, calls } = await sessionWithAgent('edited', { taskSlug: 'gitignore-it' })
    await sm.sendMessage(managed.id, 'do the task')

    saveSpec('Add a .gitignore that covers build output and .env files.')
    await sm.sendMessage(managed.id, 'I changed the task')
    expect(calls[1]!.options?.sessionContext).toContain('Goal:\nAdd a .gitignore that covers build output and .env files.')
  })

  it('keeps it out of a /compact turn and sends it with the next one', async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const { managed, calls } = await sessionWithAgent('compacted', { taskSlug: 'gitignore-it' })
    await sm.sendMessage(managed.id, '/compact')
    expect(calls[0]).toEqual({ message: '/compact', options: undefined })

    await sm.sendMessage(managed.id, 'do the task')
    expect(calls[1]!.options?.sessionContext).toContain('Goal:')
  })

  it('re-sends it on an auth retry of the turn that carried it', async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const { managed, calls } = await sessionWithAgent('auth-retry', { taskSlug: 'gitignore-it' })
    await sm.sendMessage(managed.id, 'do the task')

    const take = (authRetry: boolean) => (sm as any).takeTaskSessionContext(managed, authRetry)
    expect(take(true)).toBe(calls[0]!.options?.sessionContext)
    expect(take(false)).toBeNull()
  })

  it("never sends it to a subtask's session or without a readable task.yaml", async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const subtask = await sessionWithAgent('subtask', { taskSlug: 'gitignore-it', parentSessionId: 'orchestrator', taskNodeId: 'main' })
    await sm.sendMessage(subtask.managed.id, 'Add a .gitignore that covers build output.')
    expect(subtask.calls[0]!.options).toBeUndefined()

    const missing = await sessionWithAgent('missing', { taskSlug: 'no-such-task' })
    await sm.sendMessage(missing.managed.id, 'do the task')
    expect(missing.calls[0]!.options).toBeUndefined()
  })

  it('reports the task to get_session_info, with the subtask a session runs', async () => {
    saveSpec('Add a .gitignore that covers build output.')
    const { managed } = await sessionWithAgent('info', { taskSlug: 'gitignore-it' })
    const subtask = await sessionWithAgent('info-subtask', { taskSlug: 'gitignore-it', parentSessionId: 'info', taskNodeId: 'main' })
    const info = (session: unknown) => (sm as any).taskInfoForSession(session)

    expect(info(managed)).toEqual({
      slug: 'gitignore-it',
      specPath: taskYamlPath(tmpRoot, 'gitignore-it'),
      title: 'Gitignore the workspace',
      goal: 'Add a .gitignore that covers build output.',
      acceptanceCriteria: 'git status shows no build output.',
      subtasks: [],
    })
    expect(info(subtask.managed).nodeId).toBe('main')
    const plain = await sessionWithAgent('plain')
    expect(info(plain.managed)).toBeUndefined()
  })
})
