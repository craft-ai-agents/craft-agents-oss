import { DEFAULT_BUILTIN_STATUS_PALETTE } from '@craft-agent/shared/colors'
import type { BuiltInKanbanColumnId } from './types'

/**
 * Renderer projection of the shared built-in status palette. Per-column
 * overrides remain in `kanbanColumnColorsAtom` and take precedence in the
 * existing hooks and persisted board configuration.
 *
 * `todo` and `done` retain their explicit legacy semantics if a future shared
 * palette omits either status.
 */
const TODO_FALLBACK = '#3b82f6'
const DONE_FALLBACK = '#10b981'

export const DEFAULT_KANBAN_COLUMN_COLORS: Record<BuiltInKanbanColumnId, string> = {
  backlog: DEFAULT_BUILTIN_STATUS_PALETTE.backlog.light,
  todo: DEFAULT_BUILTIN_STATUS_PALETTE.todo?.light ?? TODO_FALLBACK,
  'in-progress': DEFAULT_BUILTIN_STATUS_PALETTE['in-progress'].light,
  'needs-review': DEFAULT_BUILTIN_STATUS_PALETTE['needs-review'].light,
  done: DEFAULT_BUILTIN_STATUS_PALETTE.done?.light ?? DONE_FALLBACK,
}
