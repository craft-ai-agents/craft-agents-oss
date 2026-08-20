/**
 * Workspace-level Kanban board configuration.
 * Persisted at `{workspaceRoot}/kanban/config.json`.
 */

export type KanbanGroupBy = 'none' | 'project'

export interface KanbanBoardColumnConfig {
  id: string
  /** User override for the header label (built-ins fall back to i18n when absent). */
  label?: string
  color?: string
  collapsed?: boolean
  promptEnabled?: boolean
  prompt?: string
  dropStatusId?: string
  /** Built-in columns cannot be removed. */
  isBuiltIn?: boolean
}

export interface KanbanBoardConfig {
  version: 1
  columns: KanbanBoardColumnConfig[]
  /** Default grouping for the board. Defaults to `project` when absent. */
  groupBy?: KanbanGroupBy
}
