import { describe, expect, it } from 'bun:test'
import { DEFAULT_BUILTIN_STATUS_PALETTE } from '@craft-agent/shared/colors'
import { DEFAULT_KANBAN_COLUMN_COLORS } from '../kanban-colors'

describe('Kanban column palette', () => {
  it('projects the shared canonical palette for built-in status columns', () => {
    expect(DEFAULT_KANBAN_COLUMN_COLORS).toEqual({
      backlog: DEFAULT_BUILTIN_STATUS_PALETTE.backlog.light,
      todo: DEFAULT_BUILTIN_STATUS_PALETTE.todo.light,
      'in-progress': DEFAULT_BUILTIN_STATUS_PALETTE['in-progress'].light,
      'needs-review': DEFAULT_BUILTIN_STATUS_PALETTE['needs-review'].light,
      done: DEFAULT_BUILTIN_STATUS_PALETTE.done.light,
    })
  })
})
