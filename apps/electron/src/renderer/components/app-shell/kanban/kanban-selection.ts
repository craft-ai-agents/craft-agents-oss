import type { KanbanProjectGroup } from './KanbanColumn'
import type { KanbanColumnId, KanbanColumnMeta, KanbanTask } from './types'

/** One visual ordering for board selection, range selection, and bulk targets. */
export function flattenVisibleKanbanTaskIds(
  columns: readonly KanbanColumnMeta[],
  tasksByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanTask[]>,
  groupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  priorityGroupsByColumn: ReadonlyMap<KanbanColumnId, readonly KanbanProjectGroup[]> | null,
  collapsedGroupKeys?: ReadonlySet<string>,
): string[] {
  const ids: string[] = []
  for (const column of columns) {
    if (column.collapsed ?? column.defaultCollapsed ?? false) continue
    const sections =
      priorityGroupsByColumn?.get(column.id) ??
      groupsByColumn?.get(column.id)
    if (sections) {
      for (const section of sections) {
        const groupKey = section.projectId ?? '__none__'
        if (collapsedGroupKeys?.has(groupKey)) continue
        for (const task of section.tasks) ids.push(task.id)
      }
      continue
    }
    for (const task of tasksByColumn.get(column.id) ?? []) ids.push(task.id)
  }
  return ids
}
