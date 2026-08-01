import { describe, expect, it } from 'bun:test'
import {
  completeBackgroundTask,
  listBackgroundTasks,
  markOrphanedBackgroundTasks,
  recordBackgroundTaskProgress,
  recordWorkflowAgentCompleted,
  registerBackgroundTask,
  type BackgroundTaskState,
} from './background-task-registry'

function createState(): BackgroundTaskState {
  return {
    backgroundTaskOutputs: new Map(),
    backgroundTaskRegistry: new Map(),
  }
}

describe('background task registry', () => {
  it('tracks launch, workflow progress, and task progress', () => {
    const state = createState()
    registerBackgroundTask(state, {
      taskId: 'task-1',
      toolUseId: 'tool-1',
      workflowId: 'wf-1',
      kind: 'workflow',
      intent: 'Research',
    }, 100)

    recordWorkflowAgentCompleted(state, 'wf-1')
    recordBackgroundTaskProgress(state, 'tool-1', 12, 200)

    expect(state.backgroundTaskRegistry.get('task-1')).toMatchObject({
      status: 'running',
      agentsCompleted: 1,
      elapsedSeconds: 12,
      lastProgressAt: 200,
    })
  })

  it('resolves workflow completion by workflow id and detects duplicates', () => {
    const state = createState()
    const index = new Map<string, string>()
    registerBackgroundTask(state, { taskId: 'task-1', workflowId: 'wf-1', intent: 'Fan out' }, 100)

    const first = completeBackgroundTask(state, index, 'session-1', {
      taskId: 'wf-1',
      status: 'completed',
      outputFile: '/tmp/output',
    }, 200)
    const second = completeBackgroundTask(state, index, 'session-1', {
      taskId: 'wf-1',
      status: 'completed',
    }, 300)

    expect(first).toEqual({ wasAlreadyTerminal: false, taskIntent: 'Fan out', outputFile: '/tmp/output' })
    expect(second.wasAlreadyTerminal).toBe(true)
    expect(state.backgroundTaskRegistry.get('task-1')?.completedAt).toBe(300)
    expect(index.get('wf-1')).toBe('session-1')
  })

  it('orphans running tasks and returns defensive, newest-first snapshots', () => {
    const state = createState()
    registerBackgroundTask(state, { taskId: 'older' }, 100)
    registerBackgroundTask(state, { taskId: 'newer' }, 200)

    expect(markOrphanedBackgroundTasks(state, 300)).toBe(2)
    const listed = listBackgroundTasks(state)
    expect(listed.map((task) => task.taskId)).toEqual(['newer', 'older'])
    expect(listed.every((task) => task.status === 'orphaned' && task.completedAt === 300)).toBe(true)

    listed[0]!.status = 'running'
    expect(state.backgroundTaskRegistry.get('newer')?.status).toBe('orphaned')
  })
})
