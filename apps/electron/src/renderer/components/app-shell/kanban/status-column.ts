import type { BuiltInKanbanColumnId, KanbanColumnId, KanbanColumnMeta } from './types'

/**
 * The board's default, ordered columns. Typed with the built-in id + a required
 * `labelKey` so consumers that only ever iterate this constant (Settings, the
 * color/status maps) keep exhaustive, non-optional access even though the general
 * `KanbanColumnMeta` widened `id` to string and made `labelKey` optional.
 */
export const KANBAN_COLUMNS: readonly (KanbanColumnMeta & {
  id: BuiltInKanbanColumnId
  labelKey: string
})[] = [
  { id: 'todo', labelKey: 'kanban.column.todo' },
  { id: 'in-progress', labelKey: 'kanban.column.inProgress' },
  { id: 'done', labelKey: 'kanban.column.done' },
] as const

/**
 * Default board placement for a status id.
 *
 * Placement (column) is independent from the status badge, so this is only the
 * *default* — a task may carry a different `column` (e.g. a `needs-review` task
 * parked in In Progress). Kept as one small function so the mapping is trivial
 * to change when the wiring phase introduces real, user-defined statuses.
 */
export function statusToColumn(statusId: string): KanbanColumnId {
  switch (statusId) {
    case 'in-progress':
    case 'needs-review':
      return 'in-progress'
    case 'done':
    case 'cancelled':
      return 'done'
    case 'todo':
    default:
      return 'todo'
  }
}
