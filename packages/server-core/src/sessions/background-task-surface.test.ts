import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// WS2 keep-alive: when a background agent finishes while the session is IDLE, the
// completion is delivered between turns (via the persistent-query background sink →
// processEvent). Nothing consumes the result, so the agent "never returned the
// result". processEvent must wake the session with a system-generated follow-up so
// the agent reads the output and presents it — but ONLY when idle, only under
// keep-alive, and at most once per task.

type TaskCompletedEvent = {
  type: 'task_completed'
  taskId: string
  status: 'completed' | 'failed' | 'stopped'
  outputFile?: string
  summary?: string
}

describe('background task completion surfacing (idle keep-alive)', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-bgsurface-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string, opts?: { keepAlive?: boolean; processing?: boolean }) {
    const workspace = { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: 'bg surface test' }, workspace as never, { messagesLoaded: true })
    managed.isProcessing = opts?.processing ?? false
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    // keepBackgroundTasksAlive is a readonly field resolved from env at construction;
    // override it per-test to exercise both flag states deterministically.
    ;(sm as unknown as { keepBackgroundTasksAlive: boolean }).keepBackgroundTasksAlive = opts?.keepAlive ?? true
    return managed
  }

  function registerRunningTask(sessionId: string, taskId: string, intent?: string) {
    const managed = (sm as unknown as {
      sessions: Map<string, { backgroundTaskRegistry: Map<string, unknown> }>
    }).sessions.get(sessionId)!
    managed.backgroundTaskRegistry.set(taskId, {
      taskId,
      startTime: Date.now(),
      status: 'running',
      ...(intent ? { intent } : {}),
    })
  }

  function spyOnSendMessage() {
    const calls: Array<{ msg: string; hidden?: boolean }> = []
    ;(sm as unknown as {
      sendMessage: (id: string, msg: string, a?: unknown, s?: unknown, opts?: { hidden?: boolean }) => Promise<void>
    }).sendMessage = async (_id, msg, _a, _s, opts) => {
      calls.push({ msg, hidden: opts?.hidden })
    }
    return calls
  }

  async function fireTaskCompleted(sessionId: string, event: TaskCompletedEvent) {
    const managed = (sm as unknown as { sessions: Map<string, unknown> }).sessions.get(sessionId)!
    await (sm as unknown as { processEvent: (m: unknown, e: unknown) => Promise<void> }).processEvent(managed, event)
  }

  it('surfaces a completed task to an idle keep-alive session with intent + output file', async () => {
    const sessionId = 'idle-complete'
    buildSession(sessionId, { keepAlive: true, processing: false })
    registerRunningTask(sessionId, 'task_1', "Look up today's AI news")
    const calls = spyOnSendMessage()

    await fireTaskCompleted(sessionId, {
      type: 'task_completed',
      taskId: 'task_1',
      status: 'completed',
      outputFile: '/tmp/tasks/task_1.output',
    })

    expect(calls.length).toBe(1)
    expect(calls[0]!.msg).toContain('background-task-completed')
    expect(calls[0]!.msg).toContain("Look up today's AI news")
    expect(calls[0]!.msg).toContain('/tmp/tasks/task_1.output')
    expect(calls[0]!.msg).toContain('present the results')
    // Loop guard: the nudge must tell the agent not to re-spawn a background agent.
    expect(calls[0]!.msg).toContain('Do NOT spawn another background agent')
    // Must be hidden so it never renders as a user-authored transcript bubble.
    expect(calls[0]!.hidden).toBe(true)
  })

  it('does NOT surface while a turn is active (agent sees the notification via the live stream)', async () => {
    const sessionId = 'in-turn'
    buildSession(sessionId, { keepAlive: true, processing: true })
    registerRunningTask(sessionId, 'task_2')
    const calls = spyOnSendMessage()

    await fireTaskCompleted(sessionId, { type: 'task_completed', taskId: 'task_2', status: 'completed' })

    expect(calls).toEqual([])
  })

  it('does NOT surface when keep-alive is OFF', async () => {
    const sessionId = 'keepalive-off'
    buildSession(sessionId, { keepAlive: false, processing: false })
    registerRunningTask(sessionId, 'task_3')
    const calls = spyOnSendMessage()

    await fireTaskCompleted(sessionId, { type: 'task_completed', taskId: 'task_3', status: 'completed' })

    expect(calls).toEqual([])
  })

  it('surfaces at most once even if a duplicate terminal notification arrives', async () => {
    const sessionId = 'dupe'
    buildSession(sessionId, { keepAlive: true, processing: false })
    registerRunningTask(sessionId, 'task_4', 'Investigate flake')
    const calls = spyOnSendMessage()

    await fireTaskCompleted(sessionId, { type: 'task_completed', taskId: 'task_4', status: 'completed' })
    await fireTaskCompleted(sessionId, { type: 'task_completed', taskId: 'task_4', status: 'completed' })

    expect(calls.length).toBe(1)
  })

  it('surfaces a failure with a status-appropriate message', async () => {
    const sessionId = 'failed'
    buildSession(sessionId, { keepAlive: true, processing: false })
    registerRunningTask(sessionId, 'task_5', 'Crunch numbers')
    const calls = spyOnSendMessage()

    await fireTaskCompleted(sessionId, { type: 'task_completed', taskId: 'task_5', status: 'failed' })

    expect(calls.length).toBe(1)
    expect(calls[0]!.msg).toContain('background-task-failed')
    expect(calls[0]!.msg).toContain('did not complete successfully')
    expect(calls[0]!.hidden).toBe(true)
  })
})
