import * as React from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Trash2 } from 'lucide-react'
import { PROJECT_COLOR_PALETTE, type ProjectColorTreatment } from '@/utils/project-colors'
import { type SessionStatus, getStatusIconStyle } from '@/config/session-status-config'
import type { KanbanColumnColor } from '@/hooks/useKanbanColumnColors'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { TaskTile } from './TaskTile'
import { NewTaskComposer } from './NewTaskComposer'
import type {
  KanbanColumnMeta,
  KanbanModelProviderGroup,
  KanbanProject,
  KanbanTask,
} from './types'

interface KanbanColumnProps {
  column: KanbanColumnMeta
  /** Resolved color identity for this column (header pill + body tint). */
  color?: KanbanColumnColor
  tasks: KanbanTask[]
  projectsById: Map<string, KanbanProject>
  statusesById: Map<string, SessionStatus>
  /** Ordered workspace statuses for the per-tile status picker. */
  statuses?: SessionStatus[]
  /** Change a task's status from its tile. Enables the status-badge picker when set. */
  onChangeStatus?: (taskId: string, statusId: string) => void
  treatment: ProjectColorTreatment
  expandedTaskIds: Set<string>
  onTaskClick?: (taskId: string) => void
  /** Open the editor against a tile (edit mode). Enables the tile's "Edit task" action. */
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
  /** When present, renders the inline "New Task" composer at the top of the column. */
  onCreateTask?: (title: string) => void
  /** Status auto-applied to a task dropped into this column (empty/undefined = leave untouched). */
  dropStatusId?: string
  /** Set this column's drop-status. Enables the header status picker when provided ('' clears). */
  onSelectDropStatus?: (statusId: string) => void
  /** Rename this (custom) column. Enables the column editor when provided. */
  onRename?: (name: string) => void
  /** Set this (custom) column's accent color. */
  onSetColor?: (color: string) => void
  /** Remove this (custom) column. Absent for the last remaining column (the board keeps one). */
  onRemove?: () => void
}

export function KanbanColumn({
  column,
  color,
  tasks,
  projectsById,
  statusesById,
  statuses,
  onChangeStatus,
  treatment,
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
  dropStatusId,
  onSelectDropStatus,
  onRename,
  onSetColor,
  onRemove,
}: KanbanColumnProps) {
  const { t } = useTranslation()
  // Built-in columns carry an i18n key; custom (per-project) columns a verbatim name.
  const label = column.labelKey ? t(column.labelKey) : (column.name ?? '')
  const editable = !!onRename || !!onSetColor || !!onRemove
  // The column's scroll area is the drop target; `isOver` highlights it while a
  // tile is dragged over. The DndContext lives in KanbanBoard, so these hooks are
  // only ever mounted under a provider (the playground board mounts it too).
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-0.5 pb-2">
        {/* Colored header pill carries the column identity; the count rides along
            in a translucent chip. The trailing space is a reserved WIP slot. */}
        <ColumnHeader
          label={label}
          count={tasks.length}
          color={color}
          statuses={statuses}
          dropStatus={dropStatusId ? statusesById.get(dropStatusId) : undefined}
          onSelectDropStatus={onSelectDropStatus}
          editable={editable}
          onRename={onRename}
          onSetColor={onSetColor}
          onRemove={onRemove}
        />
      </div>

      <div
        ref={setNodeRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-2 transition-shadow"
        style={{
          backgroundColor: color?.tint,
          boxShadow: isOver && color ? `inset 0 0 0 2px ${color.solid}` : undefined,
        }}
      >
        {onCreateTask && <NewTaskComposer onCreate={onCreateTask} />}

        {tasks.map(task => (
          <DraggableTile key={task.id} taskId={task.id}>
            <TaskTile
              task={task}
              project={task.projectId ? projectsById.get(task.projectId) : undefined}
              status={statusesById.get(task.statusId)}
              statuses={statuses}
              onStatusChange={onChangeStatus ? statusId => onChangeStatus(task.id, statusId) : undefined}
              treatment={treatment}
              expanded={expandedTaskIds.has(task.id)}
              onClick={() => onTaskClick?.(task.id)}
              onEdit={onEditTask ? () => onEditTask(task.id) : undefined}
              onToggleSubtasks={() => onToggleSubtasks?.(task.id)}
              onSubtaskClick={onSubtaskClick ? subtaskId => onSubtaskClick(task.id, subtaskId) : undefined}
              onAddSubtask={onAddSubtask ? (title, model) => onAddSubtask(task.id, title, model) : undefined}
              onRunSubtasks={onRunSubtasks ? () => onRunSubtasks(task.id) : undefined}
              subtaskModelGroups={subtaskModelGroups}
              defaultSubtaskModel={defaultSubtaskModel}
            />
          </DraggableTile>
        ))}
      </div>
    </div>
  )
}

/**
 * Colored column-identity pill. Three modes, by capability:
 * - **plain** (no handlers): a non-interactive pill (e.g. the playground board).
 * - **drop-status** (`onSelectDropStatus` only): the built-in board columns — the
 *   pill opens a status menu choosing the status auto-applied on drop.
 * - **editable** (`editable` + rename/color/remove handlers): per-project custom
 *   columns — the pill opens a full editor (rename, accent color, drop-status, remove).
 */
function ColumnHeader({
  label,
  count,
  color,
  statuses,
  dropStatus,
  onSelectDropStatus,
  editable,
  onRename,
  onSetColor,
  onRemove,
}: {
  label: string
  count: number
  color?: KanbanColumnColor
  statuses?: SessionStatus[]
  dropStatus?: SessionStatus
  onSelectDropStatus?: (statusId: string) => void
  editable?: boolean
  onRename?: (name: string) => void
  onSetColor?: (color: string) => void
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const pillStyle = color ? { backgroundColor: color.solid, color: color.onAccent } : undefined
  const inner = (
    <>
      {dropStatus && (
        <span className="shrink-0 flex items-center" style={getStatusIconStyle(dropStatus)}>
          {dropStatus.icon}
        </span>
      )}
      {label}
      <span
        className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.25)' }}
      >
        {count}
      </span>
    </>
  )

  // Plain pill: nothing to configure.
  if (!onSelectDropStatus && !editable) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
        style={pillStyle}
      >
        {inner}
      </span>
    )
  }

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        data-no-dnd="true"
        onPointerDown={e => e.stopPropagation()}
        title={editable ? t('kanban.column.edit') : t('kanban.column.setDropStatus')}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-shadow hover:ring-2 hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-foreground/20"
        style={pillStyle}
      >
        {inner}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
    </PopoverTrigger>
  )

  // Drop-status-only (built-in board columns).
  if (!editable) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          data-no-dnd="true"
        >
          <SessionStatusMenu
            states={statuses}
            activeState={dropStatus?.id ?? ''}
            onSelect={statusId => {
              onSelectDropStatus?.(statusId)
              setOpen(false)
            }}
            onClear={() => {
              onSelectDropStatus?.('')
              setOpen(false)
            }}
            clearLabel={t('kanban.column.dropStatusNone')}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // Full editor for custom (per-project) columns.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent
        align="start"
        sideOffset={4}
        className="dark w-64 space-y-3 border-border/50 bg-background/80 p-3 backdrop-blur-xl backdrop-saturate-150"
        style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
        data-no-dnd="true"
      >
        {onRename && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.name')}</label>
            <input
              type="text"
              defaultValue={label}
              autoFocus
              onBlur={e => {
                const next = e.target.value.trim()
                if (next && next !== label) onRename(next)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                  setOpen(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-border"
            />
          </div>
        )}

        {onSetColor && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.color')}</label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLOR_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onSetColor(hex)}
                  title={hex}
                  className="grid h-5 w-5 place-items-center rounded-full ring-1 ring-border/40 transition-transform hover:scale-110"
                  style={{ backgroundColor: hex }}
                >
                  {color?.solid === hex && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {onSelectDropStatus && statuses && statuses.length > 0 && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-foreground/50">{t('kanban.column.setDropStatus')}</label>
            <SessionStatusMenu
              states={statuses}
              activeState={dropStatus?.id ?? ''}
              onSelect={statusId => onSelectDropStatus(statusId)}
              onClear={() => onSelectDropStatus('')}
              clearLabel={t('kanban.column.dropStatusNone')}
            />
          </div>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('kanban.column.remove')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Pointer-drag wrapper for a tile. Only `listeners` are spread (not `attributes`)
 * so the wrapper doesn't add a competing `role="button"`/tab stop on top of the
 * TaskTile card, which already owns click/keyboard "open" semantics. The dragged
 * tile is hidden (the DragOverlay clone follows the cursor instead), avoiding the
 * column's `overflow-y-auto` clipping.
 */
function DraggableTile({ taskId, children }: { taskId: string; children: React.ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: taskId })
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0 : 1 }} {...listeners}>
      {children}
    </div>
  )
}
