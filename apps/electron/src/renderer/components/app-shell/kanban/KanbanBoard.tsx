import * as React from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { KanbanColumnDef } from '@craft-agent/shared/projects/types'
import { SmartPointerSensor } from '@/components/ui/sortable-list'
import type { ProjectColorTreatment } from '@/utils/project-colors'
import type { SessionStatus } from '@/config/session-status-config'
import { useKanbanColumnColors, makeColumnColor } from '@/hooks/useKanbanColumnColors'
import { KanbanColumn } from './KanbanColumn'
import { TaskTile } from './TaskTile'
import type {
  KanbanColumnId,
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
} from './types'

interface KanbanBoardProps {
  /** Ordered columns to render. Built-ins carry `labelKey`; custom columns carry `name`. */
  columns: readonly KanbanColumnMeta[]
  tasks: KanbanTask[]
  projectsById: Map<string, KanbanProject>
  statusesById: Map<string, SessionStatus>
  /** Ordered workspace statuses for the per-tile status picker. */
  statuses?: SessionStatus[]
  /** Change a task's status from its tile. Enables the status-badge picker when set. */
  onChangeStatus?: (taskId: string, statusId: string) => void
  /** Project color treatment. Defaults to 'stripe-tint'. */
  treatment?: ProjectColorTreatment
  expandedTaskIds: Set<string>
  onTaskClick?: (taskId: string) => void
  /** Open the full-pane editor against a tile (edit mode). Enables the tile's "Edit task" action. */
  onEditTask?: (taskId: string) => void
  onToggleSubtasks?: (taskId: string) => void
  onSubtaskClick?: (taskId: string, subtaskId: string) => void
  onAddSubtask?: (taskId: string, title: string, model: string) => void
  /** Run all pending subtasks of a task. Shows each tile's Play button when set. */
  onRunSubtasks?: (taskId: string) => void
  /** Provider→model catalog for each tile's "Add subtask" composer. */
  subtaskModelGroups?: KanbanModelProviderGroup[]
  /** Model id pre-selected in the composer. */
  defaultSubtaskModel?: string
  /** Create a task tile from a typed title. Renders the inline composer in the first column. */
  onCreateTask?: (title: string) => void
  /** Move a tile to another column (drag-and-drop). Placement only — never touches status. */
  onMoveTask?: (taskId: string, toColumn: KanbanColumnId) => void
  /** Per-column status auto-applied on drop. Keyed by column id; empty = leave untouched. */
  columnDropStatus?: Partial<Record<KanbanColumnId, string>>
  /** Set a column's drop-status from its header. Enables the header picker when provided. */
  onSelectDropStatus?: (column: KanbanColumnId, statusId: string) => void
  /** Rename/recolor a custom column (single-project edit mode). Enables the column editor. */
  onUpdateColumn?: (columnId: string, patch: Partial<KanbanColumnDef>) => void
  /** Remove a custom column (single-project edit mode); its cards reassign to the first column. */
  onRemoveColumn?: (columnId: string) => void
  /** Append a new custom column (single-project edit mode). Renders the "add column" affordance. */
  onAddColumn?: () => void
}

/**
 * The board. Renders the supplied `columns` and buckets tiles strictly by
 * `task.column` (placement is independent from the status badge); a tile whose
 * column id matches none of the active columns falls back to the first column.
 * The "New Task" composer lives at the top of the first column — creating a
 * parent session drops a named tile there.
 */
export function KanbanBoard({
  columns,
  tasks,
  projectsById,
  statusesById,
  statuses,
  onChangeStatus,
  treatment = 'stripe-tint',
  expandedTaskIds,
  onTaskClick,
  onEditTask,
  onToggleSubtasks,
  onSubtaskClick,
  onAddSubtask,
  onRunSubtasks,
  subtaskModelGroups,
  defaultSubtaskModel,
  onCreateTask,
  onMoveTask,
  columnDropStatus,
  onSelectDropStatus,
  onUpdateColumn,
  onRemoveColumn,
  onAddColumn,
}: KanbanBoardProps) {
  const { t } = useTranslation()
  const firstColumnId = columns[0]?.id

  const tasksByColumn = React.useMemo(() => {
    const known = new Set(columns.map(c => c.id))
    const buckets = new Map<KanbanColumnId, KanbanTask[]>()
    for (const c of columns) buckets.set(c.id, [])
    for (const task of tasks) {
      // A tile whose persisted column no longer exists falls back to the first column.
      const target = known.has(task.column) ? task.column : firstColumnId
      if (target === undefined) continue
      buckets.get(target)!.push(task)
    }
    // Newest tiles first within each column (a freshly created task lands on top).
    const recency = (t: KanbanTask) => t.createdAt ?? t.lastMessageAt ?? 0
    for (const list of buckets.values()) list.sort((a, b) => recency(b) - recency(a))
    return buckets
  }, [tasks, columns, firstColumnId])

  const columnColors = useKanbanColumnColors()

  const [activeId, setActiveId] = React.useState<string | null>(null)
  // 5px threshold so a click-to-open isn't read as a drag; the sensor also skips
  // elements marked data-no-dnd (chevron toggle, "Add subtask" composer).
  const sensors = useSensors(useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }))

  const activeTask = activeId ? tasks.find(t => t.id === activeId) ?? null : null

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      if (!over) return
      const toColumn = over.id as KanbanColumnId
      const task = tasks.find(t => t.id === String(active.id))
      if (!task || task.column === toColumn) return
      onMoveTask?.(String(active.id), toColumn)
    },
    [tasks, onMoveTask]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full gap-3 p-3">
        {columns.map((column, index) => (
          <KanbanColumn
            key={column.id}
            column={column}
            // Custom columns carry their own accent; built-ins resolve from the global color hook.
            color={column.color ? makeColumnColor(column.color) : columnColors.get(column.id)}
            tasks={tasksByColumn.get(column.id) ?? []}
            projectsById={projectsById}
            statusesById={statusesById}
            statuses={statuses}
            onChangeStatus={onChangeStatus}
            treatment={treatment}
            expandedTaskIds={expandedTaskIds}
            onTaskClick={onTaskClick}
            onEditTask={onEditTask}
            onToggleSubtasks={onToggleSubtasks}
            onSubtaskClick={onSubtaskClick}
            onAddSubtask={onAddSubtask}
            onRunSubtasks={onRunSubtasks}
            subtaskModelGroups={subtaskModelGroups}
            defaultSubtaskModel={defaultSubtaskModel}
            onCreateTask={index === 0 ? onCreateTask : undefined}
            dropStatusId={column.dropStatusId ?? columnDropStatus?.[column.id]}
            onSelectDropStatus={
              onSelectDropStatus ? statusId => onSelectDropStatus(column.id, statusId) : undefined
            }
            onRename={onUpdateColumn ? name => onUpdateColumn(column.id, { name }) : undefined}
            onSetColor={onUpdateColumn ? color => onUpdateColumn(column.id, { color }) : undefined}
            // Guard against removing the last column — the board must always keep one.
            onRemove={onRemoveColumn && columns.length > 1 ? () => onRemoveColumn(column.id) : undefined}
          />
        ))}
        {onAddColumn && (
          <button
            type="button"
            onClick={onAddColumn}
            title={t('kanban.column.add')}
            className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg border border-dashed border-border text-foreground/50 transition-colors hover:border-border/80 hover:bg-foreground/[0.03] hover:text-foreground/80"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* position:fixed overlay clone — escapes the column's overflow clipping.
          dropAnimation is disabled: on a cross-column drop the source tile is
          gone (it re-renders into the target), so a "fly back" would be wrong. */}
      <DragOverlay dropAnimation={null} style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
        {activeTask ? (
          <div className="cursor-grabbing rounded-lg shadow-dragging" style={{ transform: 'scale(1.025)' }}>
            <TaskTile
              task={activeTask}
              project={activeTask.projectId ? projectsById.get(activeTask.projectId) : undefined}
              status={statusesById.get(activeTask.statusId)}
              treatment={treatment}
              expanded={expandedTaskIds.has(activeTask.id)}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
