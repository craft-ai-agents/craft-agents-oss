/**
 * Browser-safe Kanban configuration contracts and pure transforms.
 * Disk-backed configuration remains available from the node-only kanban entry.
 */
export type {
  KanbanBoardColumnConfig,
  KanbanBoardConfig,
  KanbanGroupBy,
} from './types.ts'

export {
  BUILTIN_KANBAN_COLUMN_IDS,
  getDefaultKanbanBoardConfig,
  normalizeKanbanBoardConfig,
  patchKanbanColumn,
  type BuiltinKanbanColumnId,
} from './config.ts'
