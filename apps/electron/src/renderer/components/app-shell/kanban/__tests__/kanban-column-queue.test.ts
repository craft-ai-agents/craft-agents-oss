import { describe, expect, it, beforeEach } from 'bun:test'
import {
  __resetKanbanColumnQueuesForTests,
  buildColumnRunMessage,
  enqueueKanbanColumnRun,
  shouldAutoRunOnDrop,
} from '../kanban-column-queue'

describe('kanban-column-queue', () => {
  beforeEach(() => {
    __resetKanbanColumnQueuesForTests()
  })

  it('buildColumnRunMessage prepends column prompt with separator', () => {
    expect(
      buildColumnRunMessage({
        columnPrompt: 'Review carefully',
        title: 'Ship kanban',
        goalText: 'All tests green',
      }),
    ).toBe('Review carefully\n\n---\n\nShip kanban\n\nAll tests green')
  })

  it('shouldAutoRunOnDrop: in-progress always; others need prompt', () => {
    expect(shouldAutoRunOnDrop('in-progress', null)).toBe(true)
    expect(shouldAutoRunOnDrop('in-progress', { promptEnabled: false, prompt: '' })).toBe(true)
    expect(shouldAutoRunOnDrop('needs-review', { promptEnabled: true, prompt: 'check' })).toBe(true)
    expect(shouldAutoRunOnDrop('needs-review', { promptEnabled: true, prompt: '  ' })).toBe(false)
    expect(shouldAutoRunOnDrop('todo', { promptEnabled: false, prompt: 'x' })).toBe(false)
  })

  it('enqueue uses sendMessage for plain tiles and skips while processing', async () => {
    const sent: Array<{ id: string; msg: string }> = []
    let processing = false
    const { promise, resolve } = Promise.withResolvers<void>()

    const handlers = {
      sendMessage: (id: string, msg: string) => {
        sent.push({ id, msg })
        processing = true
        resolve()
      },
      runTask: async () => {
        throw new Error('should not runTask')
      },
      isProcessing: () => processing,
      markProcessing: () => {
        processing = true
      },
    }

    enqueueKanbanColumnRun(
      {
        workspaceId: 'ws',
        sessionId: 's1',
        columnId: 'in-progress',
        columnPrompt: '',
        title: 'T',
        goalText: 'G',
        enqueuedAt: 1,
      },
      handlers,
    )
    // Second drop while first is in-flight — loop-guard drops it.
    enqueueKanbanColumnRun(
      {
        workspaceId: 'ws',
        sessionId: 's1',
        columnId: 'in-progress',
        columnPrompt: '',
        title: 'T2',
        goalText: '',
        enqueuedAt: 2,
      },
      handlers,
    )

    await promise
    // Drain microtasks so the second job is evaluated after markProcessing.
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual([{ id: 's1', msg: 'T\n\nG' }])
  })

  it('production-shaped handlers: useRef Set + metaMap OR isProcessing', async () => {
    // Mirrors KanbanBoardContainer: processingRef is immediate; metaMap lags.
    const processingRef = { current: new Set<string>() }
    const metaMap = new Map<string, { isProcessing?: boolean }>()
    const sent: string[] = []
    const { promise, resolve } = Promise.withResolvers<void>()

    const handlers = {
      sendMessage: (id: string) => {
        sent.push(id)
        resolve()
      },
      runTask: async () => {
        throw new Error('runTask should not be used')
      },
      isProcessing: (id: string) =>
        processingRef.current.has(id) || !!metaMap.get(id)?.isProcessing,
      markProcessing: (id: string) => {
        processingRef.current.add(id)
        // metaMap intentionally NOT updated yet — simulates React batch lag
      },
      onError: (_err: unknown, job: { sessionId: string }) => {
        processingRef.current.delete(job.sessionId)
      },
    }

    enqueueKanbanColumnRun(
      {
        workspaceId: 'ws',
        sessionId: 's-lag',
        columnId: 'in-progress',
        columnPrompt: '',
        title: 'T',
        goalText: 'G',
        enqueuedAt: 1,
      },
      handlers,
    )
    enqueueKanbanColumnRun(
      {
        workspaceId: 'ws',
        sessionId: 's-lag',
        columnId: 'in-progress',
        columnPrompt: '',
        title: 'T',
        goalText: 'G2',
        enqueuedAt: 2,
      },
      handlers,
    )

    await promise
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual(['s-lag'])
    expect(processingRef.current.has('s-lag')).toBe(true)
  })

  it('enqueue uses runTask for spec-backed tiles', async () => {
    const runs: Array<{ slug: string; sessionId: string }> = []
    const { promise, resolve } = Promise.withResolvers<void>()
    enqueueKanbanColumnRun(
      {
        workspaceId: 'ws',
        sessionId: 'orch-1',
        columnId: 'in-progress',
        columnPrompt: 'ignored for runTask path body',
        title: 'Spec task',
        goalText: 'goal',
        taskSlug: 'my-task',
        enqueuedAt: 1,
      },
      {
        sendMessage: () => {
          throw new Error('should not sendMessage')
        },
        runTask: async (_ws, args) => {
          runs.push({ slug: args.slug, sessionId: args.orchestratorSessionId })
          resolve()
        },
        isProcessing: () => false,
      },
    )
    await promise
    expect(runs).toEqual([{ slug: 'my-task', sessionId: 'orch-1' }])
  })
})
