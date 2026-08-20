/**
 * Jotai atoms for the live Kanban board's view state.
 *
 * The project filter persists across board⇄list remounts within a session (the
 * board unmounts when the user flips to the list view), so a filter the user set
 * stays applied when they return.
 *
 * Board column layout (labels, colors, collapsed, prompts, groupBy) lives in
 * `{workspace}/kanban/config.json` via kanban RPC — see KanbanBoardContainer.
 * The color/status atoms below remain as legacy localStorage mirrors consumed by
 * Appearance settings and as a one-time migration source into the workspace file.
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
 * Per-column color overrides (hex) — legacy localStorage mirror.
 * Board UI prefers `{workspace}/kanban/config.json`; this atom is still written on
 * color change so Appearance settings stay coherent, and is read once to migrate
 * into the workspace file on first board load.
 */
export const kanbanColumnColorsAtom = atomWithStorage<Partial<Record<KanbanColumnId, string>>>(
  'craft-kanban-column-colors',
  {}
)

/** Whether active (in-progress) tiles get the live-pulse treatment. Default on. */
export const kanbanLivePulseAtom = atomWithStorage<boolean>('craft-kanban-live-pulse', true)

/**
 * Per-column status auto-applied when a task is dropped into that column.
 * Prefer column.dropStatusId from workspace kanban config; this atom is the
 * legacy fallback / Appearance settings mirror.
 */
export const kanbanColumnStatusAtom = atomWithStorage<Partial<Record<KanbanColumnId, string>>>(
  'craft-kanban-column-status',
  {}
)

