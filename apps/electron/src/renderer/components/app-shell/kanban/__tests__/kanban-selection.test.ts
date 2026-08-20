import { describe, expect, it } from 'bun:test'
import type { KanbanProjectGroup } from '../KanbanColumn'
import { flattenVisibleKanbanTaskIds } from '../kanban-selection'
import type { KanbanColumnMeta, KanbanTask } from '../types'

function task(id: string, column: string): KanbanTask {
  return {
    id,
    title: id,
    column,
    statusId: column,
    model: 'test',
    subtasks: [],
  }
}

function group(projectId: string | null, tasks: KanbanTask[]): KanbanProjectGroup {
  return { projectId, name: projectId ?? 'none', tasks }
}

describe('kanban visible selection ordering', () => {
  it('flattens columns and ungrouped tasks in rendered order while omitting collapsed columns', () => {
    const columns: KanbanColumnMeta[] = [
      { id: 'todo' },
      { id: 'hidden', collapsed: true },
      { id: 'done' },
    ]
    const tasksByColumn = new Map([
      ['todo', [task('a', 'todo'), task('b', 'todo')]],
      ['hidden', [task('hidden', 'hidden')]],
      ['done', [task('c', 'done')]],
    ])

    expect(
      flattenVisibleKanbanTaskIds(columns, tasksByColumn, null, null),
    ).toEqual(['a', 'b', 'c'])
  })

  it('uses rendered section order, omits collapsed groups, and lets priority groups win', () => {
    const columns: KanbanColumnMeta[] = [{ id: 'todo' }]
    const a = task('a', 'todo')
    const b = task('b', 'todo')
    const c = task('c', 'todo')
    const tasksByColumn = new Map([['todo', [a, b, c]]])
    const projectGroups = new Map([
      ['todo', [group('project-a', [a]), group('project-b', [b, c])]],
    ])
    const priorityGroups = new Map([
      ['todo', [group('__priority_high', [c]), group('__priority_low', [b, a])]],
    ])

    expect(
      flattenVisibleKanbanTaskIds(
        columns,
        tasksByColumn,
        projectGroups,
        priorityGroups,
        new Set(['__priority_low']),
      ),
    ).toEqual(['c'])
  })
})
