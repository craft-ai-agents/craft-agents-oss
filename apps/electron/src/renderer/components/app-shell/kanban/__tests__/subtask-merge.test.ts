import { describe, it, expect } from 'bun:test'
import { mergeSubtaskRows, type SpecNodeSummary, type SubtaskChildRow } from '../subtask-merge'
import { quickAddNodeId } from '../task-spec-form'

const child = (over: Partial<SubtaskChildRow> & { id: string }): SubtaskChildRow => ({
  title: over.id,
  runState: 'pending',
  model: 'm-child',
  ...over,
})

describe('mergeSubtaskRows', () => {
  it('without a spec, rows are the children sorted by creation time', () => {
    const rows = mergeSubtaskRows(
      undefined,
      [child({ id: 'c', createdAt: 3 }), child({ id: 'a', createdAt: 1 }), child({ id: 'b', createdAt: 2 })],
      'm-fallback'
    )
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(rows.every(r => r.sessionId === r.id)).toBe(true)
  })

  it('authored-but-never-run nodes render as synthetic pending rows (no session)', () => {
    const nodes: SpecNodeSummary[] = [
      { id: 'generate', title: 'Generate marker', model: 'm-node' },
      { id: 'verify', title: 'Verify marker received' },
    ]
    const rows = mergeSubtaskRows(nodes, [], 'm-fallback')
    expect(rows).toEqual([
      { id: 'node:generate', title: 'Generate marker', runState: 'pending', model: 'm-node' },
      { id: 'node:verify', title: 'Verify marker received', runState: 'pending', model: 'm-fallback' },
    ])
  })

  it('binds each node to its latest run child; superseded earlier-run children collapse', () => {
    const nodes: SpecNodeSummary[] = [{ id: 'generate', title: 'Generate' }]
    const rows = mergeSubtaskRows(
      nodes,
      [
        child({ id: 'old-run', taskNodeId: 'generate', runState: 'failed', createdAt: 1 }),
        child({ id: 'new-run', taskNodeId: 'generate', runState: 'done', createdAt: 2 }),
      ],
      'm'
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 'new-run', runState: 'done' })
  })

  it('an adopted quick-add node binds back to its original session via the qa- id', () => {
    const sessionId = '260703-agile-moor'
    const nodes: SpecNodeSummary[] = [{ id: quickAddNodeId(sessionId), title: 'Task 2' }]
    const rows = mergeSubtaskRows(nodes, [child({ id: sessionId, title: 'Task 2', runState: 'done' })], 'm')
    expect(rows).toEqual([{ id: sessionId, sessionId, title: 'Task 2', runState: 'done', model: 'm-child' }])
  })

  it('a run child supersedes the adopted quick-add session for the same qa- node', () => {
    const sessionId = '260703-agile-moor'
    const qaNode = quickAddNodeId(sessionId)
    const rows = mergeSubtaskRows(
      [{ id: qaNode, title: 'Task 2' }],
      [
        child({ id: sessionId, title: 'Task 2', runState: 'done', createdAt: 1 }),
        child({ id: 'run-child', taskNodeId: qaNode, runState: 'running', createdAt: 2 }),
      ],
      'm'
    )
    // One row for the node: the run child. The pre-run quick-add session collapses into it
    // (it is that node's earlier execution), never a duplicate "Task 2" row.
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 'run-child', runState: 'running' })
  })

  it('unadopted quick-adds and children of removed nodes append after the node rows', () => {
    const nodes: SpecNodeSummary[] = [{ id: 'generate', title: 'Generate' }]
    const rows = mergeSubtaskRows(
      nodes,
      [
        child({ id: 'quick-add', title: 'Task 3', createdAt: 2 }),
        child({ id: 'orphan', taskNodeId: 'removed-node', runState: 'done', createdAt: 1 }),
      ],
      'm'
    )
    expect(rows.map(r => r.id)).toEqual(['node:generate', 'orphan', 'quick-add'])
  })
})
