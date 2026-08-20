import { DEFAULT_BUILTIN_STATUS_PALETTE } from '../colors/defaults.ts'
import type { KanbanBoardColumnConfig, KanbanBoardConfig, KanbanGroupBy } from './types.ts'

/** Built-in column ids in left-to-right board order. */
export const BUILTIN_KANBAN_COLUMN_IDS = [
  'backlog',
  'todo',
  'in-progress',
  'needs-review',
  'done',
] as const

export type BuiltinKanbanColumnId = (typeof BUILTIN_KANBAN_COLUMN_IDS)[number]

export function getDefaultKanbanBoardConfig(): KanbanBoardConfig {
  return {
    version: 1,
    groupBy: 'project',
    columns: BUILTIN_KANBAN_COLUMN_IDS.map((id) => ({
      id,
      color: DEFAULT_BUILTIN_STATUS_PALETTE[id].light,
      collapsed: id === 'backlog',
      dropStatusId: id,
      isBuiltIn: true,
      promptEnabled: false,
      prompt: '',
    })),
  }
}

function isGroupBy(value: unknown): value is KanbanGroupBy {
  return value === 'none' || value === 'project'
}

function normalizeColumn(raw: unknown, index: number): KanbanBoardColumnConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const columnRecord = raw as Record<string, unknown>
  const id =
    typeof columnRecord.id === 'string' && columnRecord.id.trim()
      ? columnRecord.id.trim()
      : `col-${index}`
  const isBuiltIn =
    typeof columnRecord.isBuiltIn === 'boolean'
      ? columnRecord.isBuiltIn
      : (BUILTIN_KANBAN_COLUMN_IDS as readonly string[]).includes(id)

  const column: KanbanBoardColumnConfig = {
    id,
    isBuiltIn,
  }

  if (typeof columnRecord.label === 'string' && columnRecord.label.trim()) column.label = columnRecord.label.trim()
  if (typeof columnRecord.color === 'string' && columnRecord.color.trim()) column.color = columnRecord.color.trim()
  if (typeof columnRecord.collapsed === 'boolean') column.collapsed = columnRecord.collapsed
  else if (id === 'backlog' && isBuiltIn) column.collapsed = true
  if (typeof columnRecord.promptEnabled === 'boolean') column.promptEnabled = columnRecord.promptEnabled
  if (typeof columnRecord.prompt === 'string') column.prompt = columnRecord.prompt
  if (typeof columnRecord.dropStatusId === 'string' && columnRecord.dropStatusId.trim()) {
    column.dropStatusId = columnRecord.dropStatusId.trim()
  } else if (isBuiltIn) {
    column.dropStatusId = id
  }

  return column
}

/**
 * Normalize a raw JSON object into a valid KanbanBoardConfig.
 * Ensures all built-ins exist in canonical order and retains custom columns.
 */
export function normalizeKanbanBoardConfig(raw: unknown): KanbanBoardConfig {
  const defaults = getDefaultKanbanBoardConfig()
  if (!raw || typeof raw !== 'object') return defaults

  const object = raw as Record<string, unknown>
  const rawColumns = Array.isArray(object.columns) ? object.columns : []
  const parsed = rawColumns
    .map((column, index) => normalizeColumn(column, index))
    .filter((column): column is KanbanBoardColumnConfig => column !== null)

  const byId = new Map(parsed.map((column) => [column.id, column]))
  const columns: KanbanBoardColumnConfig[] = []

  for (const id of BUILTIN_KANBAN_COLUMN_IDS) {
    const existing = byId.get(id)
    const fallback = defaults.columns.find((column) => column.id === id)!
    if (existing) {
      columns.push({
        ...fallback,
        ...existing,
        id,
        isBuiltIn: true,
        dropStatusId: existing.dropStatusId ?? id,
        collapsed: existing.collapsed ?? fallback.collapsed,
        color: existing.color ?? fallback.color,
      })
      byId.delete(id)
    } else {
      columns.push({ ...fallback })
    }
  }

  for (const column of parsed) {
    if (!byId.has(column.id)) continue
    columns.push({ ...column, isBuiltIn: false })
    byId.delete(column.id)
  }

  return {
    version: 1,
    groupBy: isGroupBy(object.groupBy) ? object.groupBy : 'project',
    columns,
  }
}

/** Apply a partial column update while preserving its identity. */
export function patchKanbanColumn(
  config: KanbanBoardConfig,
  columnId: string,
  patch: Partial<KanbanBoardColumnConfig>,
): KanbanBoardConfig {
  return {
    ...config,
    columns: config.columns.map((column) =>
      column.id === columnId ? { ...column, ...patch, id: column.id } : column,
    ),
  }
}
