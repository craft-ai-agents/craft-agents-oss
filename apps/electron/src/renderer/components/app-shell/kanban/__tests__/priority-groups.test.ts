import { describe, expect, it } from 'bun:test'
import type { SessionPriority } from '@craft-agent/shared/protocol/dto'
import type { KanbanTask } from '../types'
import {
  buildPriorityGroups,
  parsePriorityGroupId,
  priorityGroupId,
} from '../priority-groups'

const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key

function task(id: string, priority?: SessionPriority | string): KanbanTask {
  return {
    id,
    title: id,
    column: 'todo',
    statusId: 'todo',
    model: 'm',
    subtasks: [],
    // Cast lets the unknown-priority regression case pass a non-union value.
    priority: priority as SessionPriority | undefined,
  }
}

describe('B6 priority groups (board Display.groupBy=priority)', () => {
  it('groups in fixed priority order and skips empty buckets', () => {
    const groups = buildPriorityGroups(
      [task('a', 'low'), task('b', 'urgent'), task('c', 'none'), task('d', 'urgent'), task('e', 'medium')],
      t,
    )
    expect(groups.map(g => g.projectId)).toEqual([
      '__priority_urgent',
      '__priority_medium',
      '__priority_low',
      '__priority_none',
    ])
    expect(groups[0]!.tasks.map(x => x.id)).toEqual(['b', 'd'])
  })

  it('task without priority lands in the none group', () => {
    const groups = buildPriorityGroups([task('a')], t)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.projectId).toBe('__priority_none')
    expect(groups[0]!.name).toBe('none')
  })

  it('unknown priority value appears after all known priorities', () => {
    const groups = buildPriorityGroups([task('a', 'p4'), task('b', 'high')], t)
    expect(groups.map(g => g.projectId)).toEqual(['__priority_high', '__priority_p4'])
    expect(groups[1]!.name).toBe('p4')
  })

  it('empty task list yields zero groups', () => {
    expect(buildPriorityGroups([], t)).toEqual([])
  })

  it('parsePriorityGroupId round-trips known and unknown values', () => {
    expect(parsePriorityGroupId(priorityGroupId('urgent'))).toBe('urgent')
    expect(parsePriorityGroupId(priorityGroupId('none'))).toBe('none')
    expect(parsePriorityGroupId(priorityGroupId('p4'))).toBe('p4')
    expect(parsePriorityGroupId('real-project')).toBeNull()
    expect(parsePriorityGroupId(null)).toBeNull()
    expect(parsePriorityGroupId(undefined)).toBeNull()
  })
})
