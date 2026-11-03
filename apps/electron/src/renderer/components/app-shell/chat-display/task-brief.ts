/**
 * What an unrun task session shows instead of the new-chat empty state: the task's own content,
 * read from its task.yaml (`tasks:get` returns the spec untyped, so it is checked here).
 */

export interface TaskBriefContent {
  goal: string
  acceptanceCriteria?: string
  /** Subtask titles in spec order; empty when the only subtask repeats the task itself. */
  subtasks: string[]
}

interface SpecNode {
  id: string
  title?: unknown
  prompt?: unknown
}

function isSpecNode(value: unknown): value is SpecNode {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The brief for a task spec, or null when it has no goal to show. */
export function taskBriefFromSpec(spec: unknown): TaskBriefContent | null {
  if (!spec || typeof spec !== 'object') return null
  const raw = spec as { title?: unknown; goal?: unknown; acceptance_criteria?: unknown; nodes?: unknown }
  const goal = text(raw.goal)
  if (!goal) return null
  const acceptanceCriteria = text(raw.acceptance_criteria)
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isSpecNode) : []
  const titles = nodes.map(node => text(node.title) || node.id)
  // `create_task` builds its single subtask from the task itself (the task's title, the goal as
  // its prompt), so listing it would only repeat the brief.
  const only = nodes.length === 1 ? nodes[0] : undefined
  const repeatsTask = !!only && (titles[0] === text(raw.title) || text(only.prompt) === goal)
  return {
    goal,
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    subtasks: repeatsTask ? [] : titles,
  }
}
