import type { BuiltInKanbanColumnId, KanbanColumnId, KanbanColumnMeta } from './types'

/** Expanded column min-width so five columns fit ~1400px with gap. */
export const KANBAN_COLUMN_MIN_WIDTH_PX = 220

/** Collapsed backlog rail width. */
export const KANBAN_COLLAPSED_WIDTH_PX = 48

/**
 * The board's default, ordered columns. Typed with the built-in id + a required
 * `labelKey` so consumers that only ever iterate this constant (Settings, the
 * color/status maps) keep exhaustive, non-optional access even though the general
 * `KanbanColumnMeta` widened `id` to string and made `labelKey` optional.
 *
 * `dropStatusId` defaults to the column id. Backlog starts collapsed.
 */
export const KANBAN_COLUMNS: readonly (KanbanColumnMeta & {
  id: BuiltInKanbanColumnId
  labelKey: string
  dropStatusId: BuiltInKanbanColumnId
})[] = [
  {
    id: 'backlog',
    labelKey: 'kanban.column.backlog',
    defaultCollapsed: true,
    dropStatusId: 'backlog',
    isBuiltIn: true,
  },
  {
    id: 'todo',
    labelKey: 'kanban.column.todo',
    dropStatusId: 'todo',
    isBuiltIn: true,
  },
  {
    id: 'in-progress',
    labelKey: 'kanban.column.inProgress',
    dropStatusId: 'in-progress',
    isBuiltIn: true,
  },
  {
    id: 'needs-review',
    labelKey: 'kanban.column.needsReview',
    dropStatusId: 'needs-review',
    isBuiltIn: true,
  },
  {
    id: 'done',
    labelKey: 'kanban.column.done',
    dropStatusId: 'done',
    isBuiltIn: true,
  },
] as const

/**
 * Default board placement for a status id.
 *
 * Placement (column) is independent from the status badge, so this is only the
 * *default* — a task may carry a different `column`. Kept as one small function
 * so the mapping is trivial to change when user-defined statuses appear.
 */
export function statusToColumn(statusId: string): KanbanColumnId {
  switch (statusId) {
    case 'backlog':
      return 'backlog'
    case 'todo':
      return 'todo'
    case 'in-progress':
      return 'in-progress'
    case 'needs-review':
      return 'needs-review'
    case 'done':
    case 'cancelled':
      return 'done'
    default:
      return 'todo'
  }
}
