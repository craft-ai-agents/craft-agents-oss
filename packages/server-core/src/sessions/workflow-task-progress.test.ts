import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Workflow visualization: a launched Workflow surfaces as a background task with
// kind 'workflow' + a wf_ run id, and SubagentStop-derived `workflow_agent_completed`
// events bump a live completed-agent counter. Completion may key on either the
// returned Task ID or the wf_ run id, so the registry must resolve both.

describe('workflow background-task progress', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-wf-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: 'wf test' }, workspace as never, { messagesLoaded: true })
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    // Stub sendMessage so the idle completion auto-surface doesn't run the full turn path.
    ;(sm as unknown as { sendMessage: (...a: unknown[]) => Promise<void> }).sendMessage = async () => {}
    return managed
  }

  function fire(sessionId: string, event: Record<string, unknown>) {
    const managed = (sm as unknown as { sessions: Map<string, unknown> }).sessions.get(sessionId)!
    return (sm as unknown as { processEvent: (m: unknown, e: unknown) => Promise<void> }).processEvent(managed, event)
  }

  function tasks(sessionId: string) {
    return (sm as unknown as { listBackgroundTasks: (id: string) => Array<Record<string, unknown>> }).listBackgroundTasks(sessionId)
  }

  it('registers a workflow launch with workflowId and a zeroed agent count', async () => {
    const sid = 'wf-register'
    buildSession(sid)
    await fire(sid, {
      type: 'task_backgrounded', sessionId: sid, toolUseId: 'tu_1',
      taskId: 'w5x', kind: 'workflow', workflowId: 'wf_1', intent: 'PII sweep',
    })

    const t = tasks(sid).find(x => x.taskId === 'w5x')!
    expect(t).toBeDefined()
    expect(t.workflowId).toBe('wf_1')
    expect(t.agentsCompleted).toBe(0)
    expect(t.status).toBe('running')
  })

  it('increments the completed-agent count on workflow_agent_completed', async () => {
    const sid = 'wf-count'
    buildSession(sid)
    await fire(sid, { type: 'task_backgrounded', sessionId: sid, toolUseId: 'tu_1', taskId: 'w5x', kind: 'workflow', workflowId: 'wf_1' })

    await fire(sid, { type: 'workflow_agent_completed', sessionId: sid, workflowId: 'wf_1', agentId: 'a1' })
    await fire(sid, { type: 'workflow_agent_completed', sessionId: sid, workflowId: 'wf_1', agentId: 'a2' })
    // An unrelated workflow id must not affect this chip.
    await fire(sid, { type: 'workflow_agent_completed', sessionId: sid, workflowId: 'wf_other', agentId: 'a3' })

    expect(tasks(sid).find(x => x.taskId === 'w5x')!.agentsCompleted).toBe(2)
  })

  it('resolves completion keyed on the wf_ run id (not just the Task ID)', async () => {
    const sid = 'wf-complete-by-wfid'
    buildSession(sid)
    await fire(sid, { type: 'task_backgrounded', sessionId: sid, toolUseId: 'tu_1', taskId: 'w5x', kind: 'workflow', workflowId: 'wf_1' })

    // Completion notification arrives under the wf_ id, not the returned Task ID.
    await fire(sid, { type: 'task_completed', sessionId: sid, taskId: 'wf_1', status: 'completed' })

    const t = tasks(sid).find(x => x.taskId === 'w5x')!
    expect(t.status).toBe('completed')
  })
})
