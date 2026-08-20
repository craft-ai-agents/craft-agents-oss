import { describe, expect, it } from 'bun:test'
import {
  emptyTableGroupBuckets,
  withEmptyTableGroups,
  type TableGroup,
} from '../table-empty-groups'

const t = (key: string) => key

function options(groupBy: 'status' | 'priority' | 'project' | 'dueDate' | 'label' | 'none') {
  return {
    groupBy,
    priorities: ['urgent', 'high', 'medium', 'low', 'none'] as const,
    statusById: new Map([
      ['todo', { id: 'todo', label: 'Todo' }],
      ['done', { id: 'done', label: 'Done' }],
    ]),
    projectNameById: new Map([['project-1', 'Project 1']]),
    labelById: new Map([['label-1', 'Label 1']]),
    t,
  }
}

describe('empty table groups', () => {
  it('adds configured status buckets while preserving populated groups', () => {
    const populated: TableGroup<string>[] = [
      { bucket: { key: 'status:todo', label: 'Todo', count: 1 }, items: ['session-1'] },
    ]

    const groups = withEmptyTableGroups(
      populated,
      true,
      emptyTableGroupBuckets(options('status')),
    )

    expect(groups).toEqual([
      { bucket: { key: 'status:todo', label: 'Todo', count: 1 }, items: ['session-1'] },
      { bucket: { key: 'status:done', label: 'Done', count: 0 }, items: [] },
    ])
  })

  it('does not add empty buckets when Display disables them', () => {
    const populated: TableGroup<string>[] = [
      { bucket: { key: 'priority:high', label: 'High', count: 1 }, items: ['session-1'] },
    ]

    expect(withEmptyTableGroups(populated, false, emptyTableGroupBuckets(options('priority')))).toEqual(populated)
  })

  it('includes the fixed due-date buckets and synthetic unassigned project bucket', () => {
    expect(emptyTableGroupBuckets(options('dueDate')).map((bucket) => bucket.key)).toEqual([
      'due:overdue',
      'due:today',
      'due:this_week',
      'due:later',
      'due:none',
    ])
    expect(emptyTableGroupBuckets(options('project')).map((bucket) => bucket.key)).toEqual([
      'project:',
      'project:project-1',
    ])
  })
})
