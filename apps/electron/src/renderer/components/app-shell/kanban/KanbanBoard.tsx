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
import { sessionSelection } from '@/hooks/useEntitySelection'
import {
  KanbanColumn,
  parseProjectGroupDropId,
  type KanbanProjectGroup,
} from './KanbanColumn'
import { buildPriorityGroups } from './priority-groups'
import { flattenVisibleKanbanTaskIds } from './kanban-selection'
import { TaskTile } from './TaskTile'
import type {
  KanbanColumnId,
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
} from './types'

export type KanbanMoveTarget = {
  columnId: KanbanColumnId
  /** When set (including null), assign this project on drop. Undefined = leave project alone. */
  projectId?: string | null
}

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
  /** Create a task tile from a typed title. Renders the inline composer in the first expanded column. */
  onCreateTask?: (title: string) => void
  /**
   * Move a tile to another column (and optionally assign a project group).
   * Prefer the object form; string form kept for playground callers.
   */
  onMoveTask?: (taskId: string, to: KanbanColumnId | KanbanMoveTarget) => void
  /** Per-column status auto-applied on drop. Keyed by column id; empty = leave untouched. */
  columnDropStatus?: Partial<Record<KanbanColumnId, string>>
  /** Set a column's drop-status from its header. Enables the header picker when provided. */
  onSelectDropStatus?: (column: KanbanColumnId, statusId: string) => void
  /** Rename/recolor/prompt a column. Enables the column editor on all columns when set. */
  onUpdateColumn?: (columnId: string, patch: Partial<KanbanColumnDef> & {
    promptEnabled?: boolean
    prompt?: string
    collapsed?: boolean
    label?: string
  }) => void
  /** Remove a custom column; its cards reassign to the first column. */
  onRemoveColumn?: (columnId: string) => void
  /** Append a new custom column. Renders + affordances left of first expanded / right of last. */
  onAddColumn?: (side?: 'left' | 'right') => void
  /** When true, render collapsible project groups inside each column. */
  groupByProject?: boolean
  /** B6: bucket per-column tasks into priority subsections (pseudo project groups `__priority_x`). */
  groupByPriority?: boolean
  /** Collapsed project group keys (`projectId` or `__none__`) — sessionStorage-backed by container. */
  collapsedGroupKeys?: Set<string>
  onToggleProjectGroup?: (groupKey: string) => void
  /** Label for the "no project" group. */
  noProjectLabel?: string
  /**
   * Custom per-column task sort (B6). Default = recency (createdAt/lastMessageAt desc).
   */
  sortTasks?: (a: KanbanTask, b: KanbanTask) => number
  /** Render collection actions against the board's exact flattened visible order. */
  renderBulkActions?: (visibleTaskIds: readonly string[]) => React.ReactNode
}


/**
 * The board. Renders the supplied `columns` and buckets tiles strictly by
 * `task.column` (placement is independent from the status badge); a tile whose
 * column id matches none of the active columns falls back to the first column.
 * The "New Task" composer lives at the top of the first *expanded* column.
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
  groupByProject = false,
  groupByPriority = false,
  collapsedGroupKeys,
  onToggleProjectGroup,
  noProjectLabel,
  sortTasks,
  renderBulkActions,
}: KanbanBoardProps) {
  const { t } = useTranslation()
  const firstColumnId = columns[0]?.id
  const firstExpandedIndex = columns.findIndex(
    c => !(c.collapsed ?? c.defaultCollapsed ?? false),
  )
  const createColumnIndex = firstExpandedIndex >= 0 ? firstExpandedIndex : 0

  const tasksByColumn = React.useMemo(() => {
    const known = new Set(columns.map(c => c.id))
    const buckets = new Map<KanbanColumnId, KanbanTask[]>()
    for (const c of columns) buckets.set(c.id, [])
    for (const task of tasks) {
      const target = known.has(task.column) ? task.column : firstColumnId
      if (target === undefined) continue
      buckets.get(target)!.push(task)
    }
    const recency = (task: KanbanTask) => task.createdAt ?? task.lastMessageAt ?? 0
    const sorter =
      sortTasks ??
      ((a: KanbanTask, b: KanbanTask) => recency(b) - recency(a))
    for (const list of buckets.values()) list.sort(sorter)
    return buckets
  }, [tasks, columns, firstColumnId, sortTasks])

  const groupsByColumn = React.useMemo(() => {
    if (!groupByProject) return null
    const result = new Map<KanbanColumnId, KanbanProjectGroup[]>()
    const noneLabel = noProjectLabel ?? t('kanban.noProject')

    for (const column of columns) {
      const colTasks = tasksByColumn.get(column.id) ?? []
      const byProject = new Map<string | null, KanbanTask[]>()
      // Stable order: known projects (board order via projectsById insertion), then unbound.
      for (const task of colTasks) {
        const key = task.projectId ?? null
        const list = byProject.get(key)
        if (list) list.push(task)
        else byProject.set(key, [task])
      }

      const groups: KanbanProjectGroup[] = []
      // Projects that appear on the board, in projectsById order.
      for (const [id, project] of projectsById) {
        const list = byProject.get(id)
        if (!list?.length) continue
        groups.push({
          projectId: id,
          name: project.name,
          color: project.color,
          tasks: list,
        })
        byProject.delete(id)
      }
      // Any remaining project ids not in projectsById (colorless projects).
      for (const [id, list] of byProject) {
        if (id === null) continue
        groups.push({
          projectId: id,
          name: id,
          tasks: list,
        })
      }
      const unbound = byProject.get(null)
      if (unbound?.length) {
        groups.push({ projectId: null, name: noneLabel, tasks: unbound })
      }
      // Always show at least an empty "no project" drop zone when grouping is on
      // and the column has no tasks — so drops can still assign project.
      if (groups.length === 0) {
        groups.push({ projectId: null, name: noneLabel, tasks: [] })
      }
      result.set(column.id, groups)
    }
    return result
  }, [groupByProject, columns, tasksByColumn, projectsById, noProjectLabel, t])

  // B6: per-column priority subsections (order urgent → high → medium → low → none).
  const priorityGroupsByColumn = React.useMemo(() => {
    if (!groupByPriority) return null
    const result = new Map<KanbanColumnId, KanbanProjectGroup[]>()
    for (const column of columns) {
      const colTasks = tasksByColumn.get(column.id) ?? []
      result.set(column.id, buildPriorityGroups(colTasks, t))
    }
    return result
  }, [groupByPriority, columns, tasksByColumn, t])
  const visibleTaskIds = React.useMemo(
    () =>
      flattenVisibleKanbanTaskIds(
        columns,
        tasksByColumn,
        groupsByColumn,
        priorityGroupsByColumn,
        collapsedGroupKeys,
      ),
    [
      collapsedGroupKeys,
      columns,
      groupsByColumn,
      priorityGroupsByColumn,
      tasksByColumn,
    ],
  )
  const visibleIndexById = React.useMemo(
    () => new Map(visibleTaskIds.map((id, index) => [id, index])),
    [visibleTaskIds],
  )
  const { toggle, selectRange, isSelected, isMultiSelectActive } =
    sessionSelection.useSelection()
  const handleSelectTask = React.useCallback(
    (taskId: string, shiftKey: boolean) => {
      const index = visibleIndexById.get(taskId)
      if (index === undefined) return
      if (shiftKey) selectRange(index, visibleTaskIds)
      else toggle(taskId, index)
    },
    [selectRange, toggle, visibleIndexById, visibleTaskIds],
  )

  const columnColors = useKanbanColumnColors()

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const sensors = useSensors(useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }))

  const activeTask = activeId ? tasks.find(task => task.id === activeId) ?? null : null

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      if (!over) return
      const overId = String(over.id)
      const task = tasks.find(t => t.id === String(active.id))
      if (!task) return

      const groupTarget = parseProjectGroupDropId(overId)
      if (groupTarget) {
        const sameColumn = task.column === groupTarget.columnId
        const sameProject =
          (task.projectId ?? null) === groupTarget.projectId
        if (sameColumn && sameProject) return
        onMoveTask?.(String(active.id), {
          columnId: groupTarget.columnId,
          projectId: groupTarget.projectId,
        })
        return
      }

      const toColumn = overId as KanbanColumnId
      // Ignore drops onto non-column ids (e.g. other tiles) — closestCorners may
      // report a tile id; only accept known column ids.
      if (!columns.some(c => c.id === toColumn)) return
      if (task.column === toColumn) return
      onMoveTask?.(String(active.id), { columnId: toColumn })
    },
    [tasks, onMoveTask, columns],
  )

  const addColumnButton = (side: 'left' | 'right') =>
    onAddColumn ? (
      <button
        type="button"
        onClick={() => onAddColumn(side)}
        title={t('kanban.column.add')}
        className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg border border-dashed border-border text-foreground/50 transition-colors hover:border-border/80 hover:bg-foreground/[0.03] hover:text-foreground/80"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    ) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full gap-2 overflow-x-auto p-3">
        {addColumnButton('left')}
        {columns.map((column, index) => (
          <KanbanColumn
            key={column.id}
            column={column}
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
            onCreateTask={index === createColumnIndex ? onCreateTask : undefined}
            dropStatusId={column.dropStatusId ?? columnDropStatus?.[column.id]}
            onSelectDropStatus={
              onSelectDropStatus ? statusId => onSelectDropStatus(column.id, statusId) : undefined
            }
            onRename={
              onUpdateColumn
                ? name => onUpdateColumn(column.id, { name, label: name })
                : undefined
            }
            onSetColor={onUpdateColumn ? color => onUpdateColumn(column.id, { color }) : undefined}
            onRemove={
              onRemoveColumn && !column.isBuiltIn && columns.length > 1
                ? () => onRemoveColumn(column.id)
                : undefined
            }
            onToggleCollapsed={
              onUpdateColumn
                ? () =>
                    onUpdateColumn(column.id, {
                      collapsed: !(column.collapsed ?? column.defaultCollapsed ?? false),
                    })
                : undefined
            }
            onSetPrompt={
              onUpdateColumn
                ? patch => onUpdateColumn(column.id, patch)
                : undefined
            }
            projectGroups={groupsByColumn?.get(column.id)}
            priorityGroups={priorityGroupsByColumn?.get(column.id)}
            collapsedGroupKeys={collapsedGroupKeys}
            onToggleProjectGroup={onToggleProjectGroup}
            isTaskSelected={isSelected}
            multiSelectActive={isMultiSelectActive}
            onSelectTask={handleSelectTask}
          />
        ))}
        {addColumnButton('right')}
      </div>
      {renderBulkActions?.(visibleTaskIds)}


      <DragOverlay dropAnimation={null} style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
        {activeTask ? (
          <div className="cursor-grabbing rounded-lg shadow-dragging" style={{ transform: 'scale(1.025)' }}>
            <TaskTile
              task={activeTask}
              project={activeTask.projectId ? projectsById.get(activeTask.projectId) : undefined}
              status={statusesById.get(activeTask.statusId)}
              treatment={treatment}
              expanded={expandedTaskIds.has(activeTask.id)}
              columnAccent={
                (columns.find(c => c.id === activeTask.column)?.color
                  ? makeColumnColor(columns.find(c => c.id === activeTask.column)!.color!)
                  : columnColors.get(activeTask.column)
                )?.solid
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
