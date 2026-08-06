/**
 * Jotai atoms for the live Kanban board's view state.
 *
 * The project filter persists across board⇄list remounts within a session (the
 * board unmounts when the user flips to the list view), so a filter the user set
 * stays applied when they return.
 *
 * Column colors and the live-pulse toggle are appearance *preferences*, so they
 * persist to localStorage via `atomWithStorage` (same pattern as
 * `workspaceAvatarColorsAtom`) — reactive, multi-window, no RPC/disk-config. They
 * are per-machine, not workspace-synced.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { KanbanColumnId, TaskEditorTarget } from '@/components/app-shell/kanban/types'

/** Selected project ids to filter the board by. Empty array = all projects. */
export const kanbanProjectFilterAtom = atom<string[]>([])

/**
 * The board pane's Task-editor overlay target (null = closed). An atom rather than
 * board-local state so surfaces outside the board — e.g. the chat header's
 * "Edit task" button — can point the editor at a session and then navigate to the
 * board route, where the overlay opens prefilled.
 */
export const kanbanEditorTargetAtom = atom<TaskEditorTarget | null>(null)

/**
 * Per-column color overrides (hex). A column absent from the map falls back to
 * `DEFAULT_KANBAN_COLUMN_COLORS` (see `kanban/kanban-colors.ts`). Resetting a
 * column in Settings deletes its key here.
 */
export const kanbanColumnColorsAtom = atomWithStorage<Partial<Record<KanbanColumnId, string>>>(
  'craft-kanban-column-colors',
  {}
)

/** Whether active (in-progress) tiles get the live-pulse treatment. Default on. */
export const kanbanLivePulseAtom = atomWithStorage<boolean>('craft-kanban-live-pulse', true)

/**
 * Per-column status auto-applied when a task is dropped into that column. A
 * column absent from the map (or mapped to a status that no longer exists)
 * leaves the task's status untouched on move.
 */
export const kanbanColumnStatusAtom = atomWithStorage<Partial<Record<KanbanColumnId, string>>>(
  'craft-kanban-column-status',
  {}
)
