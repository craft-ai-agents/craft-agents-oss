import type { KanbanTask } from './types'
import type { KanbanProjectGroup } from './KanbanColumn'

/** Fixed Display.groupBy=priority order (urgent → none). */
export const PRIORITY_GROUP_ORDER = ['urgent', 'high', 'medium', 'low', 'none'] as const

/** Pseudo projectId prefix used so drop targets can assign priority (container-side). */
export const PRIORITY_GROUP_ID_PREFIX = '__priority_' as const

export function priorityGroupId(priority: string): string {
  return `${PRIORITY_GROUP_ID_PREFIX}${priority}`
}

/**
 * Decode a pseudo group id back to a priority value.
 * Returns null when the id is not a priority pseudo group.
 */
export function parsePriorityGroupId(projectId: string | null | undefined): string | null {
  if (typeof projectId !== 'string' || !projectId.startsWith(PRIORITY_GROUP_ID_PREFIX)) return null
  return projectId.slice(PRIORITY_GROUP_ID_PREFIX.length)
}

/**
 * Bucket tasks into priority subsections for a single column.
 * Known priorities keep PRIORITY_GROUP_ORDER; unknown values append after.
 * Empty buckets are omitted. Mirrors the production KanbanBoard memo (B6 / FR-30).
 */
export function buildPriorityGroups(
  tasks: readonly KanbanTask[],
  t: (key: string, opts?: { defaultValue?: string }) => string,
): KanbanProjectGroup[] {
  const byPrio = new Map<string, KanbanTask[]>()
  for (const task of tasks) {
    const key = (task.priority ?? 'none') as string
    const list = byPrio.get(key)
    if (list) list.push(task)
    else byPrio.set(key, [task])
  }

  const groups: KanbanProjectGroup[] = []
  for (const prio of PRIORITY_GROUP_ORDER) {
    const list = byPrio.get(prio)
    if (!list || list.length === 0) continue
    groups.push({
      projectId: priorityGroupId(prio),
      name: t(`priority.${prio}`, { defaultValue: prio }),
      tasks: list,
    })
    byPrio.delete(prio)
  }
  // Unknown priorities at the end (defensive).
  for (const [prio, list] of byPrio) {
    groups.push({ projectId: priorityGroupId(prio), name: prio, tasks: list })
  }
  return groups
}
